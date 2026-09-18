import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type {
  AuthUser,
  FileEntry,
  HostedImage,
  HostedImagesResponse,
  ImageHostingStatus,
  ImageUploadSummary,
} from '@cove/shared';
import type { ImageAsset } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PermissionsService } from '../access-control/permissions.service';
import { FilesConfig } from '../files/files-config';
import { errorCode, fileName, filesError, objectInput } from '../files/files-policy';
import { SmbAdapter, type WorkerHandle } from '../files/smb-adapter';
import { SmbBindingsService } from '../files/smb-bindings.service';

const ROOT = 'Image Hosting';
const CACHE = `${ROOT}/.cove-cache`;
const THUMBNAILS = `${CACHE}/thumbnails`;
const supportedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const unfinished = ['QUEUED', 'RUNNING', 'COMMITTING'];

type ImageInspection = {
  bytes: string;
  objectId: string;
  mediaType: string;
  extension: string;
  sha256: string;
};

type ActiveUpload = { userId: string; worker: WorkerHandle };

@Injectable()
export class ImagesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImagesService.name);
  private readonly active = new Map<string, ActiveUpload>();
  private readonly publicActive = new Map<string, number>();
  private recoveryTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly bindings: SmbBindingsService,
    private readonly smb: SmbAdapter,
    private readonly config: FilesConfig,
  ) {}

  onModuleInit(): void {
    void this.recover().catch((error: unknown) =>
      this.logger.warn(`Image recovery deferred: ${errorCode(error)}`),
    );
    this.recoveryTimer = setInterval(
      () =>
        void this.recover().catch((error: unknown) =>
          this.logger.warn(`Image recovery deferred: ${errorCode(error)}`),
        ),
      300000,
    );
    this.recoveryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    for (const upload of this.active.values()) upload.worker.cancel();
  }

  private async recover(): Promise<void> {
    const rows = await this.db.imageAsset.findMany({
      where: {
        OR: [
          {
            cleanupPending: true,
            OR: [{ errorCode: null }, { errorCode: { not: 'BINDING_CHANGED' } }],
          },
          { state: { in: unfinished }, leaseExpiresAt: { lt: new Date() } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
    for (const row of rows) await this.recoverAsset(row);
  }

  private async recoverAsset(asset: ImageAsset): Promise<void> {
    const bound = await this.bindings.get(asset.userId).catch(() => null);
    if (!bound || bound.binding.version !== asset.bindingVersion) {
      await this.revoke(asset.id);
      await this.db.imageAsset.updateMany({
        where: { id: asset.id },
        data: {
          state: 'REVOKED',
          cleanupPending: asset.cleanupPending,
          errorCode: 'BINDING_CHANGED',
        },
      });
      return;
    }
    if (asset.state === 'CLEANUP_PENDING') {
      if (!asset.objectId) return;
      try {
        await this.smb.call(bound.credentials, {
          action: 'delete_object',
          path: asset.relativePath,
          objectId: asset.objectId,
        });
        await this.db.imageAsset.deleteMany({ where: { id: asset.id } });
      } catch (error) {
        const code = errorCode(error);
        if (code === 'PATH_NOT_FOUND')
          await this.db.imageAsset.deleteMany({ where: { id: asset.id } });
        else if (code === 'OBJECT_CHANGED')
          await this.db.imageAsset.updateMany({
            where: { id: asset.id },
            data: { state: 'REVOKED', cleanupPending: false, errorCode: code },
          });
      }
      return;
    }
    if (asset.state === 'COMMITTING' && asset.objectId) {
      try {
        const stat = await this.smb.call<FileEntry>(bound.credentials, {
          action: 'stat',
          path: asset.relativePath,
        });
        if (stat.objectId !== asset.objectId || stat.sizeBytes !== String(asset.sizeBytes))
          throw filesError('OBJECT_CHANGED');
        await this.db.imageAsset.update({
          where: { id: asset.id },
          data: {
            state: 'PRIVATE',
            cleanupPending: false,
            errorCode: null,
            sourceModifiedAt: new Date(stat.modifiedAt),
            lastSeenAt: new Date(),
          },
        });
        if (asset.publishRequested && asset.mediaType && asset.sha256)
          await this.publish(asset.id, asset.userId, asset.bindingVersion);
        return;
      } catch (error) {
        if (!['PATH_NOT_FOUND', 'OBJECT_CHANGED'].includes(errorCode(error))) return;
      }
    }
    if (asset.tempPath && asset.objectId) {
      try {
        await this.smb.call(bound.credentials, {
          action: 'cleanup',
          path: asset.tempPath,
          objectId: asset.objectId,
        });
      } catch (error) {
        if (!['PATH_NOT_FOUND', 'OBJECT_CHANGED'].includes(errorCode(error))) return;
      }
    }
    await this.db.imageAsset.updateMany({
      where: { id: asset.id },
      data: {
        state: 'FAILED',
        cleanupPending: false,
        errorCode: asset.errorCode ?? 'TRANSFER_INTERRUPTED',
      },
    });
  }

  private async authorize(userId: string, action?: 'upload' | 'publish' | 'delete') {
    const user = await this.permissions.getAuthUser(userId);
    if (!user) throw filesError('AUTH_EXPIRED');
    if (
      user.mustChangePassword ||
      (!user.isSuperAdmin &&
        (!user.permissions.includes('infra.images.page') ||
          (action && !user.permissions.includes(`infra.images.${action}`))))
    )
      throw filesError('FILES_FORBIDDEN');
    return user;
  }

  private async context(actor: AuthUser, action?: 'upload' | 'publish' | 'delete') {
    const user = await this.authorize(actor.id, action);
    const { binding, credentials } = await this.bindings.get(actor.id);
    return { user, binding, credentials };
  }

  private async audit(
    actorUserId: string,
    action: string,
    assetId: string,
    result: 'SUCCESS' | 'FAILURE',
    code?: string,
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId,
        action,
        targetType: 'image',
        targetId: assetId,
        result,
        metadata: code ? { code } : {},
      },
    });
  }

  async status(actor: AuthUser): Promise<ImageHostingStatus> {
    const user = await this.authorize(actor.id);
    const summary = await this.bindings.summary(actor.id);
    return {
      ...summary,
      rootPath: ROOT,
      maxUploadBytes: String(this.config.imageMaxUpload),
      capabilities: {
        upload: user.isSuperAdmin || user.permissions.includes('infra.images.upload'),
        publish: user.isSuperAdmin || user.permissions.includes('infra.images.publish'),
        delete: user.isSuperAdmin || user.permissions.includes('infra.images.delete'),
      },
    };
  }

  private async ensureDirectory(credentials: { username: string; password: string }, path: string) {
    try {
      const current = await this.smb.call<FileEntry>(credentials, { action: 'stat', path });
      if (current.type !== 'directory') throw filesError('NAME_CONFLICT');
    } catch (error) {
      if (errorCode(error) !== 'PATH_NOT_FOUND') throw error;
      await this.smb.call(credentials, { action: 'mkdir', path });
    }
  }

  private async ensureRoot(credentials: { username: string; password: string }) {
    await this.ensureDirectory(credentials, ROOT);
  }

  private extension(name: string): string | null {
    const extension = name.includes('.') ? (name.split('.').pop()?.toLowerCase() ?? '') : '';
    if (!supportedExtensions.has(extension)) return null;
    return extension === 'jpeg' ? 'jpg' : extension;
  }

  private async enumerate(
    credentials: { username: string; password: string },
    path = ROOT,
    rows: FileEntry[] = [],
    depth = 0,
    budget = { count: 0 },
  ): Promise<FileEntry[]> {
    if (depth > 12 || budget.count > this.config.maxEntries)
      throw filesError('DIRECTORY_TOO_LARGE');
    const entries = await this.smb.call<FileEntry[]>(credentials, { action: 'list', path });
    for (const entry of entries) {
      budget.count++;
      if (budget.count > this.config.maxEntries) throw filesError('DIRECTORY_TOO_LARGE');
      if (!entry.supported || entry.name.toLowerCase().startsWith('.cove-upload-')) continue;
      if (entry.type === 'directory') {
        if (entry.relativePath === CACHE || entry.relativePath.startsWith(`${CACHE}/`)) continue;
        await this.enumerate(credentials, entry.relativePath, rows, depth + 1, budget);
      } else if (this.extension(entry.name)) {
        rows.push(entry);
      }
    }
    return rows;
  }

  private async sync(actor: AuthUser) {
    const ctx = await this.context(actor);
    await this.ensureRoot(ctx.credentials);
    const seenAt = new Date();
    const entries = await this.enumerate(ctx.credentials);
    const current = await this.db.imageAsset.findMany({
      where: { userId: actor.id, bindingVersion: ctx.binding.version },
    });
    const byObject = new Map(
      current.filter((row) => row.objectId).map((row) => [row.objectId as string, row]),
    );
    // Break path-uniqueness cycles before applying stable-object renames (for example A↔B via Files).
    for (const entry of entries) {
      const matched = entry.objectId ? byObject.get(entry.objectId) : undefined;
      if (!matched || matched.relativePath === entry.relativePath) continue;
      const stagingPath = `${ROOT}/.cove-index-${matched.id}`;
      await this.db.imageAsset.update({
        where: { id: matched.id },
        data: { relativePath: stagingPath },
      });
      matched.relativePath = stagingPath;
    }
    const seenIds = new Set<string>();
    for (const entry of entries) {
      const extension = this.extension(entry.name)!;
      const matched = entry.objectId ? byObject.get(entry.objectId) : undefined;
      const modifiedAt = new Date(entry.modifiedAt);
      if (matched) {
        const changed =
          matched.sizeBytes !== BigInt(entry.sizeBytes) ||
          matched.sourceModifiedAt?.getTime() !== modifiedAt.getTime() ||
          matched.extension !== extension;
        if (changed) await this.revoke(matched.id);
        seenIds.add(matched.id);
        await this.db.imageAsset.update({
          where: { id: matched.id },
          data: {
            relativePath: entry.relativePath,
            sizeBytes: BigInt(entry.sizeBytes),
            extension,
            sourceModifiedAt: modifiedAt,
            lastSeenAt: seenAt,
            ...(changed
              ? { state: 'PRIVATE', errorCode: null, mediaType: null, sha256: null }
              : matched.state === 'MISSING'
                ? { state: 'PRIVATE', errorCode: null }
                : {}),
          },
        });
        continue;
      }
      const existing = current.find((row) => row.relativePath === entry.relativePath);
      if (existing) {
        seenIds.add(existing.id);
        const changed =
          (!!existing.objectId && !!entry.objectId && existing.objectId !== entry.objectId) ||
          existing.sizeBytes !== BigInt(entry.sizeBytes) ||
          existing.sourceModifiedAt?.getTime() !== modifiedAt.getTime() ||
          existing.extension !== extension;
        if (changed) await this.revoke(existing.id);
        await this.db.imageAsset.update({
          where: { id: existing.id },
          data: {
            objectId: entry.objectId ?? null,
            sizeBytes: BigInt(entry.sizeBytes),
            extension,
            sourceModifiedAt: modifiedAt,
            lastSeenAt: seenAt,
            state: changed || existing.state === 'MISSING' ? 'PRIVATE' : existing.state,
            errorCode: null,
            ...(changed ? { mediaType: null, sha256: null } : {}),
          },
        });
      } else {
        const row = await this.db.imageAsset.create({
          data: {
            id: randomUUID(),
            userId: actor.id,
            bindingVersion: ctx.binding.version,
            configFingerprint: this.config.fingerprint,
            relativePath: entry.relativePath,
            objectId: entry.objectId ?? null,
            extension,
            sizeBytes: BigInt(entry.sizeBytes),
            sourceModifiedAt: modifiedAt,
            lastSeenAt: seenAt,
            state: 'PRIVATE',
          },
        });
        seenIds.add(row.id);
      }
    }
    const missing = current.filter(
      (row) => !seenIds.has(row.id) && !unfinished.includes(row.state) && row.state !== 'REVOKED',
    );
    for (const row of missing) {
      await this.revoke(row.id);
      await this.db.imageAsset.update({
        where: { id: row.id },
        data: { state: 'MISSING', errorCode: 'PATH_NOT_FOUND' },
      });
    }
    return { ctx, syncedAt: seenAt };
  }

  async list(actor: AuthUser, query: Record<string, unknown>): Promise<HostedImagesResponse> {
    const input = objectInput(query, ['cursor', 'limit', 'filter', 'visibility', 'sort']);
    const limit = Number(input.limit ?? 48);
    const offset = Number(input.cursor ?? 0);
    const filter = typeof input.filter === 'string' ? input.filter.slice(0, 256) : '';
    const visibility = ['private', 'public'].includes(String(input.visibility))
      ? String(input.visibility)
      : 'all';
    const sort = ['name', 'size', 'modified'].includes(String(input.sort))
      ? String(input.sort)
      : 'modified';
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw filesError('INVALID_INPUT');
    const { ctx, syncedAt } = await this.sync(actor);
    const where = {
      userId: actor.id,
      bindingVersion: ctx.binding.version,
      state: {
        in:
          visibility === 'public'
            ? ['PUBLIC']
            : visibility === 'private'
              ? ['PRIVATE']
              : ['PRIVATE', 'PUBLIC', 'CLEANUP_PENDING'],
      },
      ...(filter ? { relativePath: { contains: filter } } : {}),
    };
    const orderBy =
      sort === 'name'
        ? { relativePath: 'asc' as const }
        : sort === 'size'
          ? { sizeBytes: 'desc' as const }
          : { sourceModifiedAt: 'desc' as const };
    const unverified = await this.db.imageAsset.findMany({
      where: { ...where, state: 'PRIVATE', mediaType: null },
      orderBy,
      take: limit,
    });
    for (const asset of unverified) {
      try {
        await this.inspect(asset, ctx.credentials);
      } catch (error) {
        const code = errorCode(error);
        if (!['INVALID_IMAGE', 'UNSUPPORTED_IMAGE', 'SIZE_LIMIT'].includes(code)) throw error;
        await this.revoke(asset.id);
        await this.db.imageAsset.update({
          where: { id: asset.id },
          data: { state: 'REVOKED', errorCode: code },
        });
      }
    }
    const [rows, total] = await Promise.all([
      this.db.imageAsset.findMany({
        where,
        include: { publicGrants: { where: { revokedAt: null }, take: 1 } },
        orderBy,
        skip: offset,
        take: limit,
      }),
      this.db.imageAsset.count({ where }),
    ]);
    return {
      images: rows.map((row) => this.hosted(row, row.publicGrants[0]?.publicId ?? null)),
      nextCursor: offset + rows.length < total ? String(offset + rows.length) : null,
      total,
      syncedAt: syncedAt.toISOString(),
    };
  }

  private hosted(asset: ImageAsset, publicId: string | null): HostedImage {
    return {
      id: asset.id,
      name: asset.relativePath.split('/').pop() ?? asset.relativePath,
      mediaType: asset.mediaType,
      sizeBytes: String(asset.sizeBytes),
      modifiedAt: asset.sourceModifiedAt?.toISOString() ?? null,
      state: asset.state,
      isPublic: asset.state === 'PUBLIC' && !!publicId,
      publicUrl: asset.state === 'PUBLIC' && publicId ? `/image/${publicId}` : null,
      errorCode: asset.errorCode,
      thumbnailUrl: `/api/images/${asset.id}/thumbnail?v=${asset.updatedAt.getTime()}`,
      previewUrl: `/api/images/${asset.id}/preview?v=${asset.updatedAt.getTime()}`,
    };
  }

  private uploadSummary(asset: ImageAsset): ImageUploadSummary {
    return {
      id: asset.id,
      name: asset.relativePath.split('/').pop() ?? asset.relativePath,
      expectedBytes: String(asset.sizeBytes),
      transferredBytes: asset.state === 'QUEUED' ? '0' : String(asset.sizeBytes),
      state: asset.state,
      errorCode: asset.errorCode,
      createdAt: asset.createdAt.toISOString(),
    };
  }

  async createUpload(actor: AuthUser, value: unknown): Promise<ImageUploadSummary> {
    const input = objectInput(value, ['name', 'size', 'requestId', 'publish']);
    if (
      typeof input.name !== 'string' ||
      typeof input.size !== 'string' ||
      !/^\d{1,12}$/.test(input.size) ||
      typeof input.requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(input.requestId) ||
      typeof input.publish !== 'boolean'
    )
      throw filesError('INVALID_INPUT');
    const cleanName = fileName(input.name);
    const extension = this.extension(cleanName);
    if (!extension) throw filesError('UNSUPPORTED_IMAGE');
    const size = BigInt(input.size);
    if (size < 1n || size > BigInt(this.config.imageMaxUpload)) throw filesError('SIZE_LIMIT');
    const ctx = await this.context(actor, 'upload');
    if (input.publish) await this.authorize(actor.id, 'publish');
    await this.ensureRoot(ctx.credentials);
    const id = randomUUID();
    const base = cleanName.slice(0, cleanName.lastIndexOf('.')).slice(0, 180) || 'image';
    const storedName = `${base}-${id.slice(0, 8)}.${extension}`;
    const path = `${ROOT}/${storedName}`;
    const existing = await this.db.imageAsset.findUnique({
      where: {
        userId_bindingVersion_requestId: {
          userId: actor.id,
          bindingVersion: ctx.binding.version,
          requestId: input.requestId,
        },
      },
    });
    if (existing) return this.uploadSummary(existing);
    const queued = await this.db.imageAsset.count({
      where: { userId: actor.id, state: { in: unfinished } },
    });
    if (queued >= this.config.maxQueued) throw filesError('RATE_LIMITED');
    const row = await this.db.imageAsset.create({
      data: {
        id,
        userId: actor.id,
        bindingVersion: ctx.binding.version,
        configFingerprint: this.config.fingerprint,
        requestId: input.requestId,
        relativePath: path,
        tempPath: `${ROOT}/.cove-upload-${id}.part`,
        extension,
        sizeBytes: size,
        state: 'QUEUED',
        publishRequested: input.publish,
        leaseExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    return this.uploadSummary(row);
  }

  async upload(actor: AuthUser, id: string, request: Request): Promise<HostedImage> {
    const ctx = await this.context(actor, 'upload');
    const asset = await this.db.imageAsset.findFirst({ where: { id, userId: actor.id } });
    if (!asset) throw filesError('OPERATION_NOT_FOUND');
    if (asset.bindingVersion !== ctx.binding.version) throw filesError('BINDING_CHANGED');
    if (request.headers['content-type']?.split(';')[0] !== 'application/octet-stream')
      throw filesError('INVALID_INPUT');
    if (
      request.headers['content-length'] !== undefined &&
      request.headers['content-length'] !== String(asset.sizeBytes)
    )
      throw filesError('SIZE_MISMATCH');
    if (
      [...this.active.values()].filter((item) => item.userId === actor.id).length >=
      this.config.perUser
    )
      throw filesError('RATE_LIMITED');
    const claimed = await this.db.imageAsset.updateMany({
      where: { id, state: 'QUEUED' },
      data: {
        state: 'RUNNING',
        leaseExpiresAt: new Date(Date.now() + this.config.idleTimeout + 10000),
      },
    });
    if (!claimed.count) throw filesError('FILE_BUSY');
    let prepared:
      | { bytes: string; objectId: string; mediaType?: string; extension?: string; sha256?: string }
      | undefined;
    const worker = this.smb.start(
      ctx.credentials,
      {
        action: 'write',
        path: asset.relativePath,
        tempPath: asset.tempPath,
        size: String(asset.sizeBytes),
        validateImage: true,
        expectedExtension: asset.extension === 'jpeg' ? 'jpeg' : asset.extension,
      },
      async (event) => {
        if (event.created)
          await this.db.imageAsset.update({
            where: { id },
            data: { objectId: event.created.objectId, cleanupPending: true },
          });
        if (event.prepared) {
          prepared = event.prepared;
          const fresh = await this.bindings.get(actor.id);
          if (fresh.binding.version !== asset.bindingVersion) throw filesError('BINDING_CHANGED');
          await this.db.imageAsset.update({
            where: { id },
            data: {
              state: 'COMMITTING',
              objectId: event.prepared.objectId,
              mediaType: event.prepared.mediaType,
              extension: event.prepared.extension,
              sha256: event.prepared.sha256,
            },
          });
          worker.commit();
        }
      },
    );
    this.active.set(id, { userId: actor.id, worker });
    worker.output.resume();
    const abort = () => worker.cancel();
    request.once('aborted', abort);
    try {
      let bytes = 0n;
      const send = async () => {
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          bytes += BigInt(buffer.length);
          if (bytes > asset.sizeBytes) throw filesError('SIZE_MISMATCH');
          await this.smb.writeChunk(worker, buffer);
        }
        if (bytes !== asset.sizeBytes) throw filesError('SIZE_MISMATCH');
        worker.input.end();
        await worker.done;
      };
      await Promise.race([send(), worker.done]);
      if (!prepared?.mediaType || !prepared.extension || !prepared.sha256)
        throw filesError('INVALID_IMAGE');
      const stat = await this.smb.call<FileEntry>(ctx.credentials, {
        action: 'stat',
        path: asset.relativePath,
      });
      const freshBinding = await this.bindings.get(actor.id);
      if (freshBinding.binding.version !== asset.bindingVersion)
        throw filesError('BINDING_CHANGED');
      await this.db.imageAsset.update({
        where: { id },
        data: {
          state: 'PRIVATE',
          cleanupPending: false,
          errorCode: null,
          mediaType: prepared.mediaType,
          extension: prepared.extension,
          sha256: prepared.sha256,
          objectId: prepared.objectId,
          sourceModifiedAt: new Date(stat.modifiedAt),
          lastSeenAt: new Date(),
        },
      });
      if (asset.publishRequested) await this.publish(id, actor.id, asset.bindingVersion);
      const completed = await this.db.imageAsset.findUniqueOrThrow({
        where: { id },
        include: { publicGrants: { where: { revokedAt: null }, take: 1 } },
      });
      await this.audit(actor.id, 'images.upload.complete', id, 'SUCCESS').catch(() => undefined);
      return this.hosted(completed, completed.publicGrants[0]?.publicId ?? null);
    } catch (error) {
      worker.cancel();
      await this.db.imageAsset.updateMany({
        where: { id, state: { in: ['RUNNING', 'COMMITTING'] } },
        data: { state: 'FAILED', errorCode: errorCode(error), cleanupPending: true },
      });
      await this.audit(actor.id, 'images.upload.complete', id, 'FAILURE', errorCode(error)).catch(
        () => undefined,
      );
      throw error;
    } finally {
      request.off('aborted', abort);
      this.active.delete(id);
    }
  }

  async uploadStatus(actor: AuthUser, id: string): Promise<ImageUploadSummary> {
    await this.authorize(actor.id);
    const asset = await this.db.imageAsset.findFirst({ where: { id, userId: actor.id } });
    if (!asset) throw filesError('OPERATION_NOT_FOUND');
    return this.uploadSummary(asset);
  }

  async cancelUpload(actor: AuthUser, id: string): Promise<ImageUploadSummary> {
    await this.authorize(actor.id, 'upload');
    this.active.get(id)?.worker.cancel();
    await this.db.imageAsset.updateMany({
      where: { id, userId: actor.id, state: { in: unfinished } },
      data: { state: 'FAILED', errorCode: 'TRANSFER_INTERRUPTED', cleanupPending: true },
    });
    return this.uploadStatus(actor, id);
  }

  private async revoke(assetId: string) {
    await this.db.imagePublicGrant.updateMany({
      where: { assetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async publish(assetId: string, userId: string, bindingVersion: string) {
    await this.revoke(assetId);
    const publicId = randomBytes(32).toString('base64url');
    await this.db.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const binding = await db.smbBinding.findUnique({
        where: { userId },
        select: { version: true },
      });
      if (binding?.version !== bindingVersion) throw filesError('BINDING_CHANGED');
      const updated = await db.imageAsset.updateMany({
        where: { id: assetId, userId, bindingVersion, state: { in: ['PRIVATE', 'PUBLIC'] } },
        data: { state: 'PUBLIC', errorCode: null },
      });
      if (!updated.count) throw filesError('BINDING_CHANGED');
      await db.imagePublicGrant.create({
        data: { id: randomUUID(), assetId, publicId, bindingVersion },
      });
    });
    return publicId;
  }

  private async inspect(
    asset: ImageAsset,
    credentials: { username: string; password: string },
  ): Promise<ImageInspection> {
    const result = await this.smb.call<ImageInspection>(credentials, {
      action: 'inspect',
      path: asset.relativePath,
      maxSourceBytes: this.config.imageMaxUpload,
      expectedExtension: asset.extension === 'jpeg' ? 'jpeg' : asset.extension,
    });
    if (
      result.bytes !== String(asset.sizeBytes) ||
      (asset.objectId && result.objectId && asset.objectId !== result.objectId)
    )
      throw filesError('OBJECT_CHANGED');
    await this.db.imageAsset.update({
      where: { id: asset.id },
      data: {
        objectId: result.objectId,
        mediaType: result.mediaType,
        extension: result.extension,
        sha256: result.sha256,
      },
    });
    return result;
  }

  async visibility(actor: AuthUser, id: string, value: unknown): Promise<HostedImage> {
    const input = objectInput(value, ['public']);
    if (typeof input.public !== 'boolean') throw filesError('INVALID_INPUT');
    const ctx = await this.context(actor, 'publish');
    let asset = await this.db.imageAsset.findFirst({
      where: { id, userId: actor.id, bindingVersion: ctx.binding.version },
    });
    if (!asset || !['PRIVATE', 'PUBLIC'].includes(asset.state)) throw filesError('PATH_NOT_FOUND');
    const stat = await this.smb.call<FileEntry>(ctx.credentials, {
      action: 'stat',
      path: asset.relativePath,
    });
    if (asset.objectId && stat.objectId && asset.objectId !== stat.objectId) {
      await this.revoke(id);
      throw filesError('OBJECT_CHANGED');
    }
    const statModifiedAt = new Date(stat.modifiedAt);
    if (
      asset.sizeBytes !== BigInt(stat.sizeBytes) ||
      asset.sourceModifiedAt?.getTime() !== statModifiedAt.getTime()
    ) {
      await this.revoke(id);
      asset = await this.db.imageAsset.update({
        where: { id },
        data: {
          state: 'PRIVATE',
          objectId: stat.objectId ?? asset.objectId,
          sizeBytes: BigInt(stat.sizeBytes),
          sourceModifiedAt: statModifiedAt,
          mediaType: null,
          sha256: null,
        },
      });
    }
    let publicId: string | null = null;
    if (input.public) {
      if (!asset.mediaType || !asset.sha256) await this.inspect(asset, ctx.credentials);
      publicId = await this.publish(id, actor.id, ctx.binding.version);
    } else {
      await this.revoke(id);
      await this.db.imageAsset.update({ where: { id }, data: { state: 'PRIVATE' } });
    }
    const updated = await this.db.imageAsset.findUniqueOrThrow({ where: { id } });
    await this.audit(
      actor.id,
      input.public ? 'images.publish' : 'images.unpublish',
      id,
      'SUCCESS',
    ).catch(() => undefined);
    return this.hosted(updated, publicId);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const ctx = await this.context(actor, 'delete');
    const asset = await this.db.imageAsset.findFirst({
      where: { id, userId: actor.id, bindingVersion: ctx.binding.version },
    });
    if (!asset) throw filesError('PATH_NOT_FOUND');
    await this.revoke(id);
    await this.db.imageAsset.update({ where: { id }, data: { state: 'REVOKED' } });
    try {
      let objectId = asset.objectId;
      if (!objectId) {
        const stat = await this.smb.call<FileEntry>(ctx.credentials, {
          action: 'stat',
          path: asset.relativePath,
        });
        objectId = stat.objectId ?? null;
      }
      if (!objectId) throw filesError('OBJECT_CHANGED');
      await this.smb.call(ctx.credentials, {
        action: 'delete_object',
        path: asset.relativePath,
        objectId,
      });
      await this.db.imageAsset.delete({ where: { id } });
      await this.audit(actor.id, 'images.delete', id, 'SUCCESS').catch(() => undefined);
    } catch (error) {
      await this.db.imageAsset.update({
        where: { id },
        data: { state: 'CLEANUP_PENDING', cleanupPending: true, errorCode: errorCode(error) },
      });
      await this.audit(actor.id, 'images.delete', id, 'FAILURE', errorCode(error)).catch(
        () => undefined,
      );
      throw error;
    }
  }

  private async ownedAsset(actor: AuthUser, id: string) {
    const ctx = await this.context(actor);
    const asset = await this.db.imageAsset.findFirst({
      where: { id, userId: actor.id, bindingVersion: ctx.binding.version },
    });
    if (!asset || !['PRIVATE', 'PUBLIC'].includes(asset.state)) throw filesError('PATH_NOT_FOUND');
    return { ...ctx, asset };
  }

  private async stream(
    credentials: { username: string; password: string },
    path: string,
    response: Response,
    mediaType: string,
    cacheControl: string,
  ) {
    response.setHeader('Content-Type', mediaType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', cacheControl);
    const worker = this.smb.start(credentials, { action: 'read', path });
    worker.input.end();
    try {
      await Promise.all([pipeline(worker.output, response), worker.done]);
    } catch (error) {
      worker.cancel();
      if (!response.headersSent) throw error;
      response.destroy();
    }
  }

  async preview(actor: AuthUser, id: string, response: Response) {
    const { asset, credentials } = await this.ownedAsset(actor, id);
    return this.stream(
      credentials,
      asset.relativePath,
      response,
      asset.mediaType ?? 'application/octet-stream',
      'private, no-store',
    );
  }

  async thumbnail(actor: AuthUser, id: string, response: Response) {
    const { asset, credentials } = await this.ownedAsset(actor, id);
    await this.ensureDirectory(credentials, CACHE);
    await this.ensureDirectory(credentials, THUMBNAILS);
    const fingerprint = createHash('sha256')
      .update(
        `${asset.objectId ?? asset.id}:${asset.sourceModifiedAt?.getTime() ?? 0}:${asset.sizeBytes}`,
      )
      .digest('hex');
    const cachePath = `${THUMBNAILS}/${fingerprint}.webp`;
    try {
      await this.smb.call(credentials, { action: 'stat', path: cachePath });
      return this.stream(credentials, cachePath, response, 'image/webp', 'private, max-age=86400');
    } catch (error) {
      if (errorCode(error) !== 'PATH_NOT_FOUND') throw error;
    }
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=86400');
    const worker = this.smb.start(credentials, {
      action: 'thumbnail',
      path: asset.relativePath,
      cachePath,
      tempPath: `${THUMBNAILS}/.cove-upload-${randomUUID()}.part`,
      maxSourceBytes: this.config.imageMaxUpload,
      width: 640,
      height: 480,
    });
    worker.input.end();
    try {
      await Promise.all([pipeline(worker.output, response), worker.done]);
    } catch (error) {
      worker.cancel();
      if (!response.headersSent) throw error;
      response.destroy();
    }
  }

  private async limitPublic(address: string) {
    const minuteStart = new Date(Math.floor(Date.now() / 60000) * 60000);
    const ipKey = createHash('sha256')
      .update(`image-ip:${this.config.fingerprint}:${address || 'unknown'}`)
      .digest('hex');
    const globalKey = createHash('sha256')
      .update(`image-global:${this.config.fingerprint}`)
      .digest('hex');
    const [ip, global] = await this.db.$transaction([
      this.db.imagePublicRateBucket.upsert({
        where: { bucketKey_minuteStart: { bucketKey: ipKey, minuteStart } },
        create: { bucketKey: ipKey, minuteStart, requestCount: 1 },
        update: { requestCount: { increment: 1 } },
      }),
      this.db.imagePublicRateBucket.upsert({
        where: { bucketKey_minuteStart: { bucketKey: globalKey, minuteStart } },
        create: { bucketKey: globalKey, minuteStart, requestCount: 1 },
        update: { requestCount: { increment: 1 } },
      }),
    ]);
    if (
      ip.requestCount > this.config.imagePublicPerMinute ||
      global.requestCount > this.config.imagePublicGlobalPerMinute
    )
      throw filesError('RATE_LIMITED');
    if (Math.random() < 0.01)
      void this.db.imagePublicRateBucket
        .deleteMany({
          where: { minuteStart: { lt: new Date(Date.now() - 3600000) } },
        })
        .catch(() => undefined);
  }

  async publicContent(
    publicId: string,
    address: string,
    ifNoneMatch: string | null,
    response: Response,
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publicId)) throw filesError('PATH_NOT_FOUND');
    await this.limitPublic(address);
    const activeKey = createHash('sha256')
      .update(`image-active:${this.config.fingerprint}:${address || 'unknown'}`)
      .digest('hex');
    const active = this.publicActive.get(activeKey) ?? 0;
    if (active >= this.config.imagePublicMaxActivePerIp) throw filesError('RATE_LIMITED');
    this.publicActive.set(activeKey, active + 1);
    try {
      return await this.servePublicContent(publicId, ifNoneMatch, response);
    } finally {
      const remaining = (this.publicActive.get(activeKey) ?? 1) - 1;
      if (remaining > 0) this.publicActive.set(activeKey, remaining);
      else this.publicActive.delete(activeKey);
    }
  }

  private async servePublicContent(
    publicId: string,
    ifNoneMatch: string | null,
    response: Response,
  ) {
    const grant = await this.db.imagePublicGrant.findUnique({
      where: { publicId },
      include: { asset: { include: { user: true } } },
    });
    if (
      !grant ||
      grant.revokedAt ||
      grant.asset.state !== 'PUBLIC' ||
      grant.asset.user.status !== 'ACTIVE' ||
      grant.bindingVersion !== grant.asset.bindingVersion ||
      !grant.asset.mediaType
    )
      throw filesError('PATH_NOT_FOUND');
    const bound = await this.bindings.get(grant.asset.userId).catch(() => null);
    if (
      !bound ||
      bound.binding.version !== grant.bindingVersion ||
      grant.asset.configFingerprint !== this.config.fingerprint
    )
      throw filesError('PATH_NOT_FOUND');
    let stat: FileEntry;
    try {
      stat = await this.smb.call<FileEntry>(bound.credentials, {
        action: 'stat',
        path: grant.asset.relativePath,
      });
    } catch (error) {
      if (['SMB_UNAVAILABLE', 'SMB_TIMEOUT'].includes(errorCode(error))) {
        response.setHeader('Retry-After', '5');
        throw filesError('SMB_UNAVAILABLE');
      }
      throw error;
    }
    const changed =
      (grant.asset.objectId && stat.objectId && grant.asset.objectId !== stat.objectId) ||
      grant.asset.sizeBytes !== BigInt(stat.sizeBytes) ||
      grant.asset.sourceModifiedAt?.getTime() !== new Date(stat.modifiedAt).getTime();
    if (changed) {
      await this.revoke(grant.assetId);
      throw filesError('PATH_NOT_FOUND');
    }
    const etag = `"${grant.asset.sha256}"`;
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    if (ifNoneMatch === etag) {
      response.status(304).end();
      return;
    }
    response.setHeader('Content-Length', stat.sizeBytes);
    return await this.stream(
      bound.credentials,
      grant.asset.relativePath,
      response,
      grant.asset.mediaType,
      'public, max-age=60, must-revalidate',
    );
  }
}
