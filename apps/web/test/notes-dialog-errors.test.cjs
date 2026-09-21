/**
 * Review-fix regression: the notes dialog used to pick its mutation with an
 * isPending chain, so a failed create/rename immediately fell back to the
 * delete mutation and the dialog never showed the error. The dialog kind must
 * own the mutation, and rename/delete must pass the listed object identity so
 * a stale listing cannot act on a replaced NAS object.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageSource = fs.readFileSync(
  path.join(__dirname, '../src/pages/notes/notes-page.tsx'),
  'utf8',
);
const apiSource = fs.readFileSync(path.join(__dirname, '../src/features/notes/api.ts'), 'utf8');

test('the dialog mutation is selected by dialog kind, not by isPending state', () => {
  const start = pageSource.indexOf('const dialogMutation');
  const end = pageSource.indexOf(';', start);
  assert.notEqual(start, -1);
  const selection = pageSource.slice(start, end);
  assert.match(selection, /dialog\?\.kind === 'createNote' \|\| dialog\?\.kind === 'createFolder'/);
  assert.match(selection, /dialog\?\.kind === 'rename'/);
  assert.match(selection, /: deleteMutation/);
  assert.doesNotMatch(selection, /\.isPending\s*\?/);
});

test('rename and delete carry the listed object identity to the API', () => {
  assert.match(pageSource, /objectId: dialog\.entry\.objectId/);
  assert.match(pageSource, /objectId: dialog\.entry!\.objectId/);
  assert.match(apiSource, /rename: \(path: string, newName: string, objectId\?: string \| null\)/);
  assert.match(apiSource, /remove: \(path: string, objectId\?: string \| null\)/);
});

test('nested entries send only the new basename to the rename API', () => {
  assert.match(
    pageSource,
    /notesApi\.rename\(request\.from, baseName\(request\.to\), request\.objectId\)/,
  );
});
