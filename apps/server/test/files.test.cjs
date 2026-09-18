const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { FilesConfig } = require('../dist/modules/files/files-config');
const { fileName, relativePath, filesError } = require('../dist/modules/files/files-policy');
const { FilesService } = require('../dist/modules/files/files.service');
const { SmbBindingsService } = require('../dist/modules/files/smb-bindings.service');
const makeConfig = (extra = {}) =>
  new FilesConfig({
    get: (key) =>
      ({
        SMB_ENABLED: 'true',
        SMB_HOST: 'nas.test',
        SMB_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString('base64'),
        ...extra,
      })[key],
  });
const code = (expected) => (error) => error.getResponse().code === expected;
function harness() {
  const user = {
    id: randomUUID(),
    isSuperAdmin: false,
    mustChangePassword: false,
    authVersion: 1,
    permissions: ['infra.files.page', 'infra.files.upload', 'infra.files.download'],
    roleCodes: [],
  };
  const binding = { version: randomUUID() };
  const config = makeConfig();
  const db = {};
  const permission = { getAuthUser: async (id) => (id === user.id ? user : null) };
  const bindings = {
    get: async () => ({ binding, credentials: { username: 'fake', password: 'fake' } }),
    recordCheck: async () => {},
    audit: async () => {},
  };
  const rows = Array.from({ length: 10000 }, (_, i) => ({
    name: `file-${10000 - i}.txt`,
    relativePath: `file-${10000 - i}.txt`,
    type: 'file',
    sizeBytes: String(i),
    modifiedAt: '2026-09-13T00:00:00Z',
    supported: true,
    hidden: false,
  }));
  const smb = { call: async () => rows };
  const service = new FilesService(db, config, permission, bindings, smb);
  return { service, user, bindings, binding, db, rows };
}
test('path boundary rejects traversal, UNC, ADS, reserved temporary names and ambiguous names', () => {
  for (const path of [
    '../b',
    'a/../b',
    '/root',
    'a//b',
    'C:/x',
    'a\\b',
    'file:stream',
    'a\0',
    'a.',
    'a ',
    'CON.txt',
    '.cove-upload-x.part',
    '.COVE-UPLOAD-x.part',
  ])
    assert.throws(() => relativePath(path), code('INVALID_PATH'));
  assert.equal(relativePath('文档/测试 %2e%2e 🏠.txt'), '文档/测试 %2e%2e 🏠.txt');
  assert.equal(relativePath(''), '');
  assert.throws(() => fileName('a'.repeat(256)));
});
test('credentials authenticate user, binding version, target, nonce and tag; cipher is never plaintext', () => {
  const config = makeConfig(),
    password = 'canary-' + randomUUID(),
    user = randomUUID(),
    version = randomUUID();
  const encrypted = config.seal(password, user, version);
  const row = { ...encrypted, userId: user, version, configFingerprint: config.fingerprint };
  assert.equal(config.unseal(row), password);
  assert(!JSON.stringify(encrypted).includes(password));
  for (const patch of [
    { userId: randomUUID() },
    { version: randomUUID() },
    { configFingerprint: 'other' },
    { authTag: randomBytes(16).toString('base64') },
  ])
    assert.throws(() => config.unseal({ ...row, ...patch }), code('CREDENTIAL_KEY_UNAVAILABLE'));
});
test('old key can be decrypted during rotation and resealed with new key', () => {
  const first = makeConfig();
  const row = {
    ...first.seal('canary', 'u', 'v'),
    userId: 'u',
    version: 'v',
    configFingerprint: first.fingerprint,
  };
  const second = makeConfig({
    SMB_CREDENTIAL_KEY_ID: 'v2',
    SMB_CREDENTIAL_KEY: Buffer.alloc(32, 8).toString('base64'),
    SMB_CREDENTIAL_PREVIOUS_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }),
  });
  assert.equal(second.unseal(row), 'canary');
  assert.equal(second.seal('canary', 'u', 'v').keyId, 'v2');
  assert.throws(() => makeConfig({ SMB_CREDENTIAL_KEY_ID: 'v2' }).unseal(row));
});
test('configuration fails closed and disabled integration needs no key', () => {
  assert.throws(() => makeConfig({ SMB_HOST: '//evil/share' }));
  assert.throws(() => makeConfig({ SMB_CREDENTIAL_KEY: 'bad' }));
  assert.throws(() => makeConfig({ FILES_MAX_ACTIVE_GLOBAL: '0' }));
  const disabled = new FilesConfig({ get: () => undefined });
  assert.equal(disabled.enabled, false);
  assert.throws(() => disabled.assertEnabled(), code('SMB_DISABLED'));
  assert.equal(makeConfig().encrypt, true);
  assert.equal(
    makeConfig({ NODE_ENV: 'production', FILES_ALLOW_INSECURE_LOCAL_COOKIE: 'true' }).secureCookie,
    true,
  );
});
test('authorization rejects missing page/action, expired auth version, disabled and forced-reset users', async () => {
  const { service, user } = harness();
  await service.authorize(user.id, 'upload', 1);
  await assert.rejects(service.authorize(user.id, 'upload', 2), code('AUTH_EXPIRED'));
  await assert.rejects(service.authorize('other'), code('AUTH_EXPIRED'));
  await assert.rejects(service.authorize(user.id, 'mkdir'), code('FILES_FORBIDDEN'));
  await assert.rejects(service.authorize(user.id, 'rename'), code('FILES_FORBIDDEN'));
  await assert.rejects(service.authorize(user.id, 'delete'), code('FILES_FORBIDDEN'));
  user.mustChangePassword = true;
  await assert.rejects(service.authorize(user.id), code('FILES_FORBIDDEN'));
  user.mustChangePassword = false;
  user.permissions = [];
  await assert.rejects(service.authorize(user.id), code('FILES_FORBIDDEN'));
});
test('rename stays in the same folder, never accepts root or an unchanged name, and clears snapshots', async () => {
  const { service, user } = harness();
  user.permissions.push('infra.files.rename');
  const calls = [];
  service.smb.call = async (_credentials, input) => {
    calls.push(input);
    return {
      name: 'renamed.txt',
      relativePath: 'folder/renamed.txt',
      type: 'file',
      sizeBytes: '1',
      modifiedAt: '2026-09-14T00:00:00Z',
      supported: true,
      hidden: false,
    };
  };
  service.snapshots.set('stale', { userId: user.id });
  const result = await service.rename(user, { path: 'folder/original.txt', name: 'renamed.txt' });
  assert.equal(result.relativePath, 'folder/renamed.txt');
  assert.deepEqual(calls[0], {
    action: 'rename',
    path: 'folder/original.txt',
    targetPath: 'folder/renamed.txt',
  });
  assert.equal(service.snapshots.size, 0);
  await assert.rejects(service.rename(user, { path: '', name: 'root' }), code('INVALID_PATH'));
  await assert.rejects(
    service.rename(user, { path: 'folder/same.txt', name: 'same.txt' }),
    code('INVALID_INPUT'),
  );
  await assert.rejects(
    service.rename(user, { path: 'folder/file.txt', name: '../outside.txt' }),
    code('INVALID_PATH'),
  );
});
test('batch delete reports partial failures, rejects root, and invalidates snapshots after success', async () => {
  const { service, user } = harness();
  user.permissions.push('infra.files.delete');
  service.smb.call = async (_credentials, input) => {
    if (input.path === 'not-empty') throw filesError('DIRECTORY_NOT_EMPTY');
    return true;
  };
  service.snapshots.set('stale', { userId: user.id });
  const result = await service.removeEntries(user, {
    paths: ['first.txt', 'not-empty', 'first.txt'],
  });
  assert.deepEqual(result, {
    deleted: ['first.txt'],
    failed: [{ path: 'not-empty', code: 'DIRECTORY_NOT_EMPTY' }],
  });
  assert.equal(service.snapshots.size, 0);
  await assert.rejects(service.removeEntries(user, { paths: [''] }), code('INVALID_PATH'));
  await assert.rejects(
    service.removeEntries(user, { paths: Array.from({ length: 101 }, (_, i) => `${i}.txt`) }),
    code('INVALID_INPUT'),
  );
});
test('super administrator still requires own SMB binding', async () => {
  const { service, user, bindings } = harness();
  user.isSuperAdmin = true;
  bindings.get = async () => {
    throw filesError('SMB_NOT_BOUND');
  };
  await assert.rejects(service.stat(user, ''), code('SMB_NOT_BOUND'));
});
test('10,000 entry sort, paging, hidden filtering and per-binding cursors are correct', async () => {
  const { service, user, binding, rows } = harness();
  for (const prefix of ['.cove-upload-', '.COVE-UPLOAD-'])
    rows.push({ name: `${prefix}secret.part`, type: 'file', hidden: true });
  const page = await service.entries(user, {
    path: '',
    limit: '200',
    sort: 'name',
    showHidden: 'true',
  });
  assert.equal(page.total, 10000);
  assert.equal(page.entries[0].name, 'file-1.txt');
  assert.equal(page.entries.length, 200);
  const next = await service.entries(user, {
    path: '',
    limit: '200',
    sort: 'name',
    showHidden: 'true',
    cursor: page.nextCursor,
  });
  assert.equal(next.entries[0].name, 'file-201.txt');
  await assert.rejects(
    service.entries(user, { path: 'other', cursor: page.nextCursor }),
    code('BINDING_CHANGED'),
  );
  binding.version = randomUUID();
  await assert.rejects(
    service.entries(user, { path: '', cursor: page.nextCursor }),
    code('BINDING_CHANGED'),
  );
  const match = await service.entries(user, { path: '', filter: 'file-10000' });
  assert.equal(match.total, 1);
});
test('operation IDs cannot read or cancel another user operation', async () => {
  const { service, user, db } = harness();
  db.fileOperation = {
    findFirst: async (query) => (query.where.userId === user.id ? null : { id: 'other' }),
  };
  await assert.rejects(service.operation(user, 'other'), code('OPERATION_NOT_FOUND'));
  await assert.rejects(service.cancel(user, 'other'), code('OPERATION_NOT_FOUND'));
});
test('download ticket rejects absent secrets and consumed or expired tickets', async () => {
  const { service, db } = harness();
  await assert.rejects(service.download(randomUUID(), 'bad', {}), code('FILES_FORBIDDEN'));
  db.downloadTicket = { findFirst: async () => null };
  await assert.rejects(service.download(randomUUID(), 'a'.repeat(64), {}), code('FILES_FORBIDDEN'));
});
test('failed SMB binding validation leaves previous encrypted record unchanged', async () => {
  let mutations = 0;
  const db = {
    user: { findUnique: async () => ({ id: 'user' }) },
    auditLog: { create: async () => {} },
    $transaction: async () => {
      mutations++;
    },
  };
  const service = new SmbBindingsService(db, makeConfig(), {
    call: async () => {
      throw filesError('SMB_CREDENTIALS_INVALID');
    },
  });
  await assert.rejects(
    service.save(
      'user',
      { username: 'nas', password: 'canary', expectedVersion: null },
      { id: 'admin' },
    ),
    code('SMB_CREDENTIALS_INVALID'),
  );
  assert.equal(mutations, 0);
});
test('changing the configured NAS target cannot forward old credentials to a new server', async () => {
  const config = makeConfig();
  const db = { smbBinding: { findUnique: async () => ({ configFingerprint: 'old-target' }) } };
  const service = new SmbBindingsService(db, config, {});
  await assert.rejects(service.get('u'), code('SMB_CONFIG_CHANGED'));
});
test('crash recovery only reconciles expired leases and never changes a live local transfer', async () => {
  const { service, db } = harness();
  const changes = [];
  db.downloadTicket = { deleteMany: async () => {} };
  db.fileOperation = {
    findMany: async (query) =>
      query.where.state
        ? [
            { id: 'crashed-upload', state: 'RUNNING' },
            { id: 'crashed-commit', state: 'COMMITTING' },
            { id: 'live', state: 'RUNNING' },
          ]
        : [],
    updateMany: async (args) => {
      changes.push(args);
      return { count: 1 };
    },
    deleteMany: async () => {},
  };
  service.active.set('live', {});
  await service.sweep();
  assert(changes.some((c) => c.where.id === 'crashed-upload' && c.data.state === 'INTERRUPTED'));
  assert(changes.some((c) => c.where.id === 'crashed-commit' && c.data.state === 'RECONCILING'));
  assert(!changes.some((c) => c.where.id === 'live'));
  assert(changes.filter((c) => c.where.id).every((c) => c.where.leaseExpiresAt.lt instanceof Date));
});
test('unknown commit is successful only after NAS object identity AND byte length match', async () => {
  const { service, db } = harness();
  const changes = [];
  const row = {
    id: 'uncertain',
    userId: 'u',
    state: 'RECONCILING',
    objectId: '123',
    bindingVersion: 'v',
    expectedBytes: 12n,
    relativePath: 'target',
  };
  // Independent fixture credentials represent a single authorized user and binding.
  service.authorize = async () => ({ id: 'u' });
  service.bindings.get = async () => ({ binding: { version: 'v' }, credentials: {} });
  service.smb.call = async () => ({ objectId: '123', sizeBytes: '12' });
  db.downloadTicket = { deleteMany: async () => {} };
  db.fileOperation = {
    findMany: async (q) => (q.where.OR ? [row] : []),
    updateMany: async (q) => {
      changes.push(q);
    },
    deleteMany: async () => {},
  };
  await service.sweep();
  assert(changes.some((c) => c.where.id === 'uncertain' && c.data.state === 'SUCCEEDED'));
  changes.length = 0;
  service.smb.call = async () => ({ objectId: 'different', sizeBytes: '12' });
  await service.sweep();
  assert(!changes.some((c) => c.data.state === 'SUCCEEDED'));
});
test('the configured upload limit is enforced before starting any SMB write', async () => {
  const { service, user } = harness();
  await assert.rejects(
    service.createUpload(user, {
      parentPath: '',
      name: 'file.bin',
      size: String(service.config.maxUpload + 1),
      requestId: randomUUID(),
    }),
    code('SIZE_LIMIT'),
  );
});
test('new uploads persist Cove temporary paths', async () => {
  const { service, db, user } = harness();
  let saved;
  db.$transaction = async (fn) =>
    fn({
      $queryRaw: async () => [],
      fileOperation: {
        findUnique: async () => null,
        count: async () => 0,
        create: async ({ data }) => {
          saved = data;
          return { ...data, transferredBytes: 0n, createdAt: new Date() };
        },
      },
    });
  await service.createUpload(user, {
    parentPath: 'docs',
    name: 'test.txt',
    size: '0',
    requestId: randomUUID(),
  });
  assert.match(saved.tempPath, /^docs\/\.cove-upload-[0-9a-f-]+\.part$/);
});
test('cleanup visits only registered objects and retains failed identity checks', async () => {
  const { service, db } = harness();
  const calls = [],
    changes = [];
  const rows = ['.cove-upload-', '.COVE-UPLOAD-'].map((prefix, i) => ({
    id: String(i),
    userId: 'u',
    state: 'INTERRUPTED',
    objectId: 'registered',
    bindingVersion: 'v',
    tempPath: `${prefix}x.part`,
  }));
  service.authorize = async () => ({ id: 'u' });
  service.bindings.get = async () => ({ binding: { version: 'v' }, credentials: {} });
  service.smb.call = async (_, input) => {
    calls.push(input);
    if (input.path.startsWith('.COVE-')) throw filesError('OBJECT_CHANGED');
  };
  db.downloadTicket = { deleteMany: async () => {} };
  db.fileOperation = {
    findMany: async (q) => (q.where.OR ? rows : []),
    updateMany: async (q) => {
      changes.push(q);
    },
    deleteMany: async () => {},
  };
  await service.sweep();
  assert.equal(calls.length, 2);
  assert(calls.every((c) => c.action === 'cleanup' && c.objectId === 'registered'));
  assert(changes.some((c) => c.where.id === '0' && c.data.cleanupPending === false));
  assert(!changes.some((c) => c.where.id === '1'));
});
