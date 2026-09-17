const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPageNavigation } = require('../dist/static-assets');

const request = (path, method = 'GET', acceptsHtml = true) => ({
  path,
  method,
  accepts: () => (acceptsHtml ? 'html' : false),
});

test('SPA fallback only accepts browser page navigation', () => {
  for (const path of ['/', '/files', '/roles/123']) {
    assert.equal(isPageNavigation(request(path)), true, path);
    assert.equal(isPageNavigation(request(path, 'HEAD')), true, `HEAD ${path}`);
  }

  for (const path of [
    '/api',
    '/api/auth/me',
    '/api%2Fauth%2Fme',
    '/assets/missing.js',
    '/missing.css',
    '/.env',
    '/%2eenv',
    '/folder/.secret',
    '/folder/%2Esecret',
    '/%E0%A4%A',
  ]) {
    assert.equal(isPageNavigation(request(path)), false, path);
  }

  assert.equal(isPageNavigation(request('/files', 'POST')), false);
  assert.equal(isPageNavigation(request('/files', 'GET', false)), false);
});
