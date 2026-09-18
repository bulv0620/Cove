import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, hkdfSync } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { getJwtSecret } from '../../core/config/jwt.config';

type Cidr = ReturnType<typeof ipaddr.parseCIDR>;

function integer(
  config: ConfigService,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = config.get<string>(name) ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${name}; expected an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

@Injectable()
export class LoginThrottleConfig {
  readonly failureWindowSeconds: number;
  readonly usernameThreshold: number;
  readonly ipThreshold: number;
  readonly baseCooldownSeconds: number;
  readonly maxCooldownSeconds: number;
  readonly resetSeconds: number;
  readonly reservationSeconds: number;
  readonly retentionHours: number;
  readonly trustedProxyCidrs: Cidr[];
  private readonly throttleKey: Buffer;
  private readonly auditKey: Buffer;

  constructor(config: ConfigService) {
    this.failureWindowSeconds = integer(
      config,
      'AUTH_LOGIN_FAILURE_WINDOW_SECONDS',
      600,
      60,
      86_400,
    );
    this.usernameThreshold = integer(config, 'AUTH_LOGIN_USERNAME_THRESHOLD', 5, 2, 100);
    this.ipThreshold = integer(config, 'AUTH_LOGIN_IP_THRESHOLD', 20, 2, 10_000);
    this.baseCooldownSeconds = integer(config, 'AUTH_LOGIN_BASE_COOLDOWN_SECONDS', 30, 1, 3_600);
    this.maxCooldownSeconds = integer(config, 'AUTH_LOGIN_MAX_COOLDOWN_SECONDS', 900, 1, 86_400);
    this.resetSeconds = integer(config, 'AUTH_LOGIN_RESET_SECONDS', 1_800, 60, 604_800);
    this.reservationSeconds = integer(config, 'AUTH_LOGIN_RESERVATION_SECONDS', 30, 5, 300);
    this.retentionHours = integer(config, 'AUTH_LOGIN_STATE_RETENTION_HOURS', 24, 1, 720);
    if (this.maxCooldownSeconds < this.baseCooldownSeconds) {
      throw new Error(
        'Invalid AUTH_LOGIN_MAX_COOLDOWN_SECONDS; it must be at least AUTH_LOGIN_BASE_COOLDOWN_SECONDS.',
      );
    }
    if (this.resetSeconds < this.failureWindowSeconds) {
      throw new Error(
        'Invalid AUTH_LOGIN_RESET_SECONDS; it must be at least AUTH_LOGIN_FAILURE_WINDOW_SECONDS.',
      );
    }

    const cidrs = (config.get<string>('AUTH_TRUSTED_PROXY_CIDRS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      this.trustedProxyCidrs = cidrs.map((value) => ipaddr.parseCIDR(value));
    } catch {
      throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS; expected comma-separated IP CIDRs.');
    }

    const root = Buffer.from(getJwtSecret(config), 'utf8');
    this.throttleKey = Buffer.from(
      hkdfSync('sha256', root, Buffer.alloc(0), 'cove/auth-login-throttle/v1', 32),
    );
    this.auditKey = Buffer.from(
      hkdfSync('sha256', root, Buffer.alloc(0), 'cove/auth-login-audit/v1', 32),
    );
  }

  throttleHash(scope: 'USERNAME' | 'IP', value: string): string {
    return createHmac('sha256', this.throttleKey).update(`${scope}\0${value}`).digest('hex');
  }

  usernameFingerprint(username: string): string {
    return createHmac('sha256', this.auditKey).update(username).digest('hex').slice(0, 32);
  }

  cooldownSeconds(level: number): number {
    return Math.min(this.baseCooldownSeconds * 2 ** Math.min(level, 30), this.maxCooldownSeconds);
  }
}
