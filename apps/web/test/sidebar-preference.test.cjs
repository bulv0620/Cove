const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPreference(storedValue = null) {
  const writes = [];
  const context = {
    exports: {},
    require: () => ({
      readStored: () => storedValue,
      writeStored: (key, value) => writes.push([key, value]),
    }),
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/sidebar-preference.ts'), 'utf8');
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  return { ...context.exports, writes };
}

test('sidebar defaults to expanded and accepts only the stored true value', () => {
  assert.equal(loadPreference().readSidebarCollapsed(), false);
  assert.equal(loadPreference('false').readSidebarCollapsed(), false);
  assert.equal(loadPreference('invalid').readSidebarCollapsed(), false);
  assert.equal(loadPreference('true').readSidebarCollapsed(), true);
});

test('sidebar writes a namespaced boolean preference', () => {
  const preference = loadPreference();
  preference.writeSidebarCollapsed(true);
  preference.writeSidebarCollapsed(false);
  assert.deepEqual(preference.writes, [
    ['cove.sidebar.collapsed', 'true'],
    ['cove.sidebar.collapsed', 'false'],
  ]);
});
