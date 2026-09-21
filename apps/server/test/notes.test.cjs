const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
const { FilesConfig } = require('../dist/modules/files/files-config');
const { filesError } = require('../dist/modules/files/files-policy');
const { NotesConfig } = require('../dist/modules/notes/notes-config');
const { NotesService } = require('../dist/modules/notes/notes.service');
const {
  noteMarkdownPath,
  noteDirectoryPath,
  noteMarkdown,
  noteEntryName,
  isNoteMarkdownName,
  decodeMarkdown,
} = require('../dist/modules/notes/notes-policy');

const ROOT = 'Markdown Notes';
const SOURCE_BODY = Buffer.from('# 原始内容\n');
const SOURCE_MODIFIED = '2026-09-21T10:00:00.123+00:00';

const makeFilesConfig = () =>
  new FilesConfig({
    get: (key) =>
      ({
        SMB_ENABLED: 'true',
        SMB_HOST: 'nas.test',
        SMB_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString('base64'),
      })[key],
  });
const makeNotesConfig = (extra = {}) =>
  new NotesConfig({
    get: (key) => ({ SMB_CREDENTIAL_KEY: Buffer.alloc(32, 7).toString('base64'), ...extra })[key],
  });
const code = (expected) => (error) => error.getResponse().code === expected;
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

function makeUser(perms = ['workspace.notes.page', 'workspace.notes.update'], extra = {}) {
  return {
    id: randomUUID(),
    isSuperAdmin: false,
    mustChangePassword: false,
    authVersion: 1,
    permissions: perms,
    roleCodes: [],
    ...extra,
  };
}

function makeDb() {
  const operationRows = [];
  const auditRows = [];
  const unfinishedStates = ['PREPARING', 'COMMITTING', 'RECONCILING'];
  const terminalStates = ['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CONFLICT'];
  return {
    operationRows,
    auditRows,
    noteWriteOperation: {
      create: async ({ data }) => {
        const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
        operationRows.push(row);
        return row;
      },
      findUnique: async ({ where }) => {
        const key = where.userId_bindingVersion_requestId;
        return (
          operationRows.find(
            (row) =>
              row.userId === key.userId &&
              row.bindingVersion === key.bindingVersion &&
              row.requestId === key.requestId,
          ) ?? null
        );
      },
      findFirst: async ({ where }) =>
        operationRows.find(
          (row) => row.id === where.id && (!where.userId || row.userId === where.userId),
        ) ?? null,
      // Mirrors the real recovery query closely enough to catch mis-scoped picks.
      findMany: async () =>
        operationRows.filter(
          (row) =>
            (row.cleanupPending === true &&
              terminalStates.includes(row.state) &&
              row.errorCode !== 'BINDING_CHANGED') ||
            (unfinishedStates.includes(row.state) && row.leaseExpiresAt < new Date()),
        ),
      update: async ({ where, data }) => {
        const row = operationRows.find((item) => item.id === where.id);
        assert.ok(row, 'update targets missing row');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of operationRows) {
          const stateMatch =
            !where.state ||
            (where.state.in ? where.state.in.includes(row.state) : row.state === where.state);
          if (row.id === where.id && stateMatch) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      },
      deleteMany: async ({ where }) => {
        const before = operationRows.length;
        for (const row of [...operationRows]) {
          if (
            where.state.in.includes(row.state) &&
            !row.cleanupPending &&
            row.updatedAt < where.updatedAt.lt
          ) {
            operationRows.splice(operationRows.indexOf(row), 1);
          }
        }
        return { count: before - operationRows.length };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        auditRows.push(data);
        return data;
      },
    },
  };
}

function makeBindings() {
  const version = randomUUID();
  return {
    version,
    get: async () => ({
      binding: { version },
      credentials: { username: 'fake', password: 'fake' },
    }),
    summary: async () => ({
      enabled: true,
      bound: true,
      username: 'fake',
      version,
      state: 'SMB_OK',
      lastCheckedAt: null,
      share: 'home',
      domain: '',
    }),
  };
}

/** Scripted SmbAdapter double: `call` for metadata ops, `start` for read/write workers. */
function makeSmb(options = {}) {
  const state = {
    started: 0,
    chunks: [],
    committed: 0,
    cancelled: 0,
    cleaned: [],
    calls: [],
  };
  const entry = {
    name: 'a.md',
    relativePath: `${ROOT}/a.md`,
    type: 'file',
    sizeBytes: String(SOURCE_BODY.length),
    modifiedAt: SOURCE_MODIFIED,
    hidden: false,
    supported: true,
    objectId: 'source-obj-1',
  };
  const readHandle = (input, onEvent) => {
    const stream = new PassThrough();
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    setImmediate(async () => {
      try {
        const scripted = options.readResults?.shift();
        if (scripted?.error || options.readError)
          throw filesError(scripted?.error ?? options.readError);
        const body = scripted?.body ?? options.readBytes ?? SOURCE_BODY;
        await onEvent({
          ready: {
            name: 'a.md',
            relativePath: input.path,
            type: options.readyType ?? 'file',
            sizeBytes: options.readySize ?? String(body.length),
            modifiedAt: SOURCE_MODIFIED,
            hidden: false,
            supported: true,
            objectId: scripted?.objectId ?? 'source-obj-1',
          },
        });
        stream.write(body);
        stream.end();
        resolveDone({ bytes: String(body.length) });
      } catch (error) {
        stream.end();
        rejectDone(error);
      }
    });
    return {
      input: { write: () => true, end: () => {} },
      output: stream,
      done,
      commit: () => {},
      cancel: () => {
        state.cancelled++;
        rejectDone(filesError('TRANSFER_INTERRUPTED'));
      },
    };
  };
  const writeHandle = (onEvent) => {
    const stream = new PassThrough();
    stream.resume();
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    let resolveCommit;
    const commitGate = new Promise((resolve) => {
      resolveCommit = resolve;
    });
    const emitPrepared = async (body) => {
      await onEvent({ created: { objectId: 'temp-obj-1' } });
      await onEvent({
        prepared: { bytes: String(body.length), objectId: 'temp-obj-1', sha256: sha(body) },
      });
      await commitGate;
    };
    return {
      input: {
        write: (chunk) => {
          state.chunks.push(chunk);
          return true;
        },
        end: () => {
          setImmediate(async () => {
            try {
              const body = Buffer.concat(state.chunks);
              if (options.mode === 'conflict-at-pin') {
                // The worker rejects a stale pin before consuming stdin.
                rejectDone(filesError('OBJECT_CHANGED'));
              } else if (options.mode === 'created-then-fail') {
                await onEvent({ created: { objectId: 'temp-obj-1' } });
                rejectDone(filesError('TRANSFER_INTERRUPTED'));
              } else if (options.mode === 'name-conflict') {
                await emitPrepared(body);
                rejectDone(filesError('NAME_CONFLICT'));
              } else if (options.mode === 'create-ok') {
                await emitPrepared(body);
                resolveDone({ bytes: '0', objectId: 'temp-obj-1' });
              } else if (options.mode === 'residual') {
                await emitPrepared(body);
                resolveDone({
                  bytes: String(body.length),
                  objectId: 'new-obj-1',
                  sha256: sha(body),
                  sizeBytes: String(body.length),
                  modifiedAt: '2026-09-21T10:00:01.456+00:00',
                  residual: true,
                });
              } else {
                await emitPrepared(body);
                resolveDone({
                  bytes: String(body.length),
                  objectId: 'new-obj-1',
                  sha256: sha(body),
                  sizeBytes: String(body.length),
                  modifiedAt: '2026-09-21T10:00:01.456+00:00',
                });
              }
            } catch (error) {
              rejectDone(error ?? filesError('TRANSFER_INTERRUPTED'));
            }
          });
        },
      },
      output: stream,
      done,
      commit: () => {
        state.committed++;
        resolveCommit();
      },
      cancel: () => {
        state.cancelled++;
        rejectDone(filesError('TRANSFER_INTERRUPTED'));
      },
    };
  };
  return {
    state,
    entry,
    call: async (credentials, input) => {
      state.calls.push(input);
      if (input.action === 'cleanup') {
        state.cleaned.push(input);
        if (options.cleanupFails) throw filesError(options.cleanupFails);
        return true;
      }
      if (input.action === 'stat') {
        if (input.path === ROOT) {
          if (options.rootMissing) throw filesError('PATH_NOT_FOUND');
          if (options.rootConflict) return { ...entry, name: ROOT, type: 'file' };
          return { ...entry, name: ROOT, relativePath: ROOT, type: 'directory' };
        }
        if (options.statResults) {
          const next = options.statResults.shift();
          if (next) return next;
        }
        if (options.statError) throw filesError(options.statError);
        return { ...entry };
      }
      if (input.action === 'list') return options.list ?? [];
      if (input.action === 'mkdir')
        return {
          name: input.path.split('/').pop(),
          relativePath: input.path,
          type: 'directory',
          sizeBytes: '0',
          modifiedAt: SOURCE_MODIFIED,
          hidden: false,
          supported: true,
        };
      if (input.action === 'rename') return { ...entry, relativePath: input.targetPath };
      if (input.action === 'restore') {
        if (options.restoreError) throw filesError(options.restoreError);
        return { ...entry, relativePath: input.targetPath, objectId: input.objectId };
      }
      if (input.action === 'delete' || input.action === 'delete_object') return true;
      throw filesError('INVALID_OPERATION');
    },
    writeChunk: async (worker, chunk) => {
      if (!worker.input.write(chunk)) throw filesError('TRANSFER_INTERRUPTED');
    },
    start: (credentials, input, onEvent) => {
      state.started++;
      state.lastInput = input;
      if (input.action === 'read') return readHandle(input, onEvent);
      return writeHandle(onEvent);
    },
  };
}

function harness(options = {}, { permissions, userExtra } = {}) {
  const user = makeUser(permissions, userExtra);
  const config = makeNotesConfig();
  const filesConfig = makeFilesConfig();
  const db = makeDb();
  const permissionsService = { getAuthUser: async (id) => (id === user.id ? user : null) };
  const bindings = makeBindings();
  const smb = makeSmb(options);
  const service = new NotesService(db, permissionsService, bindings, smb, config, filesConfig);
  return { service, user, config, filesConfig, db, bindings, smb };
}

const silent = () => {};
const saveInput = (opened, markdown) => ({
  path: opened.path ?? 'a.md',
  markdown,
  expectedRevision: opened.revision,
  requestId: randomUUID(),
});

test('note paths stay inside the fixed root and reject reserved or unsupported names', () => {
  assert.equal(noteMarkdownPath('工作/项目计划.md'), '工作/项目计划.md');
  assert.equal(noteMarkdownPath('A.MD'), 'A.MD');
  assert.equal(noteDirectoryPath(''), '');
  assert.equal(noteDirectoryPath('工作'), '工作');
  for (const bad of [
    '',
    '目录/',
    'notes.txt',
    'a//b.md',
    '../a.md',
    'a/../b.md',
    '/a.md',
    'C:/a.md',
    'a\\b.md',
    'a:b.md',
    '.cove-note-x.part',
    '目录/.cove-note-x.part/a.md',
  ])
    assert.throws(() => noteMarkdownPath(bad), bad);
  for (const bad of ['../x', 'x/../y', '.cove-note-x', 'a\\b', 'a:'])
    assert.throws(() => noteDirectoryPath(bad), bad);
  assert.throws(() => noteEntryName('.cove-note-x.part'), code('INVALID_PATH'));
  assert.throws(() => noteEntryName('.cove-upload-x.part'), code('INVALID_PATH'));
  assert.equal(noteEntryName('未命名笔记.md'), '未命名笔记.md');
});

test('markdown bodies reject control characters, lone surrogates and oversize content', () => {
  const max = 1024;
  assert.equal(noteMarkdown('# 计划 🏠\r\n- a\tb\n', max), '# 计划 🏠\r\n- a\tb\n');
  assert.throws(() => noteMarkdown('a\u0000b', max), code('NOTE_INVALID_CONTENT'));
  assert.throws(() => noteMarkdown('a\u0007b', max), code('NOTE_INVALID_CONTENT'));
  assert.throws(() => noteMarkdown('a\u007fb', max), code('NOTE_INVALID_CONTENT'));
  assert.throws(() => noteMarkdown('bad \uD800 surrogate', max), code('NOTE_INVALID_CONTENT'));
  assert.throws(() => noteMarkdown('x'.repeat(1025), max), code('NOTE_TOO_LARGE'));
  assert.throws(() => noteMarkdown(42, max), code('INVALID_INPUT'));
});

test('readback requires strict UTF-8 and reserved names never count as notes', () => {
  assert.throws(
    () => decodeMarkdown(Buffer.from([0xff, 0xfe, 0x01])),
    code('NOTE_INVALID_CONTENT'),
  );
  assert.equal(
    decodeMarkdown(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# a')])),
    '# a',
  );
  assert.throws(() => decodeMarkdown(Buffer.from('a\0b')), code('NOTE_INVALID_CONTENT'));
  assert.equal(isNoteMarkdownName('a.md'), true);
  assert.equal(isNoteMarkdownName('.hidden.md'), false);
  assert.equal(isNoteMarkdownName('.cove-note-x.part'), false);
  assert.equal(isNoteMarkdownName('a.txt'), false);
});

test('notes configuration fails closed on bad roots or limits and derives a stable secret', () => {
  assert.equal(makeNotesConfig().root, ROOT);
  assert.equal(makeNotesConfig().absolute('a/b.md'), `${ROOT}/a/b.md`);
  for (const bad of [
    { NOTES_ROOT_DIR: '../evil' },
    { NOTES_ROOT_DIR: 'a/b' },
    { NOTES_ROOT_DIR: 'x ' },
    { NOTES_ROOT_DIR: '.hidden' },
    { NOTES_MAX_NOTE_BYTES: '0' },
    { NOTES_OPERATION_LEASE_MS: '5' },
    { NOTES_MAX_DIRECTORY_ENTRIES: '50001' },
    { NOTES_MAX_NOTE_BYTES: '52428801' },
  ])
    assert.throws(() => makeNotesConfig(bad));
});

test('authorization gates page access, per-action rights and forced password resets', async () => {
  const nobody = harness({}, { permissions: [] });
  await assert.rejects(nobody.service.status(nobody.user), code('FILES_FORBIDDEN'));
  await assert.rejects(nobody.service.entries(nobody.user, { path: '' }), code('FILES_FORBIDDEN'));
  const outsider = harness();
  await assert.rejects(outsider.service.status({ id: randomUUID() }), code('AUTH_EXPIRED'));
  const locked = harness(
    {},
    {
      permissions: ['workspace.notes.page', 'workspace.notes.update'],
      userExtra: { mustChangePassword: true },
    },
  );
  await assert.rejects(locked.service.status(locked.user), code('FILES_FORBIDDEN'));
  const viewer = harness({}, { permissions: ['workspace.notes.page'] });
  const opened = await viewer.service.content(viewer.user, { path: 'a.md' });
  await assert.rejects(
    viewer.service.save(viewer.user, saveInput(opened, '# x\n')),
    code('FILES_FORBIDDEN'),
  );
  const superuser = harness({}, { permissions: [], userExtra: { isSuperAdmin: true } });
  const status = await superuser.service.status(superuser.user);
  assert.deepEqual(status.capabilities, { create: true, update: true, rename: true, delete: true });
});

test('status reports root, size limit and per-action capabilities', async () => {
  const { service, user, config } = harness();
  const status = await service.status(user);
  assert.equal(status.rootPath, config.root);
  assert.equal(status.maxNoteBytes, String(config.maxNoteBytes));
  assert.equal(status.bound, true);
  assert.deepEqual(status.capabilities, {
    create: false,
    update: true,
    rename: false,
    delete: false,
  });
});

test('listing filters to directories and markdown notes without reading bodies', async () => {
  const listed = [
    {
      name: '工作',
      relativePath: `${ROOT}/工作`,
      type: 'directory',
      sizeBytes: '0',
      modifiedAt: SOURCE_MODIFIED,
      hidden: false,
      supported: true,
    },
    {
      name: 'note.md',
      relativePath: `${ROOT}/note.md`,
      type: 'file',
      sizeBytes: '12',
      modifiedAt: SOURCE_MODIFIED,
      hidden: false,
      supported: true,
    },
    {
      name: 'readme.txt',
      type: 'file',
      sizeBytes: '3',
      modifiedAt: SOURCE_MODIFIED,
      hidden: false,
      supported: true,
    },
    {
      name: '.secret.md',
      type: 'file',
      sizeBytes: '3',
      modifiedAt: SOURCE_MODIFIED,
      hidden: true,
      supported: true,
    },
    {
      name: '.cove-note-x.part',
      type: 'file',
      sizeBytes: '3',
      modifiedAt: SOURCE_MODIFIED,
      hidden: false,
      supported: true,
    },
    {
      name: 'broken.md',
      type: 'file',
      sizeBytes: '3',
      modifiedAt: SOURCE_MODIFIED,
      hidden: false,
      supported: false,
    },
  ];
  const { service, user, smb } = harness({ list: listed });
  const page = await service.entries(user, { path: '' });
  assert.deepEqual(
    page.entries.map((item) => item.name),
    ['工作', 'note.md'],
  );
  // Worker paths are share-relative; the API hands back root-relative paths
  // so a second request never doubles the fixed root prefix.
  assert.deepEqual(
    page.entries.map((item) => item.relativePath),
    ['工作', 'note.md'],
  );
  assert.equal(page.path, '');
  assert.equal(page.total, 2);
  assert.equal(page.nextCursor, null);
  const rest = await service.entries(user, { path: '', cursor: '1' });
  assert.deepEqual(
    rest.entries.map((item) => item.name),
    ['note.md'],
  );
  await assert.rejects(service.entries(user, { path: '', cursor: '-3' }), code('INVALID_INPUT'));
  // Only the root check and the listing ever touch the NAS; bodies stay unread.
  assert.deepEqual([...new Set(smb.state.calls.map((call) => call.action))], ['stat', 'list']);
});

test('ensureRoot creates a missing root and refuses a foreign root object', async () => {
  const created = harness({ rootMissing: true });
  await created.service.entries(created.user, { path: '' });
  assert.deepEqual(
    created.smb.state.calls.map((call) => call.action),
    ['stat', 'mkdir', 'list'],
  );
  const failing = harness();
  failing.smb.call = async (credentials, input) => {
    if (input.action === 'stat' && input.path === ROOT) throw filesError('PATH_NOT_FOUND');
    if (input.action === 'mkdir') throw filesError('NAME_CONFLICT');
    if (input.action === 'stat') return { type: 'file' };
    return [];
  };
  await assert.rejects(
    failing.service.entries(failing.user, { path: '' }),
    code('NOTE_ROOT_CONFLICT'),
  );
});

test('content reads strict UTF-8 bodies, signs a revision and enforces the size cap', async () => {
  const { service, user, config } = harness();
  const content = await service.content(user, { path: 'a.md' });
  assert.equal(content.path, 'a.md');
  assert.equal(content.markdown, '# 原始内容\n');
  assert.equal(content.sizeBytes, String(SOURCE_BODY.length));
  assert.equal(content.modifiedAt, SOURCE_MODIFIED);
  assert.match(content.revision, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(config.absolute('a.md'), `${ROOT}/a.md`);

  const bom = harness({
    readBytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# a\n')]),
  });
  assert.equal((await bom.service.content(bom.user, { path: 'a.md' })).markdown, '# a\n');

  const invalid = harness({ readBytes: Buffer.from([0xff, 0xfe, 0x01]), readySize: '3' });
  await assert.rejects(
    invalid.service.content(invalid.user, { path: 'a.md' }),
    code('NOTE_INVALID_CONTENT'),
  );

  const oversized = harness({ readySize: String(5_242_881) });
  await assert.rejects(
    oversized.service.content(oversized.user, { path: 'a.md' }),
    code('NOTE_TOO_LARGE'),
  );

  const folder = harness({ readyType: 'directory' });
  await assert.rejects(
    folder.service.content(folder.user, { path: 'a.md' }),
    code('NOTE_UNSUPPORTED_TYPE'),
  );
});

test('save writes through the registered temp, records the operation and returns a verifiable revision', async () => {
  const { service, user, db, smb } = harness();
  const opened = await service.content(user, { path: 'a.md' });
  const canary = `canary-${randomUUID()}`;
  const saved = await service.save(user, saveInput(opened, `# 更新 ${canary}\n`));
  assert.equal(saved.saved, true);
  assert.equal(saved.path, 'a.md');
  assert.match(saved.revision, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(saved.sizeBytes, String(Buffer.byteLength(`# 更新 ${canary}\n`)));
  assert.equal(saved.modifiedAt, '2026-09-21T10:00:01.456+00:00');
  const row = db.operationRows[0];
  assert.equal(row.state, 'SUCCEEDED');
  assert.equal(row.targetObjectId, 'new-obj-1');
  assert.equal(row.targetModifiedRaw, '2026-09-21T10:00:01.456+00:00');
  assert.equal(row.sourceSha256, sha(SOURCE_BODY));
  assert.match(row.backupPath, /^\.cove-note-[0-9a-f-]{36}\.prev\.part$/);
  assert.match(
    smb.state.lastInput.backupPath,
    /^Markdown Notes\/\.cove-note-[0-9a-f-]{36}\.prev\.part$/,
  );
  assert.equal(smb.state.lastInput.action, 'write_note');
  assert.equal(smb.state.committed, 1);
  assert.equal(smb.state.cleaned.length, 0);
  assert.equal(Buffer.concat(smb.state.chunks).toString('utf8'), `# 更新 ${canary}\n`);
  const audit = db.auditRows.find((item) => item.action === 'notes.save');
  assert.equal(audit.result, 'SUCCESS');
  assert.ok(!JSON.stringify(db.auditRows).includes(canary), 'bodies never reach audit rows');
});

test('save skips unchanged content without touching SMB or the operation table', async () => {
  const { service, user, db, smb } = harness();
  const opened = await service.content(user, { path: 'a.md' });
  const result = await service.save(user, saveInput(opened, opened.markdown));
  assert.equal(result.saved, false);
  assert.equal(result.revision, opened.revision);
  assert.equal(result.operationId, null);
  assert.equal(result.sizeBytes, opened.sizeBytes);
  assert.equal(result.modifiedAt, opened.modifiedAt);
  assert.equal(smb.state.started, 1); // only the content read
  assert.equal(db.operationRows.length, 0);
});

test('save rejects a stale revision with NOTE_CHANGED and never overwrites the target', async () => {
  const { service, user, db, smb } = harness({ mode: 'conflict-at-pin' });
  const opened = await service.content(user, { path: 'a.md' });
  await assert.rejects(service.save(user, saveInput(opened, '# new\n')), code('NOTE_CHANGED'));
  assert.equal(smb.state.committed, 0);
  const row = db.operationRows[0];
  assert.equal(row.state, 'CONFLICT');
  assert.equal(row.cleanupPending, false);
  const audit = db.auditRows.find((item) => item.action === 'notes.save');
  assert.equal(audit.result, 'FAILURE');
  assert.deepEqual(audit.metadata, { code: 'OBJECT_CHANGED' });
});

test('save detects cross-path revisions and tampered tokens', async () => {
  const { service, user } = harness();
  const opened = await service.content(user, { path: 'a.md' });
  await assert.rejects(
    service.save(user, { ...saveInput(opened, '# x\n'), path: 'other.md' }),
    code('NOTE_CHANGED'),
  );
  await assert.rejects(
    service.save(user, { ...saveInput(opened, '# x\n'), expectedRevision: 'garbage' }),
    code('INVALID_INPUT'),
  );
  const [body, signature] = opened.revision.split('.');
  const tampered = Buffer.from(body, 'base64url')
    .toString('utf8')
    .replace('source-obj-1', 'other-obj');
  await assert.rejects(
    service.save(user, {
      ...saveInput(opened, '# x\n'),
      expectedRevision: `${Buffer.from(tampered).toString('base64url')}.${signature}`,
    }),
    code('INVALID_INPUT'),
  );
});

test('replaying a requestId is idempotent and never starts a second replace', async () => {
  const { service, user, db, smb } = harness();
  const opened = await service.content(user, { path: 'a.md' });
  const requestId = randomUUID();
  const first = await service.save(user, {
    path: 'a.md',
    markdown: '# twice\n',
    expectedRevision: opened.revision,
    requestId,
  });
  const before = smb.state.started;
  const replay = await service.save(user, {
    path: 'a.md',
    markdown: '# twice\n',
    expectedRevision: opened.revision,
    requestId,
  });
  assert.equal(replay.saved, true);
  assert.equal(replay.revision, first.revision);
  assert.equal(smb.state.started, before);
  await assert.rejects(
    service.save(user, {
      path: 'a.md',
      markdown: '# different body\n',
      expectedRevision: opened.revision,
      requestId,
    }),
    code('INVALID_INPUT'),
  );
  const row = db.operationRows[0];
  row.state = 'CONFLICT';
  row.errorCode = 'OBJECT_CHANGED';
  await assert.rejects(
    service.save(user, {
      path: 'a.md',
      markdown: '# twice\n',
      expectedRevision: opened.revision,
      requestId,
    }),
    code('NOTE_CHANGED'),
  );
  row.state = 'COMMITTING';
  await assert.rejects(
    service.save(user, {
      path: 'a.md',
      markdown: '# twice\n',
      expectedRevision: opened.revision,
      requestId,
    }),
    code('FILE_BUSY'),
  );
});

test('a conflict before the temp exists marks CONFLICT with the original body intact', async () => {
  const { service, user, db } = harness({ mode: 'conflict-at-pin' });
  const opened = await service.content(user, { path: 'a.md' });
  await assert.rejects(service.save(user, saveInput(opened, '# conflict\n')), code('NOTE_CHANGED'));
  const row = db.operationRows[0];
  assert.equal(row.state, 'CONFLICT');
  assert.equal(row.sourceSha256, sha(SOURCE_BODY));
  assert.equal(row.targetSizeBytes, BigInt(Buffer.byteLength('# conflict\n')));
});

test('a staged temp identity is durable even when transfer fails before prepared', async () => {
  const { service, user, db, smb } = harness({ mode: 'created-then-fail' });
  const opened = await service.content(user, { path: 'a.md' });
  await assert.rejects(
    service.save(user, saveInput(opened, '# interrupted\n')),
    code('TRANSFER_INTERRUPTED'),
  );
  const row = db.operationRows[0];
  assert.equal(row.targetObjectId, 'temp-obj-1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(smb.state.cleaned.at(-1).objectId, 'temp-obj-1');
});

test('recover reconciles committed operations from SMB facts alone', async () => {
  const body = Buffer.from('# recovered\n');
  const base = async (statResult, mode = 'ok', restoreError = null) => {
    const options = {
      mode,
      readResults: [{ body: SOURCE_BODY, objectId: 'source-obj-1' }],
    };
    if (statResult === 'NOT_FOUND') options.readResults.push({ error: 'PATH_NOT_FOUND' });
    else if (statResult)
      options.readResults.push({
        body: statResult.body ?? (statResult.objectId === 'temp-obj-1' ? body : SOURCE_BODY),
        objectId: statResult.objectId,
      });
    if (restoreError) options.restoreError = restoreError;
    const context = harness(options);
    const { service, user, db } = context;
    const opened = await service.content(user, { path: 'a.md' });
    await service.save(user, saveInput(opened, '# recovered\n')).catch(silent);
    const row = db.operationRows[0];
    row.state = 'COMMITTING';
    row.leaseExpiresAt = new Date(Date.now() - 1000);
    row.targetObjectId = 'temp-obj-1';
    row.targetSizeBytes = BigInt(body.length);
    await service.recover();
    return { row, context };
  };
  // The replace landed: the stored identity matches the registered temp.
  const landed = await base({
    type: 'file',
    objectId: 'temp-obj-1',
    sizeBytes: String(body.length),
  });
  assert.equal(landed.row.state, 'SUCCEEDED');
  assert.equal(landed.row.errorCode, null);
  assert.equal(landed.row.targetModifiedRaw, SOURCE_MODIFIED);
  // The replace never landed: the source identity is intact.
  const intact = await base(
    { type: 'file', objectId: 'source-obj-1', sizeBytes: String(SOURCE_BODY.length) },
    'conflict-at-pin',
  );
  assert.equal(intact.row.state, 'INTERRUPTED');
  assert.equal(intact.row.errorCode, 'TRANSFER_INTERRUPTED');
  // A vacant path after an interrupted swap restores the registered backup.
  const vanished = await base('NOT_FOUND', 'conflict-at-pin');
  assert.equal(vanished.row.state, 'INTERRUPTED');
  assert.equal(vanished.row.errorCode, 'TRANSFER_INTERRUPTED');
  const restoreCall = vanished.context.smb.state.calls.find((call) => call.action === 'restore');
  assert.match(restoreCall.path, /\.prev\.part$/);
  assert.equal(restoreCall.objectId, 'source-obj-1');
  // A squatter holding the name stays a conflict and keeps the backup on the NAS.
  const occupied = await base('NOT_FOUND', 'conflict-at-pin', 'NAME_CONFLICT');
  assert.equal(occupied.row.state, 'CONFLICT');
  assert.equal(occupied.row.errorCode, 'PATH_NOT_FOUND');
  // Matching identity and length are insufficient if the bytes changed in place.
  const tampered = await base({
    type: 'file',
    objectId: 'temp-obj-1',
    sizeBytes: String(body.length),
    body: Buffer.from('# tampered!\n'),
  });
  assert.equal(tampered.row.state, 'CONFLICT');
});

test('a residual backup after success is cleaned by the registered source identity', async () => {
  const { service, user, db, smb } = harness({ mode: 'residual' });
  const opened = await service.content(user, { path: 'a.md' });
  const saved = await service.save(user, saveInput(opened, '# kept\n'));
  assert.equal(saved.saved, true);
  const row = db.operationRows[0];
  assert.equal(row.state, 'SUCCEEDED');
  assert.equal(row.cleanupPending, true);
  await service.recover();
  // The temp identity (now the landed note) is a benign no-op; the backup is
  // removed by the registered source identity.
  assert.deepEqual(smb.state.cleaned.map((call) => call.objectId).sort(), [
    'new-obj-1',
    'source-obj-1',
  ]);
  assert.equal(row.cleanupPending, false);
});

test('recovery parks operations when the binding changed underneath', async () => {
  const context = harness({ mode: 'conflict-at-pin' });
  const { service, user, db, bindings } = context;
  const opened = await service.content(user, { path: 'a.md' });
  await service.save(user, saveInput(opened, '# lost\n')).catch(silent);
  const row = db.operationRows[0];
  row.state = 'COMMITTING';
  row.leaseExpiresAt = new Date(Date.now() - 1000);
  bindings.get = async () => {
    throw filesError('SMB_NOT_BOUND');
  };
  await service.recover();
  assert.equal(row.state, 'INTERRUPTED');
  assert.equal(row.errorCode, 'BINDING_CHANGED');
});

test('expired preparing operations fail closed and temps are cleaned only by registered identity', async () => {
  const context = harness();
  const { service, user, db, smb } = context;
  const opened = await service.content(user, { path: 'a.md' });
  await service.save(user, saveInput(opened, '# preparing\n'));
  const row = db.operationRows[0];
  row.state = 'PREPARING';
  row.leaseExpiresAt = new Date(Date.now() - 1000);
  row.targetObjectId = 'temp-obj-1';
  row.cleanupPending = true;
  await service.recover();
  assert.deepEqual(smb.state.cleaned.map((call) => call.objectId).sort(), [
    'source-obj-1',
    'temp-obj-1',
  ]);
  assert.equal(row.cleanupPending, false);
  await service.recover();
  assert.equal(row.state, 'FAILED');
  // An identity the NAS no longer knows is dropped from the ledger, not retried forever.
  row.state = 'PREPARING';
  row.cleanupPending = true;
  smb.call = async (credentials, input) => {
    if (input.action === 'cleanup') {
      smb.state.cleaned.push(input);
      throw filesError('OBJECT_CHANGED');
    }
    throw filesError('SMB_TIMEOUT');
  };
  await service.recover();
  assert.equal(row.state, 'PREPARING');
  assert.equal(row.cleanupPending, false);
});

test('recovery never cleans a live unfinished operation merely because a temp is registered', async () => {
  const { service, user, db, smb } = harness();
  const opened = await service.content(user, { path: 'a.md' });
  await service.save(user, saveInput(opened, '# live\n'));
  const row = db.operationRows[0];
  row.state = 'PREPARING';
  row.cleanupPending = true;
  row.leaseExpiresAt = new Date(Date.now() + 60_000);
  await service.recover();
  assert.equal(row.state, 'PREPARING');
  assert.equal(row.cleanupPending, true);
  assert.equal(smb.state.cleaned.length, 0);
});

test('createFile commits an empty note and registers the temp before the replace', async () => {
  const { service, user, db, smb } = harness(
    { mode: 'create-ok' },
    { permissions: ['workspace.notes.page', 'workspace.notes.create'] },
  );
  const result = await service.createFile(user, { path: '工作/未命名笔记.md' });
  assert.equal(result.path, '工作/未命名笔记.md');
  assert.equal(smb.state.lastInput.noteTemp, true);
  assert.equal(smb.state.lastInput.path, `${ROOT}/工作/未命名笔记.md`);
  assert.match(
    smb.state.lastInput.tempPath,
    /^Markdown Notes\/工作\/\.cove-note-[0-9a-f-]{36}\.part$/,
  );
  const row = db.operationRows[0];
  // A committed create settles immediately; it must not park as an unfinished
  // operation until the lease expires.
  assert.equal(row.state, 'SUCCEEDED');
  assert.equal(row.cleanupPending, false);
  assert.equal(row.targetObjectId, 'temp-obj-1');
  assert.equal(smb.state.committed, 1);
  const audit = db.auditRows.find((item) => item.action === 'notes.create');
  assert.equal(audit.result, 'SUCCESS');
});

test('createFile collides safely with an existing note and parks the operation for recovery', async () => {
  const { service, user, db, smb } = harness(
    { mode: 'name-conflict' },
    { permissions: ['workspace.notes.page', 'workspace.notes.create'] },
  );
  await assert.rejects(service.createFile(user, { path: 'a.md' }), code('NAME_CONFLICT'));
  await new Promise((resolve) => setImmediate(resolve));
  const row = db.operationRows[0];
  assert.equal(row.state, 'RECONCILING');
  assert.equal(row.cleanupPending, false);
  assert.equal(row.errorCode, 'NAME_CONFLICT');
  assert.equal(smb.state.committed, 1);
  assert.equal(smb.state.cleaned.at(-1).objectId, 'temp-obj-1');
});

test('folders, renames and deletes enforce the dialect boundary and audit with path digests only', async () => {
  const { service, user, db, smb } = harness(
    {},
    {
      permissions: [
        'workspace.notes.page',
        'workspace.notes.create',
        'workspace.notes.rename',
        'workspace.notes.delete',
      ],
    },
  );
  await service.createFolder(user, { path: '工作/2026' });
  assert.equal(smb.state.calls.at(-1).action, 'mkdir');
  await assert.rejects(service.createFolder(user, { path: '' }), code('INVALID_INPUT'));
  await assert.rejects(
    service.rename(user, {
      path: 'a.md',
      newName: 'b.txt',
      objectId: 'source-obj-1',
    }),
    code('NOTE_UNSUPPORTED_TYPE'),
  );
  await assert.rejects(
    service.rename(user, { path: 'a.md', newName: 'b.md' }),
    code('INVALID_INPUT'),
  );
  const renamed = await service.rename(user, {
    path: 'a.md',
    newName: 'b.md',
    objectId: 'source-obj-1',
  });
  assert.equal(renamed.type, 'file');
  assert.equal(renamed.relativePath, 'b.md');
  const lastRename = smb.state.calls.at(-1);
  assert.equal(lastRename.action, 'rename');
  assert.equal(lastRename.path, `${ROOT}/a.md`);
  assert.equal(lastRename.targetPath, `${ROOT}/b.md`);
  assert.equal(lastRename.objectId, 'source-obj-1');
  // A stale listing must never rename an impostor placed at the old path.
  await assert.rejects(
    service.rename(user, { path: 'a.md', newName: 'b.md', objectId: 'impostor' }),
    code('NOTE_CHANGED'),
  );
  await service.remove(user, { path: 'a.md', objectId: 'source-obj-1' });
  const lastDelete = smb.state.calls.at(-1);
  assert.equal(lastDelete.action, 'delete_object');
  assert.equal(lastDelete.objectId, 'source-obj-1');
  await assert.rejects(
    service.remove(user, { path: 'a.md', objectId: 'impostor' }),
    code('NOTE_CHANGED'),
  );
  await assert.rejects(service.remove(user, { path: 'a.md' }), code('INVALID_INPUT'));
  const digestOnly = db.auditRows
    .filter((item) => ['notes.rename', 'notes.delete', 'notes.folder.create'].includes(item.action))
    .every((item) => /^[0-9a-f]{32}$/.test(item.targetId ?? ''));
  assert.equal(digestOnly, true);
  assert.ok(!JSON.stringify(db.auditRows).includes('a.md'), 'paths never reach audit rows');
});

test('operation status is owner-scoped', async () => {
  const { service, user, db } = harness();
  await assert.rejects(service.operation(user, 'missing'), code('OPERATION_NOT_FOUND'));
  db.noteWriteOperation.create({
    data: {
      id: 'op-1',
      userId: user.id,
      bindingVersion: 'v',
      configFingerprint: 'f',
      authVersion: 1,
      requestId: 'r',
      relativePath: 'a.md',
      tempPath: 't',
      state: 'SUCCEEDED',
      cleanupPending: false,
      leaseExpiresAt: new Date(),
    },
  });
  const summary = await service.operation(user, 'op-1');
  assert.equal(summary.id, 'op-1');
  assert.equal(summary.state, 'SUCCEEDED');
  assert.equal(summary.cleanupPending, false);
});

test('terminal records are retained only for the configured retention window', async () => {
  const { service, user, db } = harness();
  const opened = await service.content(user, { path: 'a.md' });
  await service.save(user, saveInput(opened, '# old\n'));
  const row = db.operationRows[0];
  assert.equal(row.state, 'SUCCEEDED');
  row.updatedAt = new Date(Date.now() - 90 * 86_400_000);
  await service.recover();
  assert.equal(db.operationRows.length, 0);
});

test('a save reports the committed object identity that rename and delete need', async () => {
  const options = { statResults: [] };
  const { service, user } = harness(options, {
    permissions: [
      'workspace.notes.page',
      'workspace.notes.update',
      'workspace.notes.rename',
      'workspace.notes.delete',
    ],
  });
  const opened = await service.content(user, { path: 'a.md' });
  const saved = await service.save(user, saveInput(opened, '# 更新\n\nbody\n'));
  assert.equal(saved.saved, true);
  assert.equal(
    saved.objectId,
    'new-obj-1',
    'the identity of the object that now holds the note, not the replaced one',
  );

  // Saving replaces the file, so the entry a listing held before it is stale.
  const committed = { ...entryShape(saved) };
  options.statResults.push({ ...committed });
  await assert.rejects(
    service.rename(user, { path: 'a.md', newName: 'b.md', objectId: 'source-obj-1' }),
    code('NOTE_CHANGED'),
  );

  // The identity the save returned is the one that works.
  options.statResults.push({ ...committed });
  const renamed = await service.rename(user, {
    path: 'a.md',
    newName: 'b.md',
    objectId: saved.objectId,
  });
  assert.equal(renamed.relativePath, 'b.md');
  options.statResults.push({ ...committed });
  await service.remove(user, { path: 'a.md', objectId: saved.objectId });
});

/** The listing entry for a.md as it looks after the save above. */
function entryShape(saved) {
  return {
    name: 'a.md',
    relativePath: `${ROOT}/a.md`,
    type: 'file',
    sizeBytes: saved.sizeBytes,
    modifiedAt: saved.modifiedAt,
    hidden: false,
    supported: true,
    objectId: saved.objectId,
  };
}

test('the notes root is verified once per window, not on every request', async () => {
  const { service, user, smb } = harness();
  await service.entries(user, { path: '' });
  assert.equal(
    smb.state.calls.filter((call) => call.action === 'stat').length,
    1,
    'the first request checks the root before listing',
  );

  smb.state.calls.length = 0;
  await service.entries(user, { path: '' });
  await service.entries(user, { path: '工作' });
  // Every SMB call is a fresh worker process and a fresh session, so the
  // repeated root check used to double the cost of every Notes request.
  assert.deepEqual(
    smb.state.calls.map((call) => call.action),
    ['list', 'list'],
    'requests inside the window skip the redundant root check',
  );
});
