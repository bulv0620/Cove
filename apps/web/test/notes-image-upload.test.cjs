/**
 * NOTE-FR-012/NOTE-FR-013/NOTE-NFR-008 request-contract tests: notes image
 * uploads always go through the existing hosting API with an explicit
 * publish request, and only a confirmed same-origin /image/{publicId} URL is
 * ever produced for the note body.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const PUBLIC_ID = 'A'.repeat(43);

function loadImageUploads(deps) {
  const context = {
    exports: {},
    require: (id) => {
      if (id.includes('images/api')) {
        return { imagesApi: deps.imagesApi, uploadImage: deps.uploadImage };
      }
      throw new Error(`unexpected require: ${id}`);
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, '../src/features/notes/image-uploads.ts'),
    'utf8',
  );
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  return context.exports;
}

function fakeFile(name, size) {
  return { name, size, type: 'image/png' };
}

function setup(options = {}) {
  const calls = { creates: [], uploads: [], cancels: [], progresses: [] };
  const imagesApi = {
    createUpload: (name, size, requestId, publish) => {
      calls.creates.push({ name, size, requestId, publish });
      return Promise.resolve({ id: 'op-1', name, state: 'PREPARING' });
    },
    cancelUpload: (id) => {
      calls.cancels.push(id);
      return Promise.resolve({ id, state: 'CANCELLED' });
    },
  };
  const uploadImage = (id, file, onProgress, signal) => {
    calls.uploads.push({ id, file });
    if (options.rejectUpload) {
      const error = new Error(options.rejectUpload);
      error.code = options.rejectUpload;
      return Promise.reject(error);
    }
    onProgress(options.loadedBytes ?? file.size);
    return Promise.resolve(
      options.image ?? { id: 'img-1', state: 'PUBLIC', publicUrl: `/image/${PUBLIC_ID}` },
    );
  };
  const module = loadImageUploads({ imagesApi, uploadImage });
  const upload = module.createNoteImageUpload(fakeFile('photo.png', 100), {
    uuid: () => 'req-uuid-1',
  });
  return { upload, calls };
}

test('uploads request publishing explicitly and return only /image/{publicId}', async () => {
  const { upload, calls } = setup();
  const progress = [];
  const result = await upload.run({
    onProgress: (ratio) => progress.push(ratio),
    signal: new AbortController().signal,
  });
  assert.deepEqual(
    { ...calls.creates[0], requestId: !!calls.creates[0].requestId },
    { name: 'photo.png', size: '100', requestId: true, publish: true },
    'publish must be requested explicitly for notes uploads',
  );
  assert.equal(calls.uploads[0].id, 'op-1');
  assert.deepEqual(progress, [1]);
  assert.equal(result.url, `/image/${PUBLIC_ID}`);
  assert.equal(calls.cancels.length, 0);
});

test('only supported, non-empty image files are accepted', () => {
  const module = loadImageUploads({ imagesApi: {}, uploadImage: () => Promise.resolve({}) });
  assert.equal(module.isSupportedImage(fakeFile('diagram.jpg', 10)), true);
  assert.equal(module.isSupportedImage(fakeFile('diagram.webp', 10)), true);
  assert.equal(module.isSupportedImage(fakeFile('notes.txt', 10)), false);
  assert.equal(module.isSupportedImage(fakeFile('empty.png', 0)), false);
  assert.equal(module.imageAltText('假期 照片.png'), '假期 照片');
  assert.equal(module.imageAltText('a[b]\\c.png'), 'a\\[b\\]\\\\c');
});

test('a lookalike or malformed public URL is rejected', async () => {
  const { upload } = setup({
    image: { id: 'img-1', state: 'PUBLIC', publicUrl: '/image/not-a-real-public-id/extra' },
  });
  await assert.rejects(
    () => upload.run({ onProgress: () => {}, signal: new AbortController().signal }),
    /FILES_FORBIDDEN/,
  );
});

test('an unconfirmed public grant fails instead of returning an address', async () => {
  const { upload, calls } = setup({ image: { id: 'img-1', state: 'PRIVATE', publicUrl: null } });
  await assert.rejects(
    () => upload.run({ onProgress: () => {}, signal: new AbortController().signal }),
    /FILES_FORBIDDEN/,
  );
  assert.equal(calls.cancels.length, 0);
});

test('transfer failures propagate their machine code for the UI', async () => {
  const { upload } = setup({ rejectUpload: 'SMB_DISK_FULL' });
  await assert.rejects(
    () => upload.run({ onProgress: () => {}, signal: new AbortController().signal }),
    /SMB_DISK_FULL/,
  );
});

test('a user abort cancels the pending hosting operation', async () => {
  const controller = new AbortController();
  const { upload, calls } = setup({ rejectUpload: 'TRANSFER_INTERRUPTED' });
  const run = upload.run({ onProgress: () => {}, signal: controller.signal });
  controller.abort();
  await assert.rejects(() => run, /TRANSFER_INTERRUPTED/);
  assert.deepEqual(calls.cancels, ['op-1']);
});
