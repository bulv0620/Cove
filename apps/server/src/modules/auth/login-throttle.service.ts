import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '../../generated/prisma/client';
import { AuditResult, AuthLoginThrottleScope } from '../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginRateLimitedException } from './login-rate-limited.exception';
import { LoginThrottleConfig } from './login-throttle.config';

interface ThrottleState {
  scopeType: AuthLoginThrottleScope;
  keyHash: string;
  failureCount: number;
  cooldownLevel: number;
  windowStartedAt: Date | null;
  lastFailureAt: Date | null;
  cooldownUntil: Date | null;
  blockedAttempts: number;
  limitedAuditAt: Date | null;
}

export interface LoginVerificationReservation {
  id: string;
  usernameKeyHash: string;
  ipKeyHash: string;
  usernameFingerprint: string;
  ipAddress: string;
}

interface LoginIdentity {
  username: string;
  ipAddress: string;
  ipThrottleValue: string;
}

const elapsedSeconds = (now: Date, then: Date): number => (now.getTime() - then.getTime()) / 1000;

export interface FailureTransition {
  failureCount: number;
  cooldownLevel: number;
  windowStartedAt: Date;
  lastFailureAt: Date;
  cooldownUntil: Date | null;
  cooldownSeconds: number | null;
}

export function nextFailureTransition(
  state: Pick<ThrottleState, 'failureCount' | 'cooldownLevel' | 'windowStartedAt'>,
  threshold: number,
  now: Date,
  policy: Pick<LoginThrottleConfig, 'failureWindowSeconds' | 'cooldownSeconds'>,
): FailureTransition {
  const windowExpired =
    !state.windowStartedAt ||
    elapsedSeconds(now, state.windowStartedAt) >= policy.failureWindowSeconds;
  const failureCount = (windowExpired ? 0 : state.failureCount) + 1;
  const wasAtThreshold = state.failureCount >= threshold && !windowExpired;
  const entersCooldown = wasAtThreshold || failureCount >= threshold;
  const cooldownLevel = entersCooldown
    ? wasAtThreshold
      ? state.cooldownLevel + 1
      : state.cooldownLevel
    : state.cooldownLevel;
  const cooldownSeconds = entersCooldown ? policy.cooldownSeconds(cooldownLevel) : null;
  return {
    failureCount,
    cooldownLevel,
    windowStartedAt: windowExpired ? now : (state.windowStartedAt ?? now),
    lastFailureAt: now,
    cooldownUntil:
      cooldownSeconds === null ? null : new Date(now.getTime() + cooldownSeconds * 1000),
    cooldownSeconds,
  };
}

@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);
  private cleanupCounter = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LoginThrottleConfig,
    private readonly audit: AuditService,
  ) {}

  async preflight(identity: LoginIdentity): Promise<LoginVerificationReservation> {
    const now = new Date();
    const normalizedUsername = identity.username.trim().toLowerCase();
    const usernameKeyHash = this.config.throttleHash('USERNAME', normalizedUsername);
    const ipKeyHash = this.config.throttleHash('IP', identity.ipThrottleValue);
    const usernameFingerprint = this.config.usernameFingerprint(normalizedUsername);
    const keys = [
      { scopeType: AuthLoginThrottleScope.USERNAME, keyHash: usernameKeyHash },
      { scopeType: AuthLoginThrottleScope.IP, keyHash: ipKeyHash },
    ].sort((left, right) =>
      `${left.scopeType}:${left.keyHash}`.localeCompare(`${right.scopeType}:${right.keyHash}`),
    );
    await this.ensureStates(keys, now);
    const result = await this.prisma.$transaction(async (tx) => {
      for (const key of keys) {
        await tx.$executeRaw`
          UPDATE auth_login_throttles
          SET updated_at = updated_at
          WHERE scope_type = ${key.scopeType} AND key_hash = ${key.keyHash}
        `;
      }

      await tx.authLoginVerificationReservation.deleteMany({
        where: {
          expiresAt: { lte: now },
          OR: [{ usernameKeyHash }, { ipKeyHash }],
        },
      });

      const usernameState = await this.loadState(
        tx,
        AuthLoginThrottleScope.USERNAME,
        usernameKeyHash,
        now,
        usernameFingerprint,
        identity.ipAddress,
      );
      const ipState = await this.loadState(
        tx,
        AuthLoginThrottleScope.IP,
        ipKeyHash,
        now,
        usernameFingerprint,
        identity.ipAddress,
      );
      const [usernameReservations, ipReservations] = await Promise.all([
        tx.authLoginVerificationReservation.findMany({
          where: { usernameKeyHash, expiresAt: { gt: now } },
          select: { expiresAt: true },
          orderBy: { expiresAt: 'asc' },
        }),
        tx.authLoginVerificationReservation.findMany({
          where: { ipKeyHash, expiresAt: { gt: now } },
          select: { expiresAt: true },
          orderBy: { expiresAt: 'asc' },
        }),
      ]);

      const limited = [
        this.limitReason(
          usernameState,
          this.config.usernameThreshold,
          usernameReservations.map(({ expiresAt }) => expiresAt),
          now,
        ),
        this.limitReason(
          ipState,
          this.config.ipThreshold,
          ipReservations.map(({ expiresAt }) => expiresAt),
          now,
        ),
      ].filter((value): value is Date => value !== null);
      if (limited.length) {
        const retryAt = new Date(Math.max(...limited.map((value) => value.getTime())));
        await this.recordLimited(
          tx,
          usernameState,
          ipState,
          now,
          retryAt,
          usernameFingerprint,
          identity.ipAddress,
        );
        return {
          limited: true as const,
          retryAfterSeconds: Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)),
        };
      }

      await this.closeSaturationWindow(tx, usernameState, usernameFingerprint, identity.ipAddress);
      await this.closeSaturationWindow(tx, ipState, usernameFingerprint, identity.ipAddress);

      const id = uuidv7();
      await tx.authLoginVerificationReservation.create({
        data: {
          id,
          usernameKeyHash,
          ipKeyHash,
          expiresAt: new Date(now.getTime() + this.config.reservationSeconds * 1000),
        },
      });
      return {
        limited: false as const,
        reservation: {
          id,
          usernameKeyHash,
          ipKeyHash,
          usernameFingerprint,
          ipAddress: identity.ipAddress,
        },
      };
    });
    if (result.limited) throw new LoginRateLimitedException(result.retryAfterSeconds);
    this.scheduleCleanup();
    return result.reservation;
  }

  async completeFailure(reservation: LoginVerificationReservation, userId?: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.lockStates(tx, reservation.usernameKeyHash, reservation.ipKeyHash);
      const active = await tx.authLoginVerificationReservation.deleteMany({
        where: { id: reservation.id, expiresAt: { gt: now } },
      });
      if (active.count !== 1) throw new LoginRateLimitedException(1);

      const usernameState = await this.loadState(
        tx,
        AuthLoginThrottleScope.USERNAME,
        reservation.usernameKeyHash,
        now,
        reservation.usernameFingerprint,
        reservation.ipAddress,
      );
      const ipState = await this.loadState(
        tx,
        AuthLoginThrottleScope.IP,
        reservation.ipKeyHash,
        now,
        reservation.usernameFingerprint,
        reservation.ipAddress,
      );
      await this.recordLimitedSummary(
        tx,
        usernameState,
        reservation.usernameFingerprint,
        reservation.ipAddress,
      );
      await this.recordLimitedSummary(
        tx,
        ipState,
        reservation.usernameFingerprint,
        reservation.ipAddress,
      );
      const usernameCooldown = await this.applyFailure(
        tx,
        usernameState,
        this.config.usernameThreshold,
        now,
      );
      const ipCooldown = await this.applyFailure(tx, ipState, this.config.ipThreshold, now);
      await this.audit.record(
        {
          action: 'auth.login.failure',
          targetType: userId ? 'USER' : 'AUTH_LOGIN_USERNAME',
          targetId: userId ?? reservation.usernameFingerprint,
          result: AuditResult.FAILURE,
          ipAddress: reservation.ipAddress,
          metadata: {
            cooldowns: [
              ...(usernameCooldown === null
                ? []
                : [{ scope: 'USERNAME', seconds: usernameCooldown }]),
              ...(ipCooldown === null ? [] : [{ scope: 'IP', seconds: ipCooldown }]),
            ],
          },
        },
        tx,
      );
    });
  }

  async completeSuccess(reservation: LoginVerificationReservation, userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.lockStates(tx, reservation.usernameKeyHash, reservation.ipKeyHash);
      const active = await tx.authLoginVerificationReservation.deleteMany({
        where: { id: reservation.id, expiresAt: { gt: now } },
      });
      if (active.count !== 1) throw new LoginRateLimitedException(1);

      const usernameState = await tx.authLoginThrottle.findUniqueOrThrow({
        where: {
          scopeType_keyHash: {
            scopeType: AuthLoginThrottleScope.USERNAME,
            keyHash: reservation.usernameKeyHash,
          },
        },
      });
      const ipState = await tx.authLoginThrottle.findUniqueOrThrow({
        where: {
          scopeType_keyHash: {
            scopeType: AuthLoginThrottleScope.IP,
            keyHash: reservation.ipKeyHash,
          },
        },
      });
      await this.recordLimitedSummary(
        tx,
        usernameState,
        reservation.usernameFingerprint,
        reservation.ipAddress,
      );
      await this.recordLimitedSummary(
        tx,
        ipState,
        reservation.usernameFingerprint,
        reservation.ipAddress,
      );
      await tx.authLoginThrottle.update({
        where: {
          scopeType_keyHash: {
            scopeType: AuthLoginThrottleScope.USERNAME,
            keyHash: reservation.usernameKeyHash,
          },
        },
        data: {
          failureCount: 0,
          cooldownLevel: 0,
          windowStartedAt: null,
          lastFailureAt: null,
          cooldownUntil: null,
          blockedAttempts: 0,
          limitedAuditAt: null,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
      await this.audit.record(
        {
          actorUserId: userId,
          action: 'auth.login.success',
          targetType: 'USER',
          targetId: userId,
          result: AuditResult.SUCCESS,
          ipAddress: reservation.ipAddress,
        },
        tx,
      );
    });
  }

  private async lockStates(
    tx: Prisma.TransactionClient,
    usernameKeyHash: string,
    ipKeyHash: string,
  ): Promise<void> {
    const keys = [
      { scopeType: AuthLoginThrottleScope.USERNAME, keyHash: usernameKeyHash },
      { scopeType: AuthLoginThrottleScope.IP, keyHash: ipKeyHash },
    ].sort((left, right) =>
      `${left.scopeType}:${left.keyHash}`.localeCompare(`${right.scopeType}:${right.keyHash}`),
    );
    for (const key of keys) {
      await tx.$executeRaw`
        UPDATE auth_login_throttles
        SET updated_at = updated_at
        WHERE scope_type = ${key.scopeType} AND key_hash = ${key.keyHash}
      `;
    }
  }

  private async ensureStates(
    keys: Array<{ scopeType: AuthLoginThrottleScope; keyHash: string }>,
    now: Date,
  ): Promise<void> {
    for (const key of keys) {
      await this.prisma.$executeRaw`
        INSERT IGNORE INTO auth_login_throttles
          (scope_type, key_hash, created_at, updated_at)
        VALUES
          (${key.scopeType}, ${key.keyHash}, ${now}, ${now})
      `;
    }
  }

  private async loadState(
    tx: Prisma.TransactionClient,
    scopeType: AuthLoginThrottleScope,
    keyHash: string,
    now: Date,
    usernameFingerprint: string,
    ipAddress: string,
  ): Promise<ThrottleState> {
    const state = await tx.authLoginThrottle.findUniqueOrThrow({
      where: { scopeType_keyHash: { scopeType, keyHash } },
    });
    if (
      state.lastFailureAt &&
      elapsedSeconds(now, state.lastFailureAt) >= this.config.resetSeconds
    ) {
      await this.recordLimitedSummary(tx, state, usernameFingerprint, ipAddress);
      return tx.authLoginThrottle.update({
        where: { scopeType_keyHash: { scopeType, keyHash } },
        data: {
          failureCount: 0,
          cooldownLevel: 0,
          windowStartedAt: null,
          lastFailureAt: null,
          cooldownUntil: null,
          blockedAttempts: 0,
          limitedAuditAt: null,
        },
      });
    }
    if (state.cooldownUntil && state.cooldownUntil <= now) {
      await this.recordLimitedSummary(tx, state, usernameFingerprint, ipAddress);
      const windowExpired =
        Boolean(state.windowStartedAt) &&
        elapsedSeconds(now, state.windowStartedAt as Date) >= this.config.failureWindowSeconds;
      return tx.authLoginThrottle.update({
        where: { scopeType_keyHash: { scopeType, keyHash } },
        data: {
          ...(windowExpired ? { failureCount: 0, windowStartedAt: null } : {}),
          cooldownUntil: null,
          blockedAttempts: 0,
          limitedAuditAt: null,
        },
      });
    }
    if (
      state.windowStartedAt &&
      elapsedSeconds(now, state.windowStartedAt) >= this.config.failureWindowSeconds &&
      !state.cooldownUntil
    ) {
      return tx.authLoginThrottle.update({
        where: { scopeType_keyHash: { scopeType, keyHash } },
        data: { failureCount: 0, windowStartedAt: null },
      });
    }
    return state;
  }

  private limitReason(
    state: ThrottleState,
    threshold: number,
    reservationExpirations: Date[],
    now: Date,
  ): Date | null {
    if (state.cooldownUntil && state.cooldownUntil > now) return state.cooldownUntil;
    const capacity = state.failureCount >= threshold ? 1 : threshold - state.failureCount;
    if (reservationExpirations.length < capacity) return null;
    return reservationExpirations[0] ?? null;
  }

  private async applyFailure(
    tx: Prisma.TransactionClient,
    state: ThrottleState,
    threshold: number,
    now: Date,
  ): Promise<number | null> {
    const transition = nextFailureTransition(state, threshold, now, this.config);
    await tx.authLoginThrottle.update({
      where: { scopeType_keyHash: { scopeType: state.scopeType, keyHash: state.keyHash } },
      data: {
        failureCount: transition.failureCount,
        cooldownLevel: transition.cooldownLevel,
        windowStartedAt: transition.windowStartedAt,
        lastFailureAt: transition.lastFailureAt,
        cooldownUntil: transition.cooldownUntil,
        blockedAttempts: 0,
        limitedAuditAt: null,
      },
    });
    return transition.cooldownSeconds;
  }

  private async recordLimited(
    tx: Prisma.TransactionClient,
    usernameState: ThrottleState,
    ipState: ThrottleState,
    now: Date,
    retryAt: Date,
    usernameFingerprint: string,
    ipAddress: string,
  ): Promise<void> {
    for (const state of [usernameState, ipState]) {
      const threshold =
        state.scopeType === AuthLoginThrottleScope.USERNAME
          ? this.config.usernameThreshold
          : this.config.ipThreshold;
      const reservationCount = await tx.authLoginVerificationReservation.count({
        where:
          state.scopeType === AuthLoginThrottleScope.USERNAME
            ? { usernameKeyHash: state.keyHash, expiresAt: { gt: now } }
            : { ipKeyHash: state.keyHash, expiresAt: { gt: now } },
      });
      const isLimited =
        Boolean(state.cooldownUntil && state.cooldownUntil > now) ||
        reservationCount >= (state.failureCount >= threshold ? 1 : threshold - state.failureCount);
      if (!isLimited) continue;
      const updated = await tx.authLoginThrottle.update({
        where: {
          scopeType_keyHash: { scopeType: state.scopeType, keyHash: state.keyHash },
        },
        data: {
          blockedAttempts: { increment: 1 },
          ...(state.limitedAuditAt ? {} : { limitedAuditAt: now }),
        },
      });
      if (!state.limitedAuditAt) {
        await this.audit.record(
          {
            action: 'auth.login.rate_limited',
            targetType:
              state.scopeType === AuthLoginThrottleScope.USERNAME
                ? 'AUTH_LOGIN_USERNAME'
                : 'AUTH_LOGIN_IP',
            targetId:
              state.scopeType === AuthLoginThrottleScope.USERNAME ? usernameFingerprint : undefined,
            result: AuditResult.FAILURE,
            ipAddress,
            metadata: {
              scope: state.scopeType,
              retryAfterSeconds: Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)),
              blockedAttempts: updated.blockedAttempts,
            },
          },
          tx,
        );
      }
    }
  }

  private async recordLimitedSummary(
    tx: Prisma.TransactionClient,
    state: ThrottleState,
    usernameFingerprint: string,
    ipAddress: string,
  ): Promise<void> {
    if (state.blockedAttempts <= 1) return;
    await this.audit.record(
      {
        action: 'auth.login.rate_limited',
        targetType:
          state.scopeType === AuthLoginThrottleScope.USERNAME
            ? 'AUTH_LOGIN_USERNAME'
            : 'AUTH_LOGIN_IP',
        targetId:
          state.scopeType === AuthLoginThrottleScope.USERNAME ? usernameFingerprint : undefined,
        result: AuditResult.FAILURE,
        ipAddress,
        metadata: {
          scope: state.scopeType,
          summary: true,
          blockedAttempts: state.blockedAttempts,
        },
      },
      tx,
    );
  }

  private async closeSaturationWindow(
    tx: Prisma.TransactionClient,
    state: ThrottleState,
    usernameFingerprint: string,
    ipAddress: string,
  ): Promise<void> {
    if (state.cooldownUntil || !state.limitedAuditAt) return;
    await this.recordLimitedSummary(tx, state, usernameFingerprint, ipAddress);
    await tx.authLoginThrottle.update({
      where: {
        scopeType_keyHash: { scopeType: state.scopeType, keyHash: state.keyHash },
      },
      data: { limitedAuditAt: null, blockedAttempts: 0 },
    });
  }

  private scheduleCleanup(): void {
    this.cleanupCounter += 1;
    if (this.cleanupCounter % 100 !== 0) return;
    void this.cleanup().catch(() => {
      this.logger.warn('Login throttle cleanup failed.');
    });
  }

  private async cleanup(): Promise<void> {
    const now = new Date();
    const retainedSince = new Date(now.getTime() - this.config.retentionHours * 3_600_000);
    await this.prisma.$executeRaw`
      DELETE FROM auth_login_verification_reservations
      WHERE expires_at <= ${now}
      LIMIT 100
    `;
    const candidates = await this.prisma.authLoginThrottle.findMany({
      where: {
        OR: [
          { lastFailureAt: { lte: retainedSince } },
          { lastFailureAt: null, updatedAt: { lte: retainedSince } },
        ],
        AND: [{ OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }] }],
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
    for (const candidate of candidates) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE auth_login_throttles
          SET updated_at = updated_at
          WHERE scope_type = ${candidate.scopeType} AND key_hash = ${candidate.keyHash}
        `;
        const current = await tx.authLoginThrottle.findUnique({
          where: {
            scopeType_keyHash: {
              scopeType: candidate.scopeType,
              keyHash: candidate.keyHash,
            },
          },
        });
        if (!current) return;
        const expired =
          (current.lastFailureAt
            ? current.lastFailureAt <= retainedSince
            : current.updatedAt <= retainedSince) &&
          (!current.cooldownUntil || current.cooldownUntil <= now);
        if (!expired) return;
        if (current.blockedAttempts > 1) {
          await this.audit.record(
            {
              action: 'auth.login.rate_limited',
              targetType:
                current.scopeType === AuthLoginThrottleScope.USERNAME
                  ? 'AUTH_LOGIN_USERNAME'
                  : 'AUTH_LOGIN_IP',
              result: AuditResult.FAILURE,
              metadata: {
                scope: current.scopeType,
                summary: true,
                blockedAttempts: current.blockedAttempts,
                sourceExpired: true,
              },
            },
            tx,
          );
        }
        await tx.authLoginThrottle.delete({
          where: {
            scopeType_keyHash: {
              scopeType: current.scopeType,
              keyHash: current.keyHash,
            },
          },
        });
      });
    }
  }
}
