import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type {
  AuthUser,
  FileEntry,
  FileDeleteResponse,
  FileEntriesResponse,
  FilesStatus,
  FileOperationSummary,
} from '@cove/shared';
import type { FileOperation } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PermissionsService } from '../access-control/permissions.service';
import { FilesConfig } from './files-config';
import { SmbBindingsService } from './smb-bindings.service';
import { SmbAdapter, type WorkerHandle } from './smb-adapter';
import {
  isTemporaryName,
  UPLOAD_TEMP_PREFIX,
  childPath,
  errorCode,
  filesError,
  objectInput,
  relativePath,
} from './files-policy';
import { filesEvents } from './files-events';

type Active = {
  userId: string;
  version: string;
  authVersion: number;
  action: string;
  worker: WorkerHandle;
  operationId?: string;
};
type Snapshot = {
  userId: string;
  version: string;
  key: string;
  entries: FileEntry[];
  expires: number;
  bytes: number;
};
const unfinished = ['QUEUED', 'RUNNING', 'COMMITTING', 'RECONCILING'];

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private readonly active = new Map<string, Active>();
  private readonly reads = new Map<string, number>();
  private readonly snapshots = new Map<string, Snapshot>();
  private interval?: ReturnType<typeof setInterval>;
  private checking = false;
  private sweeping = false;
  constructor(
    private readonly db: PrismaService,
    readonly config: FilesConfig,
    private readonly permissions: PermissionsService,
    private readonly bindings: SmbBindingsService,
    private readonly smb: SmbAdapter,
  ) {}
  private readonly revoke = (userId: string) => {
    for (const entry of this.active.values()) if (entry.userId === userId) entry.worker.cancel();
    this.invalidateSnapshots(userId);
  };
  private invalidateSnapshots(userId: string): void {
    for (const [id, snapshot] of this.snapshots)
      if (snapshot.userId === userId) this.snapshots.delete(id);
  }
  private readonly check = () => {
    void this.checkActive().catch(() => {
      for (const entry of this.active.values()) entry.worker.cancel();
    });
  };
  async onModuleInit(): Promise<void> {
    filesEvents.on('revoke', this.revoke);
    filesEvents.on('recheck', this.check);
    if (!this.config.enabled) return;
    // A missing old key must not take down identity management; affected bindings report a safe error.
    await this.bindings.rotateKeys().catch(() => {});
    this.interval = setInterval(() => {
      this.check();
      void this.sweep().catch(() => {});
    }, 2000);
    this.interval.unref();
  }
  onModuleDestroy(): void {
    clearInterval(this.interval);
    filesEvents.off('revoke', this.revoke);
    filesEvents.off('recheck', this.check);
    for (const entry of this.active.values()) entry.worker.cancel();
  }
  async authorize(userId: string, action?: string, authVersion?: number) {
    const user = await this.permissions.getAuthUser(userId);
    if (!user || (authVersion !== undefined && user.authVersion !== authVersion))
      throw filesError('AUTH_EXPIRED');
    if (
      user.mustChangePassword ||
      (!user.isSuperAdmin &&
        (!user.permissions.includes('infra.files.page') ||
          (action && !user.permissions.includes(`infra.files.${action}`))))
    )
      throw filesError('FILES_FORBIDDEN');
    return user;
  }
  async status(actor: AuthUser): Promise<FilesStatus> {
    const user = await this.authorize(actor.id);
    const summary = await this.bindings.summary(actor.id);
    return {
      ...summary,
      capabilities: {
        upload: user.isSuperAdmin || user.permissions.includes('infra.files.upload'),
        download: user.isSuperAdmin || user.permissions.includes('infra.files.download'),
        mkdir: user.isSuperAdmin || user.permissions.includes('infra.files.mkdir'),
        rename: user.isSuperAdmin || user.permissions.includes('infra.files.rename'),
        delete: user.isSuperAdmin || user.permissions.includes('infra.files.delete'),
      },
      maxUploadBytes: String(this.config.maxUpload),
      maxActive: this.config.perUser,
    };
  }
  private async context(actor: AuthUser, action?: string) {
    const user = await this.authorize(actor.id, action);
    const { binding, credentials } = await this.bindings.get(actor.id);
    return { user, binding, credentials };
  }
  private async metadataCall<T>(
    actor: AuthUser,
    action: string,
    input: Record<string, unknown>,
    permission?: string,
  ): Promise<T> {
    const ctx = await this.context(actor, permission);
    const count = this.reads.get(actor.id) ?? 0;
    if (count >= 4 || [...this.reads.values()].reduce((a, b) => a + b, 0) >= this.config.global)
      throw filesError('RATE_LIMITED');
    this.reads.set(actor.id, count + 1);
    try {
      const result = await this.smb.call<T>(ctx.credentials, { action, ...input });
      await this.bindings.recordCheck(actor.id, ctx.binding.version, 'READY');
      const fresh = await this.context(actor, permission);
      if (
        fresh.binding.version !== ctx.binding.version ||
        fresh.user.authVersion !== ctx.user.authVersion
      )
        throw filesError('BINDING_CHANGED');
      return result;
    } catch (error) {
      await this.bindings.recordCheck(actor.id, ctx.binding.version, errorCode(error));
      await this.bindings.audit(actor.id, `files.${action}`, actor.id, 'FAILURE', errorCode(error));
      throw error;
    } finally {
      this.reads.set(actor.id, (this.reads.get(actor.id) ?? 1) - 1);
    }
  }
  async entries(actor: AuthUser, query: Record<string, unknown>): Promise<FileEntriesResponse> {
    const input = objectInput(query, [
      'path',
      'cursor',
      'limit',
      'sort',
      'direction',
      'filter',
      'showHidden',
    ]);
    const path = relativePath(input.path ?? '');
    const sort = String(input.sort ?? 'name'),
      direction = input.direction === 'desc' ? -1 : 1,
      filter = String(input.filter ?? '');
    if (!['name', 'modifiedAt', 'sizeBytes', 'type'].includes(sort) || filter.length > 256)
      throw filesError('INVALID_INPUT');
    const limit = Number(input.limit ?? 200);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw filesError('INVALID_INPUT');
    const ctx = await this.context(actor);
    const key = JSON.stringify([path, sort, direction, filter, input.showHidden === 'true']);
    for (const [id, snapshot] of this.snapshots)
      if (snapshot.expires < Date.now()) this.snapshots.delete(id);
    let snapshotId: string,
      offset = 0,
      snapshot: Snapshot;
    if (input.cursor) {
      if (typeof input.cursor !== 'string' || input.cursor.length > 100)
        throw filesError('INVALID_INPUT');
      const [id = '', index] = input.cursor.split(':');
      offset = Number(index);
      const cached = this.snapshots.get(id);
      if (
        !cached ||
        cached.userId !== actor.id ||
        cached.version !== ctx.binding.version ||
        cached.key !== key ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw filesError('BINDING_CHANGED');
      snapshotId = id;
      snapshot = cached;
    } else {
      const rows = await this.metadataCall<FileEntry[]>(actor, 'list', { path });
      const entries = rows.filter(
        (entry) =>
          !isTemporaryName(entry.name) &&
          (input.showHidden === 'true' || !entry.hidden) &&
          entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
      );
      const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        let comparison =
          sort === 'sizeBytes'
            ? BigInt(a.sizeBytes) < BigInt(b.sizeBytes)
              ? -1
              : BigInt(a.sizeBytes) > BigInt(b.sizeBytes)
                ? 1
                : 0
            : collator.compare(
                a[sort as 'name' | 'modifiedAt' | 'type'],
                b[sort as 'name' | 'modifiedAt' | 'type'],
              );
        if (comparison === 0)
          comparison = collator.compare(a.name, b.name) || a.name.localeCompare(b.name);
        return direction * comparison;
      });
      snapshotId = randomUUID();
      snapshot = {
        userId: actor.id,
        version: ctx.binding.version,
        key,
        entries,
        expires: Date.now() + 30000,
        bytes: Buffer.byteLength(JSON.stringify(entries)),
      };
      if (snapshot.bytes > 32 * 1024 * 1024) throw filesError('DIRECTORY_TOO_LARGE');
      // A user gets at most four snapshots; global metadata cache is bounded to 64 MiB.
      for (const [id, s] of this.snapshots)
        if (
          s.userId === actor.id &&
          [...this.snapshots.values()].filter((v) => v.userId === actor.id).length >= 4
        )
          this.snapshots.delete(id);
      while (
        this.snapshots.size &&
        [...this.snapshots.values()].reduce((n, s) => n + s.bytes, 0) + snapshot.bytes >
          64 * 1024 * 1024
      )
        this.snapshots.delete(this.snapshots.keys().next().value!);
      this.snapshots.set(snapshotId, snapshot);
    }
    return {
      path,
      entries: snapshot.entries.slice(offset, offset + limit),
      nextCursor:
        offset + limit < snapshot.entries.length ? `${snapshotId}:${offset + limit}` : null,
      snapshotId,
      total: snapshot.entries.length,
    };
  }
  stat(actor: AuthUser, path: unknown): Promise<FileEntry> {
    return this.metadataCall(actor, 'stat', { path: relativePath(path) });
  }
  async mkdir(actor: AuthUser, value: unknown): Promise<FileEntry> {
    const input = objectInput(value, ['parentPath', 'name']);
    const result = await this.metadataCall<FileEntry>(
      actor,
      'mkdir',
      { path: childPath(input.parentPath, input.name) },
      'mkdir',
    );
    await this.bindings.audit(actor.id, 'files.mkdir', actor.id, 'SUCCESS');
    this.invalidateSnapshots(actor.id);
    return result;
  }
  async rename(actor: AuthUser, value: unknown): Promise<FileEntry> {
    const input = objectInput(value, ['path', 'name']);
    const path = relativePath(input.path);
    if (!path) throw filesError('INVALID_PATH');
    const parentPath = path.split('/').slice(0, -1).join('/');
    const targetPath = childPath(parentPath, input.name);
    if (targetPath === path) throw filesError('INVALID_INPUT');
    const result = await this.metadataCall<FileEntry>(
      actor,
      'rename',
      { path, targetPath },
      'rename',
    );
    await this.bindings.audit(actor.id, 'files.rename', actor.id, 'SUCCESS');
    this.invalidateSnapshots(actor.id);
    return result;
  }
  async removeEntries(actor: AuthUser, value: unknown): Promise<FileDeleteResponse> {
    const input = objectInput(value, ['paths']);
    if (!Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 100)
      throw filesError('INVALID_INPUT');
    const paths = [...new Set(input.paths.map((path) => relativePath(path)))];
    if (paths.some((path) => !path)) throw filesError('INVALID_PATH');
    await this.context(actor, 'delete');
    const result: FileDeleteResponse = { deleted: [], failed: [] };
    for (const path of paths) {
      try {
        await this.metadataCall<boolean>(actor, 'delete', { path }, 'delete');
        result.deleted.push(path);
        await this.bindings.audit(actor.id, 'files.delete', actor.id, 'SUCCESS');
      } catch (error) {
        result.failed.push({ path, code: errorCode(error) });
      }
    }
    if (result.deleted.length) this.invalidateSnapshots(actor.id);
    return result;
  }
  private summary(operation: FileOperation): FileOperationSummary {
    return {
      id: operation.id,
      relativePath: operation.relativePath,
      expectedBytes: String(operation.expectedBytes),
      transferredBytes: String(operation.transferredBytes),
      state: operation.state,
      errorCode: operation.errorCode,
      createdAt: operation.createdAt.toISOString(),
    };
  }
  async createUpload(actor: AuthUser, value: unknown): Promise<FileOperationSummary> {
    const input = objectInput(value, ['parentPath', 'name', 'size', 'requestId']);
    const path = childPath(input.parentPath, input.name);
    if (
      typeof input.size !== 'string' ||
      !/^\d{1,16}$/.test(input.size) ||
      typeof input.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(input.requestId)
    )
      throw filesError('INVALID_INPUT');
    const size = BigInt(input.size);
    if (size > BigInt(this.config.maxUpload)) throw filesError('SIZE_LIMIT');
    const { user, binding } = await this.context(actor, 'upload');
    const id = randomUUID();
    const requestId = input.requestId;
    const row = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id} FOR UPDATE`;
      const existing = await tx.fileOperation.findUnique({
        where: {
          userId_bindingVersion_requestId: {
            userId: actor.id,
            bindingVersion: binding.version,
            requestId,
          },
        },
      });
      if (existing) {
        if (existing.relativePath !== path || existing.expectedBytes !== size)
          throw filesError('INVALID_INPUT');
        return existing;
      }
      if (
        (await tx.fileOperation.count({
          where: { userId: actor.id, state: { in: unfinished } },
        })) >= this.config.maxQueued
      )
        throw filesError('RATE_LIMITED');
      return tx.fileOperation.create({
        data: {
          id,
          userId: actor.id,
          requestId,
          bindingVersion: binding.version,
          configFingerprint: this.config.fingerprint,
          authVersion: user.authVersion,
          relativePath: path,
          tempPath: [relativePath(input.parentPath), `${UPLOAD_TEMP_PREFIX}${id}.part`]
            .filter(Boolean)
            .join('/'),
          expectedBytes: size,
          state: 'QUEUED',
          leaseExpiresAt: new Date(Date.now() + 3600000),
        },
      });
    });
    await this.bindings.audit(actor.id, 'files.upload.create', row.id, 'SUCCESS');
    return this.summary(row);
  }
  async operation(actor: AuthUser, id: string): Promise<FileOperationSummary> {
    await this.authorize(actor.id);
    const operation = await this.db.fileOperation.findFirst({ where: { id, userId: actor.id } });
    if (!operation) throw filesError('OPERATION_NOT_FOUND');
    return this.summary(operation);
  }
  async recent(actor: AuthUser): Promise<FileOperationSummary[]> {
    await this.authorize(actor.id);
    return (
      await this.db.fileOperation.findMany({
        where: { userId: actor.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).map((row) => this.summary(row));
  }
  private reserve(userId: string): void {
    this.smb.assertCapacity();
    if (
      this.active.size >= this.config.global ||
      [...this.active.values()].filter((e) => e.userId === userId).length >= this.config.perUser
    )
      throw filesError('RATE_LIMITED');
  }
  async upload(actor: AuthUser, id: string, request: Request): Promise<FileOperationSummary> {
    const { user, binding, credentials } = await this.context(actor, 'upload');
    const operation = await this.db.fileOperation.findFirst({ where: { id, userId: actor.id } });
    if (!operation) throw filesError('OPERATION_NOT_FOUND');
    if (operation.bindingVersion !== binding.version || operation.authVersion !== user.authVersion)
      throw filesError('BINDING_CHANGED');
    if (request.headers['content-type']?.split(';')[0] !== 'application/octet-stream')
      throw filesError('INVALID_INPUT');
    if (
      request.headers['content-length'] !== undefined &&
      request.headers['content-length'] !== String(operation.expectedBytes)
    )
      throw filesError('SIZE_MISMATCH');
    this.reserve(actor.id);
    const changed = await this.db.fileOperation.updateMany({
      where: { id, state: 'QUEUED' },
      data: {
        state: 'RUNNING',
        leaseExpiresAt: new Date(Date.now() + this.config.idleTimeout + 10000),
      },
    });
    if (!changed.count) throw filesError('FILE_BUSY');
    // Reserve again after the awaited claim; a rejected claim never starts a worker.
    try {
      this.reserve(actor.id);
    } catch (error) {
      await this.db.fileOperation.updateMany({
        where: { id, state: 'RUNNING' },
        data: { state: 'QUEUED' },
      });
      throw error;
    }
    let lastProgress = 0;
    const worker: WorkerHandle = this.smb.start(
      credentials,
      {
        action: 'write',
        path: operation.relativePath,
        tempPath: operation.tempPath,
        size: String(operation.expectedBytes),
      },
      async (event) => {
        if (event.created)
          await this.db.fileOperation.update({
            where: { id },
            data: { objectId: event.created.objectId, cleanupPending: true },
          });
        if (event.progress && Date.now() - lastProgress > 500) {
          lastProgress = Date.now();
          await this.db.fileOperation.updateMany({
            where: { id, state: 'RUNNING' },
            data: {
              transferredBytes: BigInt(event.progress),
              leaseExpiresAt: new Date(Date.now() + this.config.idleTimeout + 10000),
            },
          });
        }
        if (event.prepared) {
          await this.authorize(actor.id, 'upload', operation.authVersion);
          const current = await this.bindings.get(actor.id);
          if (current.binding.version !== operation.bindingVersion)
            throw filesError('BINDING_CHANGED');
          const claimed = await this.db.fileOperation.updateMany({
            where: { id, state: 'RUNNING' },
            data: {
              state: 'COMMITTING',
              transferredBytes: BigInt(event.prepared.bytes),
              objectId: event.prepared.objectId,
            },
          });
          if (!claimed.count) throw filesError('TRANSFER_INTERRUPTED');
          worker.commit();
        }
      },
    );
    this.active.set(id, {
      userId: actor.id,
      version: binding.version,
      authVersion: user.authVersion,
      action: 'upload',
      worker,
      operationId: id,
    });
    worker.output.resume();
    const abort = () => worker.cancel();
    request.once('aborted', abort);
    try {
      let bytes = 0n;
      // Race the inbound stream with the protocol worker so NAS timeouts also
      // finish requests whose clients stopped sending bytes.
      const sendBody = async () => {
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          bytes += BigInt(buffer.length);
          if (bytes > operation.expectedBytes) throw filesError('SIZE_MISMATCH');
          await this.smb.writeChunk(worker, buffer);
        }
        if (bytes !== operation.expectedBytes) throw filesError('SIZE_MISMATCH');
        worker.input.end();
        await worker.done;
      };
      await Promise.race([sendBody(), worker.done]);
      await this.db.fileOperation.updateMany({
        where: { id, state: 'COMMITTING' },
        data: {
          state: 'SUCCEEDED',
          transferredBytes: bytes,
          cleanupPending: false,
          errorCode: null,
        },
      });
      await this.bindings.audit(actor.id, 'files.upload.complete', id, 'SUCCESS');
      return await this.operation(actor, id);
    } catch (error) {
      worker.cancel();
      // The error response closes the HTTP connection and releases a stalled reader.
      if (!request.readableEnded && !request.res?.headersSent)
        request.res?.setHeader('Connection', 'close');
      await worker.done.catch(() => {});
      const current = await this.db.fileOperation.findUnique({ where: { id } });
      if (current)
        await this.db.fileOperation.updateMany({
          where: { id, state: { in: ['RUNNING', 'COMMITTING'] } },
          data: {
            state: current.state === 'COMMITTING' ? 'RECONCILING' : 'FAILED',
            errorCode: errorCode(error),
          },
        });
      await this.bindings.audit(actor.id, 'files.upload.complete', id, 'FAILURE', errorCode(error));
      throw error;
    } finally {
      request.off('aborted', abort);
      this.active.delete(id);
    }
  }
  async cancel(actor: AuthUser, id: string): Promise<FileOperationSummary> {
    await this.authorize(actor.id);
    const row = await this.db.fileOperation.findFirst({ where: { id, userId: actor.id } });
    if (!row) throw filesError('OPERATION_NOT_FOUND');
    if (row.state === 'COMMITTING' || row.state === 'RECONCILING') throw filesError('FILE_BUSY');
    await this.db.fileOperation.updateMany({
      where: { id, userId: actor.id, state: { in: ['QUEUED', 'RUNNING'] } },
      data: { state: 'CANCELED', errorCode: 'TRANSFER_INTERRUPTED' },
    });
    this.active.get(id)?.worker.cancel();
    return this.operation(actor, id);
  }
  async ticket(actor: AuthUser, value: unknown) {
    const input = objectInput(value, ['path']);
    const path = relativePath(input.path);
    if (!path) throw filesError('INVALID_PATH');
    const { user, binding } = await this.context(actor, 'download');
    const id = randomUUID(),
      secret = randomBytes(32).toString('hex');
    if (
      (await this.db.downloadTicket.count({
        where: { userId: actor.id, expiresAt: { gt: new Date() }, consumedAt: null },
      })) >= 20
    )
      throw filesError('RATE_LIMITED');
    await this.db.downloadTicket.create({
      data: {
        id,
        secretHash: createHash('sha256').update(secret).digest('hex'),
        userId: actor.id,
        authVersion: user.authVersion,
        bindingVersion: binding.version,
        configFingerprint: this.config.fingerprint,
        relativePath: path,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    return { id, secret, url: `/api/files/downloads/${id}/content` };
  }
  async download(id: string, secret: string, response: Response): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(secret)) throw filesError('FILES_FORBIDDEN');
    const ticket = await this.db.downloadTicket.findFirst({
      where: {
        id,
        secretHash: createHash('sha256').update(secret).digest('hex'),
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!ticket) throw filesError('FILES_FORBIDDEN');
    const user = await this.authorize(ticket.userId, 'download', ticket.authVersion);
    const { binding, credentials } = await this.bindings.get(user.id);
    if (
      binding.version !== ticket.bindingVersion ||
      ticket.configFingerprint !== this.config.fingerprint
    )
      throw filesError('BINDING_CHANGED');
    this.reserve(user.id);
    const consumed = await this.db.downloadTicket.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (!consumed.count) throw filesError('FILES_FORBIDDEN');
    this.reserve(user.id);
    let resolveReady!: (entry: FileEntry) => void;
    const ready = new Promise<FileEntry>((resolve) => {
      resolveReady = resolve;
    });
    const worker = this.smb.start(
      credentials,
      { action: 'read', path: ticket.relativePath },
      (event) => {
        if (event.ready) resolveReady(event.ready);
      },
    );
    worker.input.end();
    this.active.set(id, {
      userId: user.id,
      version: binding.version,
      authVersion: user.authVersion,
      action: 'download',
      worker,
    });
    const abort = () => {
      if (!response.writableFinished) worker.cancel();
    };
    response.once('close', abort);
    try {
      const entry = await Promise.race([
        ready,
        worker.done.then(() => {
          throw filesError('TRANSFER_INTERRUPTED');
        }),
      ]);
      const fallback = entry.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('Content-Length', entry.sizeBytes);
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(entry.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      );
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const output = Readable.from(
        (async function* () {
          for await (const chunk of worker.output) yield chunk;
          await worker.done;
        })(),
      );
      await pipeline(output, response);
      await this.bindings.audit(user.id, 'files.download.complete', id, 'SUCCESS');
    } catch (error) {
      worker.cancel();
      await this.bindings.audit(
        user.id,
        'files.download.complete',
        id,
        'FAILURE',
        errorCode(error),
      );
      if (response.headersSent) {
        response.destroy();
        return;
      }
      throw error;
    } finally {
      response.off('close', abort);
      this.active.delete(id);
    }
  }
  private async checkActive(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const active of this.active.values()) {
        try {
          await this.authorize(active.userId, active.action, active.authVersion);
          const ctx = await this.bindings.get(active.userId);
          if (ctx.binding.version !== active.version) throw filesError('BINDING_CHANGED');
        } catch {
          active.worker.cancel();
        }
      }
    } finally {
      this.checking = false;
    }
  }
  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.db.downloadTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const expired = await this.db.fileOperation.findMany({
        where: { state: { in: ['RUNNING', 'COMMITTING'] }, leaseExpiresAt: { lt: new Date() } },
        take: 20,
      });
      for (const row of expired) {
        if (this.active.has(row.id)) continue;
        await this.db.fileOperation.updateMany({
          where: { id: row.id, state: row.state, leaseExpiresAt: { lt: new Date() } },
          data: {
            state: row.state === 'COMMITTING' ? 'RECONCILING' : 'INTERRUPTED',
            errorCode: 'TRANSFER_INTERRUPTED',
          },
        });
      }

      await this.db.fileOperation.updateMany({
        where: { state: 'QUEUED', leaseExpiresAt: { lt: new Date() } },
        data: { state: 'INTERRUPTED', errorCode: 'TRANSFER_INTERRUPTED' },
      });
      const rows = await this.db.fileOperation.findMany({
        where: {
          OR: [
            { state: 'RECONCILING' },
            {
              cleanupPending: true,
              state: { in: ['FAILED', 'CANCELED', 'INTERRUPTED'] },
              updatedAt: { lt: new Date(Date.now() - 86400000) },
            },
          ],
        },
        take: 5,
      });
      for (const row of rows) {
        if (this.active.has(row.id) || !row.objectId) continue;
        try {
          const user = await this.authorize(row.userId);
          const { binding, credentials } = await this.bindings.get(row.userId);
          if (binding.version !== row.bindingVersion) continue;
          if (row.state === 'RECONCILING') {
            const stat = await this.smb.call<FileEntry>(credentials, {
              action: 'stat',
              path: row.relativePath,
            });
            if (stat.objectId === row.objectId && stat.sizeBytes === String(row.expectedBytes))
              await this.db.fileOperation.updateMany({
                where: { id: row.id, state: 'RECONCILING' },
                data: { state: 'SUCCEEDED', cleanupPending: false, errorCode: null },
              });
            else
              await this.db.fileOperation.updateMany({
                where: { id: row.id, state: 'RECONCILING' },
                data: { state: 'INTERRUPTED', errorCode: 'TRANSFER_INTERRUPTED' },
              });
          } else {
            await this.smb.call(credentials, {
              action: 'cleanup',
              path: row.tempPath,
              objectId: row.objectId,
            });
            await this.db.fileOperation.updateMany({
              where: { id: row.id, state: row.state },
              data: { cleanupPending: false },
            });
          }
          void user;
        } catch (error) {
          if (errorCode(error) === 'PATH_NOT_FOUND')
            await this.db.fileOperation.updateMany({
              where: { id: row.id, state: row.state },
              data:
                row.state === 'RECONCILING'
                  ? { state: 'INTERRUPTED', errorCode: 'TRANSFER_INTERRUPTED' }
                  : { cleanupPending: false },
            });
        }
      }
      await this.db.fileOperation.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - 7 * 86400000) },
          state: { notIn: unfinished },
          cleanupPending: false,
        },
      });
    } finally {
      this.sweeping = false;
    }
  }
}
