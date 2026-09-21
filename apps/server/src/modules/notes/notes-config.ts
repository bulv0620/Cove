import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { filesError } from '../files/files-policy';

export const DAY_MS = 86_400_000;

@Injectable()
export class NotesConfig {
  /** Fixed per-user notes root directly below the SMB home, like `Image Hosting/`. */
  readonly root: string;
  readonly rootSegments: string[];
  readonly maxNoteBytes: number;
  readonly maxEntries: number;
  readonly maxActivePerUser: number;
  readonly leaseMs: number;
  readonly retentionMs: number;
  readonly revisionSecret: Buffer;
  constructor(config: ConfigService) {
    const str = (name: string, fallback: string) => config.get<string>(name) ?? fallback;
    const num = (name: string, fallback: number, min: number, max: number) => {
      const value = Number(str(name, String(fallback)));
      if (!Number.isSafeInteger(value) || value < min || value > max)
        throw new Error(`Invalid ${name}`);
      return value;
    };
    this.root = str('NOTES_ROOT_DIR', 'Markdown Notes');
    // The root is a single fixed ASCII segment; clients never choose it.
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,62}[A-Za-z0-9_-])?$/.test(this.root))
      throw new Error('Invalid NOTES_ROOT_DIR');
    this.rootSegments = [this.root];
    this.maxNoteBytes = num('NOTES_MAX_NOTE_BYTES', 5_242_880, 1024, 52_428_800);
    this.maxEntries = num('NOTES_MAX_DIRECTORY_ENTRIES', 5_000, 1, 50_000);
    this.maxActivePerUser = num('NOTES_MAX_ACTIVE_SAVES_PER_USER', 2, 1, 16);
    this.leaseMs = num('NOTES_OPERATION_LEASE_MS', 60_000, 10_000, 600_000);
    this.retentionMs = num('NOTES_OPERATION_RETENTION_MS', 7 * DAY_MS, 3_600_000, 90 * DAY_MS);
    const provided = str('NOTES_REVISION_SECRET', '');
    // Revisions only carry expected SMB stat facts, so a derived fallback keeps
    // local development simple without weakening the server-side stat check.
    this.revisionSecret = createHash('sha256')
      .update(
        provided.length >= 16
          ? `cove-notes-revision:${provided}`
          : `cove-notes-revision-fallback:${str('SMB_CREDENTIAL_KEY', '')}:${str('SMB_CREDENTIAL_KEY_ID', 'v1')}`,
      )
      .digest();
  }
  absolute(relative: string): string {
    return [...this.rootSegments, relative].filter(Boolean).join('/');
  }
  assertNoteSize(bytes: number): void {
    if (bytes > this.maxNoteBytes) throw filesError('NOTE_TOO_LARGE');
  }
}
