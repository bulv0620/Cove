/* eslint-disable no-control-regex -- Explicitly reject control characters in untrusted SMB input. */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthUser, SmbBindingSummary } from '@cove/shared';
import { PrismaService } from '../../database/prisma.service';
import { FilesConfig } from './files-config';
import { SmbAdapter, type SmbCredentials } from './smb-adapter';
import { filesError, errorCode, objectInput } from './files-policy';
import { filesEvents } from './files-events';

@Injectable()
export class SmbBindingsService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly db: PrismaService,
    readonly config: FilesConfig,
    private readonly smb: SmbAdapter,
  ) {}
  async summary(userId: string): Promise<SmbBindingSummary> {
    const binding = await this.db.smbBinding.findUnique({ where: { userId } });
    return {
      enabled: this.config.enabled,
      bound: !!binding,
      username: binding?.username ?? null,
      version: binding?.version ?? null,
      state: !this.config.enabled
        ? 'SMB_DISABLED'
        : !binding
          ? 'SMB_NOT_BOUND'
          : binding.configFingerprint !== this.config.fingerprint
            ? 'SMB_CONFIG_CHANGED'
            : binding.lastCheckCode,
      lastCheckedAt: binding?.lastCheckedAt.toISOString() ?? null,
      share: this.config.share,
      domain: this.config.domain,
    };
  }
  async get(userId: string) {
    this.config.assertEnabled();
    const binding = await this.db.smbBinding.findUnique({ where: { userId } });
    if (!binding) throw filesError('SMB_NOT_BOUND');
    if (binding.configFingerprint !== this.config.fingerprint)
      throw filesError('SMB_CONFIG_CHANGED');
    return {
      binding,
      credentials: { username: binding.username, password: this.config.unseal(binding) },
    };
  }
  async recordCheck(userId: string, version: string, code: string): Promise<void> {
    await this.db.smbBinding.updateMany({
      where: { userId, version },
      data: { lastCheckedAt: new Date(), lastCheckCode: code },
    });
  }
  async audit(
    actorUserId: string,
    action: string,
    targetId: string,
    result: 'SUCCESS' | 'FAILURE',
    code?: string,
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId,
        action,
        targetType: 'files',
        targetId,
        result,
        metadata: code ? { code } : {},
      },
    });
  }
  private validate(value: unknown): SmbCredentials & { expectedVersion: string | null } {
    const input = objectInput(value, ['username', 'password', 'expectedVersion']);
    if (
      typeof input.username !== 'string' ||
      !input.username.trim() ||
      input.username.length > 256 ||
      /[\\/\u0000-\u001f]/.test(input.username) ||
      typeof input.password !== 'string' ||
      !input.password ||
      input.password.length > 4096 ||
      input.password.includes('\0') ||
      (input.expectedVersion !== null &&
        input.expectedVersion !== undefined &&
        typeof input.expectedVersion !== 'string')
    )
      throw filesError('INVALID_INPUT');
    return {
      username: input.username.trim(),
      password: input.password,
      expectedVersion: typeof input.expectedVersion === 'string' ? input.expectedVersion : null,
    };
  }
  private limit(actor: string): void {
    const now = Date.now();
    for (const [key, val] of this.attempts) if (val.until < now) this.attempts.delete(key);
    const entry = this.attempts.get(actor) ?? { count: 0, until: now + 60000 };
    if (entry.count >= 10) throw filesError('RATE_LIMITED');
    entry.count++;
    this.attempts.set(actor, entry);
  }
  async test(userId: string, value: unknown, actor: AuthUser) {
    this.config.assertEnabled();
    this.limit(actor.id);
    if (!(await this.db.user.findUnique({ where: { id: userId }, select: { id: true } })))
      throw filesError('PATH_NOT_FOUND');
    const input = this.validate(value);
    try {
      const result = await this.smb.call<{
        connected: boolean;
        dialect: string;
        encrypted: boolean;
      }>(input, { action: 'test', path: '' });
      return result;
    } catch (error) {
      await this.audit(actor.id, 'files.binding.test', userId, 'FAILURE', errorCode(error));
      throw error;
    }
  }
  async save(userId: string, value: unknown, actor: AuthUser): Promise<SmbBindingSummary> {
    const input = this.validate(value);
    await this.test(userId, input, actor);
    const version = randomUUID();
    const encrypted = this.config.seal(input.password, userId, version);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const current = await tx.smbBinding.findUnique({ where: { userId } });
      if ((current?.version ?? null) !== input.expectedVersion) throw filesError('BINDING_CHANGED');
      await tx.smbBinding.upsert({
        where: { userId },
        create: {
          userId,
          username: input.username,
          version,
          ...encrypted,
          configFingerprint: this.config.fingerprint,
          lastCheckedAt: new Date(),
          lastCheckCode: 'READY',
        },
        update: {
          username: input.username,
          version,
          ...encrypted,
          configFingerprint: this.config.fingerprint,
          lastCheckedAt: new Date(),
          lastCheckCode: 'READY',
        },
      });
      await tx.downloadTicket.deleteMany({ where: { userId } });
    });
    filesEvents.emit('revoke', userId);
    await this.audit(actor.id, 'files.binding.save', userId, 'SUCCESS');
    return this.summary(userId);
  }
  async remove(userId: string, actor: AuthUser): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx.smbBinding.deleteMany({ where: { userId } });
      await tx.downloadTicket.deleteMany({ where: { userId } });
      await tx.fileOperation.updateMany({
        where: { userId, state: { in: ['QUEUED', 'RUNNING'] } },
        data: { state: 'CANCELED', errorCode: 'SMB_NOT_BOUND' },
      });
    });
    filesEvents.emit('revoke', userId);
    await this.audit(actor.id, 'files.binding.remove', userId, 'SUCCESS');
  }
  async rotateKeys(): Promise<void> {
    if (!this.config.enabled) return;
    const rows = await this.db.smbBinding.findMany({
      where: { keyId: { not: this.config.keyId }, configFingerprint: this.config.fingerprint },
    });
    for (const row of rows) {
      const password = this.config.unseal(row);
      await this.db.smbBinding.updateMany({
        where: { userId: row.userId, version: row.version, keyId: row.keyId },
        data: this.config.seal(password, row.userId, row.version),
      });
    }
  }
}
