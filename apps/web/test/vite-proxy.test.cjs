const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function matchesProxyContext(context, url) {
  return context.startsWith('^') ? new RegExp(context).test(url) : url.startsWith(context);
}

test('public image proxy does not capture the images SPA route', async () => {
  const { resolveConfig } = await import('vite');
  const config = await resolveConfig(
    { configFile: path.join(__dirname, '../vite.config.ts') },
    'serve',
  );
  const contexts = Object.keys(config.server.proxy ?? {});
  const publicImageContext = contexts.find((context) => context.startsWith('^/image'));

  assert.ok(publicImageContext, 'expected a bounded public image proxy context');
  assert.equal(matchesProxyContext(publicImageContext, '/image'), true);
  assert.equal(matchesProxyContext(publicImageContext, '/image/public-id'), true);
  assert.equal(matchesProxyContext(publicImageContext, '/images'), false);
  assert.equal(matchesProxyContext(publicImageContext, '/image-gallery'), false);
});
