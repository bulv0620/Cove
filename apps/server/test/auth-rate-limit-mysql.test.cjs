const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PrismaService } = require('../dist/database/prisma.service');
const { LoginThrottleConfig } = require('../dist/modules/auth/login-throttle.config');
const { LoginThrottleService } = require('../dist/modules/auth/login-throttle.service');

const databaseUrl = process.env.AUTH_RATE_LIMIT_TEST_DATABASE_URL;

test(
  'MySQL coordinates username/IP limits, persistence, audit, and concurrent reservations',
  { skip: !databaseUrl },
  async () => {
    process.env.DATABASE_URL = databaseUrl;
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const secondPrisma = new PrismaService();
    await secondPrisma.onModuleInit();
    const throttleConfig = new LoginThrottleConfig({
      get: (key) => ({ JWT_SECRET: 'mysql-integration-test-secret' })[key],
    });
    const audit = new AuditService(prisma);
    const service = new LoginThrottleService(prisma, throttleConfig, audit);
    const secondService = new LoginThrottleService(
      secondPrisma,
      throttleConfig,
      new AuditService(secondPrisma),
    );
    const identity = (username, index = 1) => ({
      username,
      ipAddress: `192.0.2.${index}`,
      ipThrottleValue: `192.0.2.${index}/32`,
    });
    const isLimited = (result) =>
      result.status === 'rejected' && result.reason?.getResponse?.().code === 'AUTH_RATE_LIMITED';
    const failures = (results) =>
      results
        .filter((result) => result.status === 'rejected')
        .map((result) => ({
          code: result.reason?.code,
          message: result.reason?.message,
          meta: result.reason?.meta,
        }));

    try {
      await prisma.authLoginVerificationReservation.deleteMany();
      await prisma.authLoginThrottle.deleteMany();
      await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'auth.login.' } } });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const reservation = await service.preflight(identity('admin'));
        await service.completeFailure(reservation);
      }
      await assert.rejects(service.preflight(identity('admin')), (error) => {
        assert.equal(error.getStatus(), 429);
        assert.equal(error.getResponse().code, 'AUTH_RATE_LIMITED');
        return true;
      });
      await assert.rejects(secondService.preflight(identity('admin')), { status: 429 });
      assert.equal(await prisma.auditLog.count({ where: { action: 'auth.login.failure' } }), 5);
      assert.equal(
        await prisma.auditLog.count({ where: { action: 'auth.login.rate_limited' } }),
        1,
      );

      await prisma.authLoginVerificationReservation.deleteMany();
      await prisma.authLoginThrottle.deleteMany();
      const usernameResults = await Promise.allSettled(
        Array.from({ length: 10 }, (_, index) =>
          (index % 2 === 0 ? service : secondService).preflight(
            identity('shared-account', index + 1),
          ),
        ),
      );
      assert.equal(
        usernameResults.filter((result) => result.status === 'fulfilled').length,
        5,
        JSON.stringify(failures(usernameResults)),
      );
      assert.equal(usernameResults.filter(isLimited).length, 5);

      await prisma.authLoginVerificationReservation.deleteMany();
      await prisma.authLoginThrottle.deleteMany();
      const ipResults = await Promise.allSettled(
        Array.from({ length: 25 }, (_, index) =>
          (index % 2 === 0 ? service : secondService).preflight(identity(`account-${index}`, 40)),
        ),
      );
      assert.equal(
        ipResults.filter((result) => result.status === 'fulfilled').length,
        20,
        JSON.stringify(failures(ipResults)),
      );
      assert.equal(ipResults.filter(isLimited).length, 5);

      await prisma.authLoginVerificationReservation.deleteMany();
      await prisma.authLoginThrottle.deleteMany();
      const interrupted = await service.preflight(identity('interrupted'));
      await prisma.authLoginVerificationReservation.update({
        where: { id: interrupted.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      const recovered = await secondService.preflight(identity('interrupted'));
      assert.notEqual(recovered.id, interrupted.id);
    } finally {
      await prisma.authLoginVerificationReservation.deleteMany();
      await prisma.authLoginThrottle.deleteMany();
      await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'auth.login.' } } });
      await secondPrisma.onModuleDestroy();
      await prisma.onModuleDestroy();
    }
  },
);
