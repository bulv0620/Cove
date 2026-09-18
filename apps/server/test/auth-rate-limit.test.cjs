const { test } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const { AuthService } = require('../dist/modules/auth/auth.service');
const { ClientIpService } = require('../dist/modules/auth/client-ip.service');
const { LoginRateLimitedException } = require('../dist/modules/auth/login-rate-limited.exception');
const { LoginThrottleConfig } = require('../dist/modules/auth/login-throttle.config');
const { nextFailureTransition } = require('../dist/modules/auth/login-throttle.service');

const config = (extra = {}) =>
  new LoginThrottleConfig({
    get: (key) =>
      ({
        JWT_SECRET: 'test-only-login-throttle-secret',
        ...extra,
      })[key],
  });

const request = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('login throttle configuration validates bounds and derives separated stable hashes', () => {
  const first = config();
  const second = config();
  assert.equal(first.usernameThreshold, 5);
  assert.equal(first.ipThreshold, 20);
  assert.equal(first.cooldownSeconds(0), 30);
  assert.equal(first.cooldownSeconds(10), 900);
  assert.equal(first.throttleHash('USERNAME', 'admin'), second.throttleHash('USERNAME', 'admin'));
  assert.notEqual(first.throttleHash('USERNAME', 'admin'), first.throttleHash('IP', 'admin'));
  assert.notEqual(first.usernameFingerprint('admin'), first.throttleHash('USERNAME', 'admin'));
  assert.equal(first.usernameFingerprint('admin').length, 32);
  assert.throws(() => config({ AUTH_LOGIN_USERNAME_THRESHOLD: '0' }));
  assert.throws(() =>
    config({
      AUTH_LOGIN_BASE_COOLDOWN_SECONDS: '60',
      AUTH_LOGIN_MAX_COOLDOWN_SECONDS: '30',
    }),
  );
  assert.throws(() => config({ AUTH_TRUSTED_PROXY_CIDRS: '*' }));
});

test('client IP ignores spoofed headers unless the direct proxy is explicitly trusted', () => {
  const direct = new ClientIpService(config());
  assert.deepEqual(direct.resolve(request('203.0.113.8', { 'x-forwarded-for': '198.51.100.4' })), {
    address: '203.0.113.8',
    throttleValue: '203.0.113.8/32',
  });

  const proxied = new ClientIpService(config({ AUTH_TRUSTED_PROXY_CIDRS: '10.0.0.0/8' }));
  assert.deepEqual(
    proxied.resolve(request('10.0.0.5', { 'x-forwarded-for': '198.51.100.4, 10.0.0.2' })),
    { address: '198.51.100.4', throttleValue: '198.51.100.4/32' },
  );
  assert.deepEqual(
    proxied.resolve(
      request('10.0.0.5', {
        forwarded: 'for=198.51.100.4',
        'x-forwarded-for': '192.0.2.9',
      }),
    ),
    { address: '10.0.0.5', throttleValue: '10.0.0.5/32' },
  );
  assert.deepEqual(
    proxied.resolve(
      request('10.0.0.5', {
        forwarded: 'for=unknown',
        'x-forwarded-for': '198.51.100.4',
      }),
    ),
    { address: '10.0.0.5', throttleValue: '10.0.0.5/32' },
  );
});

test('IPv4-mapped addresses normalize and IPv6 throttling groups a /64', () => {
  const resolver = new ClientIpService(config());
  assert.deepEqual(resolver.resolve(request('::ffff:192.0.2.4')), {
    address: '192.0.2.4',
    throttleValue: '192.0.2.4/32',
  });
  const ipv6 = resolver.resolve(request('2001:db8:abcd:1234:1111:2222:3333:4444'));
  assert.equal(ipv6.address, '2001:db8:abcd:1234:1111:2222:3333:4444');
  assert.equal(ipv6.throttleValue, '2001:db8:abcd:1234:0:0:0:0/64');
});

test('failure transitions start at the fifth attempt, double, cap, and reset the window', () => {
  const policy = {
    failureWindowSeconds: 600,
    cooldownSeconds: (level) => Math.min(30 * 2 ** level, 900),
  };
  const started = new Date('2026-09-18T00:00:00.000Z');
  let state = { failureCount: 0, cooldownLevel: 0, windowStartedAt: null };
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const transition = nextFailureTransition(state, 5, started, policy);
    assert.equal(transition.cooldownSeconds, attempt === 5 ? 30 : null);
    state = transition;
  }
  let transition = nextFailureTransition(state, 5, new Date(started.getTime() + 31_000), policy);
  assert.equal(transition.failureCount, 6);
  assert.equal(transition.cooldownLevel, 1);
  assert.equal(transition.cooldownSeconds, 60);
  for (let level = 2; level <= 6; level += 1) {
    transition = nextFailureTransition(transition, 5, new Date(started.getTime() + level), policy);
  }
  assert.equal(transition.cooldownSeconds, 900);

  const reset = nextFailureTransition(transition, 5, new Date(started.getTime() + 601_000), policy);
  assert.equal(reset.failureCount, 1);
  assert.equal(reset.cooldownSeconds, null);
});

test('429 error exposes one stable response contract', () => {
  const error = new LoginRateLimitedException(42);
  assert.equal(error.getStatus(), 429);
  assert.deepEqual(error.getResponse(), {
    statusCode: 429,
    error: 'Too Many Requests',
    code: 'AUTH_RATE_LIMITED',
    message: 'Too many login attempts. Try again later.',
    retryAfterSeconds: 42,
  });
});

test('auth service settles throttle reservations on failed and successful verification', async () => {
  const password = 'test-only-password';
  const passwordHash = await argon2.hash(password);
  const databaseUser = {
    id: 'user-id',
    status: 'ACTIVE',
    passwordCredential: { passwordHash },
  };
  const publicUser = {
    id: 'user-id',
    username: 'admin',
    displayName: null,
    permissions: [],
    roleCodes: [],
    isSuperAdmin: true,
    mustChangePassword: false,
    authVersion: 1,
  };
  const calls = [];
  const reservation = {
    id: 'reservation',
    usernameKeyHash: 'u',
    ipKeyHash: 'i',
    usernameFingerprint: 'f',
    ipAddress: '192.0.2.1',
  };
  const throttle = {
    preflight: async (identity) => {
      calls.push(['preflight', identity]);
      return reservation;
    },
    completeFailure: async (value, userId) => calls.push(['failure', value, userId]),
    completeSuccess: async (value, userId) => calls.push(['success', value, userId]),
  };
  const service = new AuthService(
    { signAsync: async () => 'signed-token' },
    { findForAuthentication: async () => databaseUser },
    { getAuthUser: async () => publicUser },
    throttle,
  );
  const ip = { address: '192.0.2.1', throttleValue: '192.0.2.1/32' };

  await assert.rejects(service.login({ username: 'admin', password: 'wrong' }, ip), {
    status: 401,
  });
  assert.equal(calls.at(-1)[0], 'failure');
  const result = await service.login({ username: 'admin', password }, ip);
  assert.equal(result.accessToken, 'signed-token');
  assert.equal(calls.at(-1)[0], 'success');
});

test('auth service fails closed before user lookup and token signing when limiter storage fails', async () => {
  let queried = false;
  let signed = false;
  const service = new AuthService(
    {
      signAsync: async () => {
        signed = true;
        return 'unexpected';
      },
    },
    {
      findForAuthentication: async () => {
        queried = true;
        return null;
      },
    },
    { getAuthUser: async () => null },
    { preflight: async () => Promise.reject(new Error('storage unavailable')) },
  );
  await assert.rejects(
    service.login(
      { username: 'admin', password: 'test' },
      { address: '192.0.2.1', throttleValue: '192.0.2.1/32' },
    ),
    /storage unavailable/,
  );
  assert.equal(queried, false);
  assert.equal(signed, false);
});

test('missing and disabled users keep the same credential error while settling failures', async () => {
  const password = 'test-only-password';
  const passwordHash = await argon2.hash(password);
  const outcomes = [];
  for (const databaseUser of [
    null,
    {
      id: 'disabled-user',
      status: 'DISABLED',
      passwordCredential: { passwordHash },
    },
  ]) {
    let settledUserId = 'not-settled';
    const service = new AuthService(
      { signAsync: async () => 'unexpected' },
      { findForAuthentication: async () => databaseUser },
      { getAuthUser: async () => null },
      {
        preflight: async () => ({
          id: 'reservation',
          usernameKeyHash: 'u',
          ipKeyHash: 'i',
          usernameFingerprint: 'f',
          ipAddress: '192.0.2.1',
        }),
        completeFailure: async (_reservation, userId) => {
          settledUserId = userId;
        },
      },
    );
    try {
      await service.login(
        { username: 'candidate', password },
        { address: '192.0.2.1', throttleValue: '192.0.2.1/32' },
      );
      assert.fail('Expected login to fail.');
    } catch (error) {
      outcomes.push({ status: error.getStatus(), response: error.getResponse() });
    }
    assert.equal(settledUserId, databaseUser?.id);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
  assert.deepEqual(outcomes[0], {
    status: 401,
    response: { message: 'Invalid username or password.', error: 'Unauthorized', statusCode: 401 },
  });
});
