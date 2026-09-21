import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AuthUser,
  FileEntry,
  NoteContent,
  NoteOperationSummary,
  NoteSaveResult,
  NotesEntriesResponse,
  NotesStatus,
} from '@cove/shared';
import { PrismaService } from '../../database/prisma.service';
import { PermissionsService } from '../access-control/permissions.service';
import { FilesConfig } from '../files/files-config';
import { errorCode, filesError, objectInput } from '../files/files-policy';
import { SmbAdapter, type WorkerHandle } from '../files/smb-adapter';
import { SmbBindingsService } from '../files/smb-bindings.service';
import { NotesConfig } from './notes-config';
import {
  decodeMarkdown,
  isNoteMarkdownName,
  noteBackupName,
  noteDirectoryPath,
  noteEntryName,
  noteMarkdown,
  noteMarkdownPath,
  noteTempName,
} from './notes-policy';

const NOTE_PAGE_SIZE = 200;
const unfinished = ['PREPARING', 'COMMITTING', 'RECONCILING'];

/** Opaque expected-stat facts signed for the browser; the worker re-checks them. */
type NoteRevision = {
  v: string; // binding version
  f: string; // config fingerprint
  p: string; // path relative to the notes root
  o: string; // SMB object identity
  s: string; // size in bytes
  m: string; // modifiedAt, millisecond-precision worker ISO
  h: string; // sha256 of the stored file bytes
};

const REQUEST_ID = /^[0-9a-f-]{36}$/i;

type NoteAction = 'create' | 'update' | 'rename' | 'delete';

/** How long a verified `Markdown Notes/` root is trusted without re-checking. */
const ROOT_VERIFY_TTL_MS = 30_000;

@Injectable()
export class NotesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotesService.name);
  private readonly active = new Map<string, Set<string>>();
  private recoveryTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly bindings: SmbBindingsService,
    private readonly smb: SmbAdapter,
    private readonly config: NotesConfig,
    private readonly filesConfig: FilesConfig,
  ) {}

  onModuleInit(): void {
    void this.recover().catch((error: unknown) =>
      this.logger.warn(`Note recovery deferred: ${errorCode(error)}`),
    );
    this.recoveryTimer = setInterval(
      () =>
        void this.recover().catch((error: unknown) =>
          this.logger.warn(`Note recovery deferred: ${errorCode(error)}`),
        ),
      120_000,
    );
    this.recoveryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  private async authorize(actorId: string, action?: NoteAction) {
    const user = await this.permissions.getAuthUser(actorId);
    if (!user) throw filesError('AUTH_EXPIRED');
    if (
      user.mustChangePassword ||
      (!user.isSuperAdmin &&
        (!user.permissions.includes('workspace.notes.page') ||
          (action && !user.permissions.includes(`workspace.notes.${action}`))))
    )
      throw filesError('FILES_FORBIDDEN');
    return user;
  }

  /**
   * A verified `Markdown Notes/` root is trusted for a short window. Every SMB
   * operation is a fresh worker process with a fresh SMB session, so checking
   * the root on every request doubled the cost of every Notes action. The
   * window is short enough that a root removed outside Cove is re-created on
   * the next action.
   */
  private readonly verifiedRoots = new Map<string, number>();

  private rootCacheKey(actorUserId: string, bindingVersion: string): string {
    return `${actorUserId}:${bindingVersion}:${this.filesConfig.fingerprint}`;
  }

  private async context(actor: AuthUser, action?: NoteAction) {
    const user = await this.authorize(actor.id, action);
    const { binding, credentials } = await this.bindings.get(actor.id);
    return { user, binding, credentials };
  }

  /** Redacted by design: user, action, result code, and a path digest only — never bodies. */
  private async audit(
    actorUserId: string,
    action: string,
    targetId: string | null,
    result: 'SUCCESS' | 'FAILURE',
    code?: string,
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: randomUUID(),
        actorUserId,
        action,
        targetType: 'note',
        targetId,
        result,
        metadata: code ? { code } : {},
      },
    });
  }

  private static pathDigest(relative: string): string {
    return createHash('sha256').update(relative, 'utf8').digest('hex').slice(0, 32);
  }

  /** Worker entries carry share-relative paths; the Notes API speaks root-relative. */
  private relativize<T extends FileEntry>(entry: T): T {
    const prefix = `${this.config.root}/`;
    if (!entry.relativePath.startsWith(prefix)) throw filesError('SMB_UNAVAILABLE');
    return { ...entry, relativePath: entry.relativePath.slice(prefix.length) };
  }

  /** Registered sibling names for the staged write and the replaced-version backup. */
  private static siblingPaths(
    relative: string,
    id: string,
  ): { tempPath: string; backupPath: string } {
    const parent = relative.split('/').slice(0, -1).filter(Boolean).join('/');
    return {
      tempPath: [parent, noteTempName(id)].filter(Boolean).join('/'),
      backupPath: [parent, noteBackupName(id)].filter(Boolean).join('/'),
    };
  }

  async status(actor: AuthUser): Promise<NotesStatus> {
    const user = await this.authorize(actor.id);
    const summary = await this.bindings.summary(actor.id);
    return {
      ...summary,
      rootPath: this.config.root,
      maxNoteBytes: String(this.config.maxNoteBytes),
      capabilities: {
        create: user.isSuperAdmin || user.permissions.includes('workspace.notes.create'),
        update: user.isSuperAdmin || user.permissions.includes('workspace.notes.update'),
        rename: user.isSuperAdmin || user.permissions.includes('workspace.notes.rename'),
        delete: user.isSuperAdmin || user.permissions.includes('workspace.notes.delete'),
      },
    };
  }

  private async ensureRoot(
    credentials: { username: string; password: string },
    cacheKey: string,
  ): Promise<void> {
    const verifiedAt = this.verifiedRoots.get(cacheKey);
    const now = Date.now();
    if (verifiedAt !== undefined && now - verifiedAt < ROOT_VERIFY_TTL_MS) return;
    try {
      const current = await this.smb.call<FileEntry>(credentials, {
        action: 'stat',
        path: this.config.root,
      });
      if (current.type !== 'directory') throw filesError('NOTE_ROOT_CONFLICT');
      this.verifiedRoots.set(cacheKey, now);
    } catch (error) {
      if (errorCode(error) !== 'PATH_NOT_FOUND') throw error;
      try {
        await this.smb.call(credentials, { action: 'mkdir', path: this.config.root });
      } catch (mkdirError) {
        if (errorCode(mkdirError) === 'NAME_CONFLICT') {
          const existing = await this.smb
            .call<FileEntry>(credentials, { action: 'stat', path: this.config.root })
            .catch(() => null);
          if (existing?.type === 'directory') {
            this.verifiedRoots.set(cacheKey, now);
            return;
          }
          throw filesError('NOTE_ROOT_CONFLICT');
        }
        throw mkdirError;
      }
    }
    this.verifiedRoots.set(cacheKey, now);
  }

  async entries(actor: AuthUser, query: Record<string, unknown>): Promise<NotesEntriesResponse> {
    if (!query || typeof query !== 'object') throw filesError('INVALID_INPUT');
    const path = noteDirectoryPath(query.path ?? '');
    const cursor = query.cursor === undefined || query.cursor === '' ? 0 : Number(query.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.config.maxEntries)
      throw filesError('INVALID_INPUT');
    const { binding, credentials } = await this.context(actor);
    await this.ensureRoot(credentials, this.rootCacheKey(actor.id, binding.version));
    const listed = await this.smb.call<FileEntry[]>(credentials, {
      action: 'list',
      path: this.config.absolute(path),
      maxEntries: this.config.maxEntries,
    });
    // Metadata only; note bodies are never opened for the tree view (NOTE-NFR-007).
    const visible = listed
      .filter(
        (entry) =>
          entry.supported &&
          !entry.hidden &&
          (entry.type === 'directory' || (entry.type === 'file' && isNoteMarkdownName(entry.name))),
      )
      .sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
      );
    const page = visible
      .slice(cursor, cursor + NOTE_PAGE_SIZE)
      .map((entry) => this.relativize(entry));
    const nextCursor =
      cursor + NOTE_PAGE_SIZE < visible.length ? String(cursor + NOTE_PAGE_SIZE) : null;
    return { path, entries: page, nextCursor, total: visible.length };
  }

  private readBody(
    credentials: { username: string; password: string },
    relative: string,
    maxBytes: number,
  ): Promise<{ stat: FileEntry; bytes: Buffer }> {
    return new Promise((resolve, reject) => {
      let stat: FileEntry | undefined;
      let failure: unknown;
      const chunks: Buffer[] = [];
      let total = 0;
      let worker: WorkerHandle;
      const cancelWith = (error: unknown) => {
        failure = failure ?? error;
        worker.cancel();
      };
      try {
        worker = this.smb.start(
          credentials,
          { action: 'read', path: this.config.absolute(relative) },
          (event) => {
            if (!event.ready) return;
            stat = event.ready;
            if (stat.type !== 'file') cancelWith(filesError('NOTE_UNSUPPORTED_TYPE'));
            else if (BigInt(stat.sizeBytes) > BigInt(maxBytes))
              cancelWith(filesError('NOTE_TOO_LARGE'));
          },
        );
      } catch (error) {
        reject(error);
        return;
      }
      const timer = setTimeout(
        () => cancelWith(filesError('SMB_TIMEOUT')),
        this.filesConfig.directoryTimeout,
      );
      timer.unref();
      const consume = (async () => {
        for await (const chunk of worker.output) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          total += buffer.length;
          if (total > maxBytes) cancelWith(filesError('NOTE_TOO_LARGE'));
          chunks.push(buffer);
        }
      })().catch((error: unknown) => {
        failure = failure ?? error;
      });
      void worker.done
        .catch((error: unknown) => {
          failure = failure ?? error;
        })
        .then(() => consume)
        .then(() => {
          clearTimeout(timer);
          if (failure !== undefined || !stat) reject(failure ?? filesError('TRANSFER_INTERRUPTED'));
          else resolve({ stat, bytes: Buffer.concat(chunks, Math.min(total, maxBytes)) });
        });
    });
  }

  async content(actor: AuthUser, query: Record<string, unknown>): Promise<NoteContent> {
    if (!query || typeof query !== 'object') throw filesError('INVALID_INPUT');
    const path = noteMarkdownPath(query.path);
    const { binding, credentials } = await this.context(actor);
    await this.ensureRoot(credentials, this.rootCacheKey(actor.id, binding.version));
    const { stat, bytes } = await this.readBody(credentials, path, this.config.maxNoteBytes);
    // TextDecoder strips a UTF-8 BOM; invalid UTF-8 fails without rewriting the file.
    const markdown = decodeMarkdown(bytes);
    const revision = this.signRevision({
      v: binding.version,
      f: this.filesConfig.fingerprint,
      p: path,
      o: stat.objectId ?? '',
      s: stat.sizeBytes,
      m: stat.modifiedAt,
      h: createHash('sha256').update(bytes).digest('hex'),
    });
    return { path, markdown, revision, sizeBytes: stat.sizeBytes, modifiedAt: stat.modifiedAt };
  }

  private signRevision(payload: NoteRevision): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.config.revisionSecret)
      .update(body)
      .digest('base64url');
    return `${body}.${signature}`;
  }

  private readRevision(token: unknown): NoteRevision | null {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const expected = createHmac('sha256', this.config.revisionSecret).update(body).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(token.slice(dot + 1), 'base64url');
    } catch {
      return null;
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as NoteRevision;
      if (
        typeof payload !== 'object' ||
        payload === null ||
        [payload.v, payload.f, payload.p, payload.o, payload.s, payload.m, payload.h].some(
          (value) => typeof value !== 'string' || !value || value.length > 4096,
        )
      )
        return null;
      return payload;
    } catch {
      return null;
    }
  }

  private summary(operation: {
    id: string;
    relativePath: string;
    state: string;
    errorCode: string | null;
    cleanupPending: boolean;
    createdAt: Date;
  }): NoteOperationSummary {
    return {
      id: operation.id,
      relativePath: operation.relativePath,
      state: operation.state,
      errorCode: operation.errorCode,
      cleanupPending: operation.cleanupPending,
      createdAt: operation.createdAt.toISOString(),
    };
  }

  async operation(actor: AuthUser, id: string): Promise<NoteOperationSummary> {
    await this.authorize(actor.id);
    const row = await this.db.noteWriteOperation.findFirst({ where: { id, userId: actor.id } });
    if (!row) throw filesError('OPERATION_NOT_FOUND');
    return this.summary(row);
  }

  async save(actor: AuthUser, value: unknown): Promise<NoteSaveResult> {
    const input = objectInput(value, ['path', 'markdown', 'expectedRevision', 'requestId']);
    if (typeof input.expectedRevision !== 'string' || !REQUEST_ID.test(String(input.requestId)))
      throw filesError('INVALID_INPUT');
    const path = noteMarkdownPath(input.path);
    const markdown = noteMarkdown(input.markdown, this.config.maxNoteBytes);
    const bytes = Buffer.byteLength(markdown, 'utf8');
    const targetSha256 = createHash('sha256').update(markdown, 'utf8').digest('hex');
    const requestId = String(input.requestId);
    const revision = this.readRevision(input.expectedRevision);
    if (!revision) throw filesError('INVALID_INPUT');
    const { user, binding, credentials } = await this.context(actor, 'update');
    if (revision.v !== binding.version || revision.f !== this.filesConfig.fingerprint)
      throw filesError('BINDING_CHANGED');
    if (revision.p !== path) throw filesError('NOTE_CHANGED');

    const replay = await this.db.noteWriteOperation.findUnique({
      where: {
        userId_bindingVersion_requestId: {
          userId: actor.id,
          bindingVersion: binding.version,
          requestId,
        },
      },
    });
    if (replay) {
      if (
        replay.relativePath !== path ||
        replay.sourceObjectId !== revision.o ||
        replay.sourceSha256 !== revision.h ||
        replay.targetSizeBytes !== BigInt(bytes) ||
        replay.targetSha256 !== targetSha256
      )
        throw filesError('INVALID_INPUT');
      if (replay.state === 'SUCCEEDED' && replay.targetObjectId && replay.targetModifiedRaw) {
        return {
          path,
          revision: this.signRevision({
            v: replay.bindingVersion,
            f: replay.configFingerprint,
            p: replay.relativePath,
            o: replay.targetObjectId,
            s: String(replay.targetSizeBytes),
            m: replay.targetModifiedRaw,
            h: replay.targetSha256 ?? '',
          }),
          saved: true,
          operationId: replay.id,
          sizeBytes: String(replay.targetSizeBytes),
          modifiedAt: replay.targetModifiedRaw,
          objectId: replay.targetObjectId,
        };
      }
      if (unfinished.includes(replay.state)) throw filesError('FILE_BUSY');
      if (replay.state === 'SUCCEEDED') throw filesError('OPERATION_NOT_FOUND');
      throw filesError(
        replay.errorCode === 'OBJECT_CHANGED'
          ? 'NOTE_CHANGED'
          : (replay.errorCode ?? 'TRANSFER_INTERRUPTED'),
      );
    }

    if (targetSha256 === revision.h) {
      // Content already matches the persisted version; never rewrite for nothing.
      return {
        path,
        revision: input.expectedRevision,
        saved: false,
        operationId: null,
        sizeBytes: revision.s,
        modifiedAt: revision.m,
        objectId: revision.o,
      };
    }
    if ((this.active.get(actor.id)?.size ?? 0) >= this.config.maxActivePerUser)
      throw filesError('RATE_LIMITED');

    await this.ensureRoot(credentials, this.rootCacheKey(actor.id, binding.version));
    const id = randomUUID();
    const { tempPath, backupPath } = NotesService.siblingPaths(path, id);
    await this.db.noteWriteOperation.create({
      data: {
        id,
        userId: actor.id,
        bindingVersion: binding.version,
        configFingerprint: this.filesConfig.fingerprint,
        authVersion: user.authVersion,
        requestId,
        relativePath: path,
        tempPath,
        backupPath,
        sourceObjectId: revision.o,
        sourceModifiedAt: new Date(revision.m),
        sourceSizeBytes: BigInt(revision.s),
        sourceSha256: revision.h,
        targetSha256,
        targetSizeBytes: BigInt(bytes),
        state: 'PREPARING',
        leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
      },
    });
    this.active.set(actor.id, (this.active.get(actor.id) ?? new Set()).add(id));

    let hasTemp = false;
    let tempObjectId: string | null = null;
    let committed = false;
    const payload = Buffer.from(markdown, 'utf8');
    try {
      const worker = this.smb.start(
        credentials,
        {
          action: 'write_note',
          path: this.config.absolute(path),
          tempPath: this.config.absolute(tempPath),
          backupPath: this.config.absolute(backupPath),
          size: String(bytes),
          expected: {
            objectId: revision.o,
            sizeBytes: revision.s,
            modifiedAt: revision.m,
          },
        },
        (event) => {
          if (event.created) {
            hasTemp = true;
            tempObjectId = event.created.objectId;
            return this.db.noteWriteOperation
              .updateMany({
                where: { id, state: 'PREPARING' },
                data: {
                  targetObjectId: event.created.objectId,
                  cleanupPending: true,
                  leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
                },
              })
              .then(() => undefined);
          }
          if (event.progress)
            return this.db.noteWriteOperation
              .updateMany({
                where: { id, state: { in: ['PREPARING', 'COMMITTING'] } },
                data: { leaseExpiresAt: new Date(Date.now() + this.config.leaseMs) },
              })
              .then(() => undefined);
          if (event.prepared) {
            // Re-verify the binding before the irreversible replace is unblocked.
            return this.bindings.get(actor.id).then((fresh) => {
              if (fresh.binding.version !== binding.version) throw filesError('BINDING_CHANGED');
              return this.db.noteWriteOperation
                .update({
                  where: { id },
                  data: {
                    state: 'COMMITTING',
                    targetObjectId: event.prepared?.objectId,
                    targetSha256: event.prepared?.sha256,
                    leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
                  },
                })
                .then(() => {
                  committed = true;
                  worker.commit();
                });
            });
          }
          return undefined;
        },
      );
      worker.output.resume();
      // The worker validates the expected revision before consuming stdin and may
      // exit immediately, so worker.done is the only authoritative outcome.
      void this.smb
        .writeChunk(worker, payload)
        .then(() => worker.input.end())
        .catch(() => undefined);
      const result = (await worker.done) as {
        bytes: string;
        objectId: string;
        sha256: string;
        sizeBytes: string;
        modifiedAt: string;
        residual?: boolean;
      };
      const fresh = await this.bindings.get(actor.id);
      if (fresh.binding.version !== binding.version) throw filesError('BINDING_CHANGED');
      await this.db.noteWriteOperation.update({
        where: { id },
        data: {
          state: 'SUCCEEDED',
          errorCode: null,
          // `residual` means the backup could not be deleted in-flow; recovery
          // removes it by the registered source identity.
          cleanupPending: result.residual === true,
          targetObjectId: result.objectId,
          targetSha256: result.sha256,
          targetSizeBytes: BigInt(result.sizeBytes || String(bytes)),
          targetModifiedAt: new Date(result.modifiedAt),
          targetModifiedRaw: result.modifiedAt,
        },
      });
      await this.audit(actor.id, 'notes.save', id, 'SUCCESS').catch(() => undefined);
      return {
        path,
        revision: this.signRevision({
          v: binding.version,
          f: this.filesConfig.fingerprint,
          p: path,
          o: result.objectId,
          s: result.sizeBytes || String(bytes),
          m: result.modifiedAt,
          h: result.sha256,
        }),
        saved: true,
        operationId: id,
        sizeBytes: result.sizeBytes || String(bytes),
        modifiedAt: result.modifiedAt,
        objectId: result.objectId,
      };
    } catch (error) {
      const code = errorCode(error);
      const conflict = code === 'OBJECT_CHANGED';
      // After the commit gate only reconciliation may describe the outcome.
      const state = conflict ? 'CONFLICT' : committed ? 'RECONCILING' : 'FAILED';
      await this.db.noteWriteOperation
        .updateMany({
          where: { id, state: { in: ['PREPARING', 'COMMITTING'] } },
          data: {
            state,
            errorCode: code,
            cleanupPending: hasTemp,
            leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
          },
        })
        .catch(() => undefined);
      if (hasTemp && tempObjectId)
        void this.cleanupTemp(credentials, id, this.config.absolute(tempPath), tempObjectId).catch(
          () => undefined,
        );
      await this.audit(actor.id, 'notes.save', id, 'FAILURE', code).catch(() => undefined);
      throw conflict ? filesError('NOTE_CHANGED') : error;
    } finally {
      const active = this.active.get(actor.id);
      active?.delete(id);
      if (active && !active.size) this.active.delete(actor.id);
    }
  }

  private async cleanupTemp(
    credentials: { username: string; password: string },
    operationId: string,
    absoluteTempPath: string,
    objectId: string | null,
  ): Promise<void> {
    if (!objectId) return;
    await this.smb.call(credentials, {
      action: 'cleanup',
      path: absoluteTempPath,
      objectId,
    });
    await this.db.noteWriteOperation.updateMany({
      where: { id: operationId },
      data: { cleanupPending: false },
    });
  }

  async createFile(actor: AuthUser, value: unknown): Promise<{ path: string }> {
    const input = objectInput(value, ['path']);
    const path = noteMarkdownPath(input.path);
    const { user, binding, credentials } = await this.context(actor, 'create');
    await this.ensureRoot(credentials, this.rootCacheKey(actor.id, binding.version));
    const id = randomUUID();
    const tempPath = [path.split('/').slice(0, -1).filter(Boolean).join('/'), noteTempName(id)]
      .filter(Boolean)
      .join('/');
    await this.db.noteWriteOperation.create({
      data: {
        id,
        userId: actor.id,
        bindingVersion: binding.version,
        configFingerprint: this.filesConfig.fingerprint,
        authVersion: user.authVersion,
        requestId: id,
        relativePath: path,
        tempPath,
        targetSha256: createHash('sha256').update(Buffer.alloc(0)).digest('hex'),
        targetSizeBytes: 0n,
        state: 'PREPARING',
        cleanupPending: false,
        leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
      },
    });
    let committed = false;
    let tempObjectId: string | null = null;
    let worker!: WorkerHandle;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      worker = this.smb.start(
        credentials,
        {
          action: 'write',
          path: this.config.absolute(path),
          tempPath: this.config.absolute(tempPath),
          noteTemp: true,
          size: '0',
        },
        (event) => {
          if (event.created) {
            tempObjectId = event.created.objectId;
            return this.db.noteWriteOperation
              .updateMany({
                where: { id, state: 'PREPARING' },
                data: {
                  targetObjectId: event.created.objectId,
                  cleanupPending: true,
                  leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
                },
              })
              .then(() => undefined);
          }
          if (!event.prepared) return;
          return this.db.noteWriteOperation
            .updateMany({
              where: { id, state: 'PREPARING' },
              data: {
                state: 'COMMITTING',
                targetObjectId: event.prepared.objectId,
                leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
              },
            })
            .then(() => {
              committed = true;
              worker.commit();
            });
        },
      );
      worker.output.resume();
      worker.input.end();
      timer = setTimeout(() => worker.cancel(), this.filesConfig.directoryTimeout);
      timer.unref();
      await worker.done;
      // The commit landed; settle the ledger now instead of parking a healthy
      // note as an unfinished operation until the lease expires.
      await this.db.noteWriteOperation
        .updateMany({
          where: { id, state: 'COMMITTING' },
          data: { state: 'SUCCEEDED', errorCode: null, cleanupPending: false },
        })
        .catch(() => undefined);
      await this.audit(actor.id, 'notes.create', id, 'SUCCESS').catch(() => undefined);
    } catch (error) {
      const code = errorCode(error);
      await this.db.noteWriteOperation
        .updateMany({
          where: { id, state: { in: ['PREPARING', 'COMMITTING'] } },
          data: {
            state: committed ? 'RECONCILING' : 'FAILED',
            errorCode: code,
            leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
          },
        })
        .catch(() => undefined);
      if (tempObjectId)
        void this.cleanupTemp(credentials, id, this.config.absolute(tempPath), tempObjectId).catch(
          () => undefined,
        );
      await this.audit(actor.id, 'notes.create', id, 'FAILURE', code).catch(() => undefined);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return { path };
  }

  async createFolder(actor: AuthUser, value: unknown): Promise<FileEntry> {
    const input = objectInput(value, ['path']);
    const path = noteDirectoryPath(input.path);
    if (!path) throw filesError('INVALID_INPUT');
    const { binding, credentials } = await this.context(actor, 'create');
    await this.ensureRoot(credentials, this.rootCacheKey(actor.id, binding.version));
    const target = NotesService.pathDigest(path);
    try {
      const created = await this.smb.call<FileEntry>(credentials, {
        action: 'mkdir',
        path: this.config.absolute(path),
      });
      await this.audit(actor.id, 'notes.folder.create', target, 'SUCCESS').catch(() => undefined);
      return this.relativize(created);
    } catch (error) {
      await this.audit(actor.id, 'notes.folder.create', target, 'FAILURE', errorCode(error)).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async rename(actor: AuthUser, value: unknown): Promise<FileEntry> {
    const input = objectInput(value, ['path', 'newName', 'objectId']);
    const path = noteDirectoryPath(input.path);
    if (!path) throw filesError('INVALID_INPUT');
    const newName = noteEntryName(input.newName);
    if (typeof input.objectId !== 'string' || !input.objectId) throw filesError('INVALID_INPUT');
    const { credentials } = await this.context(actor, 'rename');
    const targetId = NotesService.pathDigest(path);
    try {
      const current = await this.smb.call<FileEntry>(credentials, {
        action: 'stat',
        path: this.config.absolute(path),
      });
      // A stale listing must never rename an object the user did not select.
      if (current.objectId !== input.objectId) throw filesError('NOTE_CHANGED');
      // Renaming a note away from the approved extension would strand it outside Notes.
      if (current.type === 'file' && !/\.md$/i.test(newName))
        throw filesError('NOTE_UNSUPPORTED_TYPE');
      const target = [...path.split('/').slice(0, -1), newName].join('/');
      const renamed = await this.smb.call<FileEntry>(credentials, {
        action: 'rename',
        path: this.config.absolute(path),
        targetPath: this.config.absolute(target),
        objectId: input.objectId,
      });
      await this.audit(actor.id, 'notes.rename', targetId, 'SUCCESS').catch(() => undefined);
      return this.relativize(renamed);
    } catch (error) {
      const code = errorCode(error);
      await this.audit(actor.id, 'notes.rename', targetId, 'FAILURE', code).catch(() => undefined);
      throw code === 'OBJECT_CHANGED' ? filesError('NOTE_CHANGED') : error;
    }
  }

  async remove(actor: AuthUser, value: unknown): Promise<void> {
    const input = objectInput(value, ['path', 'objectId']);
    const path = noteDirectoryPath(input.path);
    if (!path) throw filesError('INVALID_INPUT');
    if (typeof input.objectId !== 'string' || !input.objectId) throw filesError('INVALID_INPUT');
    const { credentials } = await this.context(actor, 'delete');
    const targetId = NotesService.pathDigest(path);
    try {
      const current = await this.smb.call<FileEntry>(credentials, {
        action: 'stat',
        path: this.config.absolute(path),
      });
      // Deletion is identity-checked: a path alone can be an impostor's object.
      if (current.objectId !== input.objectId) throw filesError('NOTE_CHANGED');
      await this.smb.call(credentials, {
        action: 'delete_object',
        path: this.config.absolute(path),
        objectId: input.objectId,
      });
      await this.audit(actor.id, 'notes.delete', targetId, 'SUCCESS').catch(() => undefined);
    } catch (error) {
      const code = errorCode(error);
      await this.audit(actor.id, 'notes.delete', targetId, 'FAILURE', code).catch(() => undefined);
      throw code === 'OBJECT_CHANGED' ? filesError('NOTE_CHANGED') : error;
    }
  }

  private async recoverOperation(row: {
    id: string;
    userId: string;
    bindingVersion: string;
    relativePath: string;
    tempPath: string;
    backupPath?: string | null;
    sourceObjectId: string | null;
    sourceSizeBytes: bigint;
    sourceSha256?: string | null;
    targetObjectId: string | null;
    targetSizeBytes: bigint;
    targetSha256?: string | null;
    state: string;
    errorCode: string | null;
    cleanupPending: boolean;
  }): Promise<void> {
    const bound = await this.bindings.get(row.userId).catch(() => null);
    if (!bound || bound.binding.version !== row.bindingVersion) {
      await this.db.noteWriteOperation.updateMany({
        where: { id: row.id },
        data: { state: 'INTERRUPTED', errorCode: 'BINDING_CHANGED' },
      });
      return;
    }
    const terminal = (state: string, code: string | null, cleanupPending = false) =>
      this.db.noteWriteOperation.updateMany({
        where: { id: row.id },
        data: { state, errorCode: code, cleanupPending },
      });
    // Registered leftovers can only be removed by identity; names are never trusted.
    const { credentials } = bound;
    const cleanupBy = async (path: string, objectId: string | null): Promise<boolean> => {
      if (!objectId) return false;
      try {
        await this.smb.call(credentials, {
          action: 'cleanup',
          path: this.config.absolute(path),
          objectId,
        });
        return true;
      } catch (error) {
        // Gone, or the name now holds a different object: nothing left to clean.
        if (['PATH_NOT_FOUND', 'OBJECT_CHANGED'].includes(errorCode(error))) return true;
        return false; // NAS hiccup: retry on the next recovery pass.
      }
    };
    const cleanupLeftovers = async (): Promise<boolean> => {
      const results: boolean[] = [];
      if (row.targetObjectId) results.push(await cleanupBy(row.tempPath, row.targetObjectId));
      if (row.backupPath && row.sourceObjectId)
        results.push(await cleanupBy(row.backupPath, row.sourceObjectId));
      return results.every(Boolean);
    };
    const cleanupStaged = () =>
      row.targetObjectId ? cleanupBy(row.tempPath, row.targetObjectId) : Promise.resolve(true);
    if (row.state === 'COMMITTING' || row.state === 'RECONCILING') {
      if (row.state === 'COMMITTING')
        await this.db.noteWriteOperation.updateMany({
          where: { id: row.id, state: 'COMMITTING' },
          data: {
            state: 'RECONCILING',
            leaseExpiresAt: new Date(Date.now() + this.config.leaseMs),
          },
        });
      try {
        const stored = await this.readBody(
          bound.credentials,
          row.relativePath,
          this.config.maxNoteBytes,
        );
        const storedSha256 = createHash('sha256').update(stored.bytes).digest('hex');
        if (
          row.targetObjectId &&
          row.targetSha256 &&
          stored.stat.objectId === row.targetObjectId &&
          stored.stat.sizeBytes === String(row.targetSizeBytes) &&
          storedSha256 === row.targetSha256
        ) {
          const cleaned = await cleanupLeftovers();
          await this.db.noteWriteOperation.updateMany({
            where: { id: row.id },
            data: {
              state: 'SUCCEEDED',
              errorCode: null,
              cleanupPending: !cleaned,
              targetModifiedAt: new Date(stored.stat.modifiedAt),
              targetModifiedRaw: stored.stat.modifiedAt,
            },
          });
          return;
        }
        if (
          row.sourceObjectId &&
          row.sourceSha256 &&
          stored.stat.objectId === row.sourceObjectId &&
          stored.stat.sizeBytes === String(row.sourceSizeBytes) &&
          storedSha256 === row.sourceSha256
        ) {
          // The replace never landed; the original version is intact.
          const cleaned = await cleanupLeftovers();
          await terminal('INTERRUPTED', 'TRANSFER_INTERRUPTED', !cleaned);
          return;
        }
        // An unknown object holds the name: conflict, and the registered backup
        // stays on the NAS as the last known copy of the replaced note.
        const cleaned = await cleanupStaged();
        await terminal('CONFLICT', 'OBJECT_CHANGED', !cleaned);
        return;
      } catch (error) {
        const code = errorCode(error);
        if (code === 'PATH_NOT_FOUND' && row.backupPath && row.sourceObjectId) {
          // The pinned swap moved the original to the backup but never completed.
          // Restore it; the client kept its draft and can retry the save.
          try {
            await this.smb.call(bound.credentials, {
              action: 'restore',
              path: this.config.absolute(row.backupPath),
              targetPath: this.config.absolute(row.relativePath),
              objectId: row.sourceObjectId,
            });
            const cleaned = await cleanupStaged();
            await terminal('INTERRUPTED', 'TRANSFER_INTERRUPTED', !cleaned);
            return;
          } catch (restoreError) {
            const restoreCode = errorCode(restoreError);
            if (
              !['NAME_CONFLICT', 'PATH_NOT_FOUND', 'OBJECT_CHANGED', 'INVALID_PATH'].includes(
                restoreCode,
              )
            )
              return; // NAS hiccup: leave RECONCILING for the next recovery pass.
          }
        }
        if (code === 'PATH_NOT_FOUND' || code === 'OBJECT_CHANGED') {
          const cleaned = await cleanupStaged();
          await terminal('CONFLICT', code, !cleaned);
          return;
        }
        return; // NAS hiccup: leave RECONCILING for the next recovery pass.
      }
    }
    if (row.cleanupPending && (row.targetObjectId || row.backupPath)) {
      if (await cleanupLeftovers())
        await this.db.noteWriteOperation.updateMany({
          where: { id: row.id },
          data: { cleanupPending: false },
        });
      return;
    }
    // Expired PREPARING: clean only the registered temp identity, never by name.
    if (row.targetObjectId) {
      await this.cleanupTemp(
        bound.credentials,
        row.id,
        this.config.absolute(row.tempPath),
        row.targetObjectId,
      ).catch(() => undefined);
    }
    await terminal('FAILED', row.errorCode ?? 'TRANSFER_INTERRUPTED');
  }

  private async recover(): Promise<void> {
    const terminalStates = ['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CONFLICT'];
    const rows = await this.db.noteWriteOperation.findMany({
      where: {
        OR: [
          {
            cleanupPending: true,
            state: { in: terminalStates },
            OR: [{ errorCode: null }, { errorCode: { not: 'BINDING_CHANGED' } }],
          },
          { state: { in: unfinished }, leaseExpiresAt: { lt: new Date() } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
    for (const row of rows) {
      await this.recoverOperation(row).catch(() => undefined);
    }
    await this.db.noteWriteOperation.deleteMany({
      where: {
        cleanupPending: false,
        state: { in: terminalStates },
        updatedAt: { lt: new Date(Date.now() - this.config.retentionMs) },
      },
    });
  }
}
