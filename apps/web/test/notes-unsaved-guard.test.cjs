/**
 * Notes saves on request only: the editor runs its queue in manual mode, a
 * save button (and Cmd/Ctrl+S) is the single way text reaches the NAS, the
 * directory pane is a lazily expanded tree, and switching to another note
 * while dirty asks first instead of autosaving or silently dropping the text.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8');
const pageSource = read('../src/pages/notes/notes-page.tsx');
const queueSource = read('../src/features/notes/save-queue.ts');

test('the editor saves only on an explicit action', () => {
  assert.match(pageSource, /autoSave: false/, 'the notes queue must run in manual mode');
  assert.match(pageSource, /onClick=\{\(\) => void queue\.flush\(\)\}/, 'the toolbar saves');
  assert.doesNotMatch(
    pageSource,
    /onBlur=\{\(\) => void queue\.flush\(\)\}/,
    'blur must not save by itself',
  );
  assert.match(pageSource, /metaKey \|\| event\.ctrlKey/, 'Cmd/Ctrl+S saves');
  assert.match(queueSource, /autoSave\?: boolean;/, 'the queue exposes the manual mode');
});

test('switching notes with unsaved changes asks before abandoning them', () => {
  assert.match(pageSource, /const requestOpenNote = \(nextNote: string \| null\) => \{/);
  assert.match(pageSource, /editorSession\?\.isDirty\(\)/);
  assert.match(pageSource, /setSwitching\(\{ path: nextNote \}\)/);
  assert.match(pageSource, /t\('notes\.saveAndSwitch'\)/);
  assert.match(pageSource, /t\('notes\.discardAndSwitch'\)/);
  assert.match(pageSource, /t\('notes\.keepEditing'\)/);
});

test('an explicit discard drops the stored recovery draft', () => {
  assert.match(pageSource, /deleteDraft\(user\.id, bindingVersion, noteParam\)/);
  assert.match(pageSource, /discardedRef\.current = true/);
  assert.match(
    pageSource,
    /if \(!discardedRef\.current && state\.dirty && text !== null\)/,
    'unmounting after a discard must not write the draft back',
  );
});

test('the directory pane is a lazily expanded tree of folders and notes', () => {
  assert.match(pageSource, /function NoteTreeNode\(/);
  assert.match(pageSource, /enabled: ctx\.available && isDirectory && expanded/);
  assert.match(pageSource, /ctx\.onOpenNote\(entry\.relativePath\)/);
  assert.doesNotMatch(pageSource, /params\.get\('dir'\)/, 'the old per-level folder walk is gone');
  assert.doesNotMatch(pageSource, /fileSize\(/, 'the tree no longer shows file sizes');
});

test('a save refreshes the identity that rename and delete check', () => {
  // Saving replaces the NAS object. Rename and delete verify the SMB object
  // identity from the listing, so the listing entry has to be repointed at the
  // identity the save reported, or the next rename fails as NOTE_CHANGED.
  assert.match(pageSource, /objectId: result\.objectId/);
  assert.match(pageSource, /\['notes', userId, 'tree', parentPath\(path\)\]/);
  assert.match(pageSource, /entry\.relativePath === path/);
});

test('the tree pane collapses, resizes, and remembers both per user', () => {
  assert.match(pageSource, /cove\.notes\.tree\.\$\{user\?\.id \?\? ''\}/);
  assert.match(pageSource, /readStored\(`\$\{treePrefs\}\.width`\)/);
  assert.match(pageSource, /writeStored\(`\$\{treePrefs\}\.collapsed`/);
  assert.match(pageSource, /lg:w-\[var\(--notes-tree-width\)\]/, 'drag sets the pane width');
  assert.match(pageSource, /role="separator"/);
  assert.match(pageSource, /'notes\.resizeTree'\)/, 'the handle is named');
  assert.match(pageSource, /t\('notes\.hideTree'\)/);
  assert.match(pageSource, /t\('notes\.showTree'\)/, 'a collapsed pane keeps a way back');
});
