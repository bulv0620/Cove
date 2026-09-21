const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageSource = fs.readFileSync(
  path.join(__dirname, '../src/pages/images/images-page.tsx'),
  'utf8',
);
const workspaceSource = fs.readFileSync(
  path.join(__dirname, '../src/app/page-session-workspace.tsx'),
  'utf8',
);

test('image hosting loading and unavailable states use the full-height placeholder', () => {
  const pendingStart = pageSource.indexOf('if (status.isPending)');
  const unavailableStart = pageSource.indexOf('if (!available)', pendingStart);
  const availableStart = pageSource.indexOf('\n  return (', unavailableStart);

  assert.notEqual(pendingStart, -1);
  assert.notEqual(unavailableStart, -1);
  assert.notEqual(availableStart, -1);

  const pendingBranch = pageSource.slice(pendingStart, unavailableStart);
  const unavailableBranch = pageSource.slice(unavailableStart, availableStart);
  const availableBranch = pageSource.slice(availableStart);

  for (const branch of [pendingBranch, unavailableBranch]) {
    assert.match(branch, /h-full/);
    assert.doesNotMatch(branch, /\{header\}/);
    assert.doesNotMatch(branch, /<Card/);
  }
  assert.match(unavailableBranch, /status\.refetch/);
  assert.match(unavailableBranch, /<Link to="\/users">/);
  assert.match(availableBranch, /\{header\}/);
});

test('image hosting and files share the full-height page-session layout', () => {
  assert.match(workspaceSource, /\['files', 'images'\]\.includes\(route\.id\)/);
  assert.match(workspaceSource, /h-\[calc\(100dvh-6\.75rem\)\]/);
});
