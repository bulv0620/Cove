const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadStateModule() {
  const context = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/app/page-session-state.ts'), 'utf8');
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  return context.exports;
}

const state = loadStateModule();
const location = (pathname, search = '') => ({ pathname, search, hash: '' });

test('direct entry creates the default dashboard and one active target session', () => {
  const result = state.initializePageSessions('images', location('/images'), 1);
  assert.equal(result.sessions.map(({ routeId }) => routeId).join(','), 'dashboard,images');
  assert.equal(result.activeRouteId, 'images');
});

test('opening the same route reuses its instance and updates its latest location', () => {
  let result = state.initializePageSessions('files', location('/files'), 1);
  result = state.openOrActivatePageSession(result, 'users', location('/users'), 2);
  result = state.openOrActivatePageSession(
    result,
    'files',
    location('/files', '?path=Image%20Hosting'),
    3,
  );
  assert.equal(result.sessions.filter(({ routeId }) => routeId === 'files').length, 1);
  assert.equal(result.activeRouteId, 'files');
  assert.equal(
    result.sessions.find(({ routeId }) => routeId === 'files').location.search,
    '?path=Image%20Hosting',
  );
});

test('re-activating the current route at the same location is identity preserving', () => {
  const result = state.initializePageSessions('files', location('/files'), 1);
  const repeated = state.openOrActivatePageSession(result, 'files', location('/files'), 2);
  assert.equal(repeated, result);
  assert.equal(repeated.sessions[1], result.sessions[1]);
});

test('closing the active route selects the most recently used remaining session', () => {
  let result = state.initializePageSessions('dashboard', location('/'), 1);
  result = state.openOrActivatePageSession(result, 'users', location('/users'), 2);
  result = state.openOrActivatePageSession(result, 'files', location('/files'), 3);
  result = state.openOrActivatePageSession(result, 'users', location('/users'), 4);
  result = state.closePageSession(result, 'users', 5);
  assert.equal(result.activeRouteId, 'files');
  assert.equal(result.sessions.map(({ routeId }) => routeId).join(','), 'dashboard,files');
});

test('dashboard can stay closed while another session remains', () => {
  let result = state.initializePageSessions('files', location('/files'), 1);
  result = state.closePageSession(result, 'dashboard', 2);
  assert.equal(result.sessions.map(({ routeId }) => routeId).join(','), 'files');
  assert.equal(result.activeRouteId, 'files');
});

test('closing an inactive session keeps the active route unchanged', () => {
  let result = state.initializePageSessions('files', location('/files'), 1);
  result = state.openOrActivatePageSession(result, 'users', location('/users'), 2);
  result = state.closePageSession(result, 'files', 3);
  assert.equal(result.activeRouteId, 'users');
  assert.equal(result.sessions.map(({ routeId }) => routeId).join(','), 'dashboard,users');
});

test('closing the last session creates a fresh active dashboard', () => {
  let result = state.initializePageSessions('files', location('/files'), 1);
  result = state.closePageSession(result, 'dashboard', 2);
  result = state.closePageSession(result, 'files', 3);
  assert.equal(result.activeRouteId, 'dashboard');
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(result.sessions[0].location, state.DASHBOARD_LOCATION);
  assert.equal(result.sessions[0].openedAt, 3);
});

test('permission pruning removes inaccessible sessions and safely falls back', () => {
  let result = state.initializePageSessions('users', location('/users'), 1);
  result = state.openOrActivatePageSession(result, 'files', location('/files'), 2);
  result = state.prunePageSessions(result, new Set(['dashboard', 'users']), 3);
  assert.equal(result.activeRouteId, 'users');
  assert.equal(result.sessions.map(({ routeId }) => routeId).join(','), 'dashboard,users');
});

test('permission pruning to an empty set creates a fresh dashboard fallback', () => {
  const result = state.prunePageSessions(
    state.initializePageSessions('users', location('/users'), 1),
    new Set(),
    2,
  );
  assert.equal(result.activeRouteId, 'dashboard');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].openedAt, 2);
});
