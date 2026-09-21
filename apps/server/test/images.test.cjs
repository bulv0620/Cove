const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { HTTP_CODE_METADATA } = require('@nestjs/common/constants');
const { FilesConfig } = require('../dist/modules/files/files-config');
const { filesError } = require('../dist/modules/files/files-policy');
const { ImagesController } = require('../dist/modules/images/images.controller');
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
  const deletedAssetIds = [];
  const deletedManyAssetIds = [];
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
      delete: async ({ where }) => {
        deletedAssetIds.push(where.id);
        return asset;
      },
      deleteMany: async ({ where }) => {
        deletedManyAssetIds.push(where.id);
        return { count: 1 };
      },
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
  return {
    service,
    user,
    calls,
    grants,
    rateKeys,
    deletedAssetIds,
    deletedManyAssetIds,
    db,
    smb,
    getAsset: () => asset,
  };
}

test('image delete endpoint returns no content after a successful removal', () => {
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, ImagesController.prototype.remove), 204);
});

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

test('image delete removes the registered original and its deterministic thumbnail', async () => {
  const { service, user, calls, deletedAssetIds, getAsset } = harness();
  const asset = getAsset();
  await service.remove(user, asset.id);
  const deletes = calls.filter((call) => call.action === 'delete_object');
  assert.deepEqual(deletes[0], {
    action: 'delete_object',
    path: asset.relativePath,
    objectId: asset.objectId,
  });
  assert.match(deletes[1].path, /^Image Hosting\/\.cove-cache\/thumbnails\/[0-9a-f]{64}\.webp$/);
  assert.equal(deletes[1].objectId, '42');
  assert.deepEqual(deletedAssetIds, [asset.id]);
});

test('pending delete recovery still removes the thumbnail when the original is already absent', async () => {
  const { service, calls, deletedManyAssetIds, smb, getAsset } = harness();
  const asset = {
    ...getAsset(),
    state: 'CLEANUP_PENDING',
    cleanupPending: true,
  };
  const call = smb.call;
  smb.call = async (credentials, input) => {
    if (input.action === 'delete_object' && input.path === asset.relativePath) {
      calls.push(input);
      throw filesError('PATH_NOT_FOUND');
    }
    return call(credentials, input);
  };
  await service.recoverAsset(asset);
  assert(
    calls.some(
      (entry) =>
        entry.action === 'delete_object' &&
        /^Image Hosting\/\.cove-cache\/thumbnails\/[0-9a-f]{64}\.webp$/.test(entry.path),
    ),
  );
  assert.deepEqual(deletedManyAssetIds, [asset.id]);
});

test('thumbnail cleanup failures keep the image queued for recovery', async () => {
  const { service, user, smb, getAsset } = harness();
  const asset = getAsset();
  const call = smb.call;
  smb.call = async (credentials, input) => {
    if (input.action === 'stat' && input.path.startsWith('Image Hosting/.cove-cache/thumbnails/'))
      throw filesError('SMB_UNAVAILABLE');
    return call(credentials, input);
  };
  await assert.rejects(service.remove(user, asset.id), code('SMB_UNAVAILABLE'));
  assert.equal(getAsset().state, 'CLEANUP_PENDING');
  assert.equal(getAsset().cleanupPending, true);
  assert.equal(getAsset().errorCode, 'SMB_UNAVAILABLE');
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
