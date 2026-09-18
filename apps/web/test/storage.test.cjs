const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness(entries = {}, failure) {
  const data = new Map(Object.entries(entries));
  const storage = Object.fromEntries(
    ['getItem', 'setItem', 'removeItem'].map((method) => [
      method,
      (key, value) => {
        if (failure === method) throw new Error('storage unavailable');
        if (method === 'getItem') return data.get(key) ?? null;
        if (method === 'setItem') data.set(key, value);
        if (method === 'removeItem') data.delete(key);
      },
    ]),
  );
  const context = { exports: {}, localStorage: storage };
  const source = fs.readFileSync(
    require('node:path').join(__dirname, '../src/lib/storage.ts'),
    'utf8',
  );
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  return { ...context.exports, data, storage };
}
test('Cove token and preferences are read and written without migrating other keys', () => {
  for (const suffix of ['access-token', 'language', 'theme', 'files.view.user-a']) {
    const h = harness({ [`other.${suffix}`]: 'unrelated' });
    assert.equal(h.readStored(`cove.${suffix}`), null);
    h.writeStored(`cove.${suffix}`, 'value');
    assert.equal(h.readStored(`cove.${suffix}`), 'value');
    assert.equal(h.data.get(`other.${suffix}`), 'unrelated');
  }
});
test('missing and per-user settings do not inherit another user preference', () => {
  const h = harness({ 'cove.files.view.a': 'grid' });
  assert.equal(h.readStored('cove.files.view.b'), null);
  assert.equal(h.readStored('cove.files.view.a'), 'grid');
});
test('unavailable storage does not crash initialization and writes fall back to memory', () => {
  const h = harness({ 'cove.theme': 'dark' }, 'setItem');
  assert.equal(h.readStored('cove.theme'), 'dark');
  assert.equal(harness({}, 'getItem').readStored('cove.theme'), null);
  h.writeStored('cove.theme', 'light');
  assert.equal(h.readStored('cove.theme'), 'light');
});
test('logout stays effective in this page even when storage removal fails', () => {
  for (const failure of [undefined, 'removeItem']) {
    const h = harness({ 'cove.access-token': 'new' }, failure);
    h.clearStored('cove.access-token');
    assert.equal(h.readStored('cove.access-token'), null);
    if (!failure) assert.equal(h.data.size, 0);
    h.writeStored('cove.access-token', 'fresh');
    assert.equal(h.readStored('cove.access-token'), 'fresh');
  }
});
test('API 401 and explicit logout clear the Cove token and dispatch its event', async () => {
  const h = harness({ 'cove.access-token': 'expired' });
  const events = [];
  const context = {
    exports: {},
    require: () => h,
    Headers,
    Event,
    window: { dispatchEvent: (event) => events.push(event.type) },
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  };
  const source = fs
    .readFileSync(require('node:path').join(__dirname, '../src/lib/api.ts'), 'utf8')
    .replace(/import\.meta\.env\.VITE_API_URL/g, 'undefined');
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  await assert.rejects(context.exports.apiRequest('/api/auth/me'));
  assert.equal(h.readStored('cove.access-token'), null);
  assert.equal(h.data.size, 0);
  assert.deepEqual(events, ['cove:unauthorized']);
  context.exports.tokenStorage.set('new');
  context.exports.tokenStorage.clear();
  assert.equal(h.readStored('cove.access-token'), null);
});
