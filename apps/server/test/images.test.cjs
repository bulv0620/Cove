const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { FilesConfig } = require('../dist/modules/files/files-config');
const { ImagesService } = require('../dist/modules/images/images.service');

const code = (expected) => (error) => error.getResponse().code === expected;

function config() {
  return new FilesConfig({
    get: (key) =>
      ({
        SMB_ENABLED: 'true',
        SMB_HOST: 'nas.test',
        SMB_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString('base64'),
      })[key],
  });
}

function harness() {
  const user = {
    id: randomUUID(),
    isSuperAdmin: false,
    mustChangePassword: false,
    permissions: [
      'infra.images.page',
      'infra.images.upload',
      'infra.images.publish',
      'infra.images.delete',
    ],
  };
  const binding = { version: randomUUID() };
  const now = new Date('2026-09-18T01:00:00.000Z');
  let asset = {
    id: randomUUID(),
    userId: user.id,
    bindingVersion: binding.version,
    configFingerprint: config().fingerprint,
    requestId: null,
    relativePath: 'Image Hosting/picture.png',
    tempPath: null,
    objectId: '42',
    mediaType: null,
    extension: 'png',
    sizeBytes: 100n,
    sha256: null,
    state: 'PRIVATE',
    errorCode: null,
    cleanupPending: false,
    publishRequested: false,
    leaseExpiresAt: null,
    sourceModifiedAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const grants = [];
  const rateKeys = [];
  const db = {
    $queryRaw: async () => [],
    smbBinding: { findUnique: async () => binding },
    auditLog: { create: async () => ({}) },
    imageAsset: {
      findFirst: async () => asset,
      update: async ({ data }) => (asset = { ...asset, ...data, updatedAt: new Date() }),
      updateMany: async ({ data }) => {
        asset = { ...asset, ...data, updatedAt: new Date() };
        return { count: 1 };
      },
      findUniqueOrThrow: async () => asset,
      deleteMany: async () => ({ count: 1 }),
    },
    imagePublicGrant: {
      updateMany: async () => ({ count: grants.length }),
      create: async ({ data }) => {
        grants.push(data);
        return data;
      },
    },
    imagePublicRateBucket: {
      upsert: async ({ create }) => {
        rateKeys.push(create.bucketKey);
        return { ...create, requestCount: create.requestCount };
      },
      deleteMany: async () => ({ count: 0 }),
    },
    $transaction: async (value) => (typeof value === 'function' ? value(db) : Promise.all(value)),
  };
  const permissions = { getAuthUser: async () => user };
  const bindings = {
    get: async () => ({ binding, credentials: { username: 'user', password: 'secret' } }),
    summary: async () => ({ enabled: true, bound: true }),
  };
  const calls = [];
  const smb = {
    call: async (_credentials, input) => {
      calls.push(input);
      if (input.action === 'stat')
        return {
          name: 'picture.png',
          relativePath: asset.relativePath,
          type: 'file',
          sizeBytes: '100',
          modifiedAt: now.toISOString(),
          hidden: false,
          supported: true,
          objectId: '42',
        };
      if (input.action === 'inspect')
        return {
          bytes: '100',
          objectId: '42',
          mediaType: 'image/png',
          extension: 'png',
          sha256: 'a'.repeat(64),
        };
      return true;
    },
  };
  const service = new ImagesService(db, permissions, bindings, smb, config());
  return { service, user, calls, grants, rateKeys, db, getAsset: () => asset };
}

test('image upload policy rejects unsupported extensions and files above 25 MiB', async () => {
  const { service, user } = harness();
  await assert.rejects(
    service.createUpload(user, {
      name: 'vector.svg',
      size: '10',
      requestId: randomUUID(),
      publish: false,
    }),
    code('UNSUPPORTED_IMAGE'),
  );
  await assert.rejects(
    service.createUpload(user, {
      name: 'large.png',
      size: String(25 * 1024 * 1024 + 1),
      requestId: randomUUID(),
      publish: false,
    }),
    code('SIZE_LIMIT'),
  );
});

test('publishing a discovered SMB file inspects bytes before issuing a random public ID', async () => {
  const { service, user, calls, grants, getAsset } = harness();
  const result = await service.visibility(user, getAsset().id, { public: true });
  assert(calls.some((call) => call.action === 'inspect'));
  assert.equal(getAsset().mediaType, 'image/png');
  assert.equal(getAsset().state, 'PUBLIC');
  assert.match(result.publicUrl, /^\/image\/[A-Za-z0-9_-]{43}$/);
  assert.equal(grants.length, 1);
});

test('pending delete recovery only removes the previously registered SMB object', async () => {
  const { service, calls, getAsset } = harness();
  const asset = {
    ...getAsset(),
    state: 'CLEANUP_PENDING',
    cleanupPending: true,
  };
  await service.recoverAsset(asset);
  assert.deepEqual(
    calls.find((call) => call.action === 'delete_object'),
    { action: 'delete_object', path: asset.relativePath, objectId: asset.objectId },
  );
});

test('public request buckets are database coordinated and do not persist the raw address', async () => {
  const { service, rateKeys, db } = harness();
  await service.limitPublic('203.0.113.42');
  assert.equal(rateKeys.length, 2);
  assert(rateKeys.every((key) => /^[0-9a-f]{64}$/.test(key)));
  assert(!rateKeys.some((key) => key.includes('203.0.113.42')));
  db.imagePublicRateBucket.upsert = async ({ create }) => ({
    ...create,
    requestCount: service.config.imagePublicGlobalPerMinute + 1,
  });
  await assert.rejects(service.limitPublic('203.0.113.43'), code('RATE_LIMITED'));
});

test('image action authorization is independent from page visibility', async () => {
  const { service, user, getAsset } = harness();
  user.permissions = ['infra.images.page'];
  await assert.rejects(
    service.visibility(user, getAsset().id, { public: true }),
    code('FILES_FORBIDDEN'),
  );
  await assert.rejects(service.remove(user, getAsset().id), code('FILES_FORBIDDEN'));
});
