/* eslint-disable no-control-regex -- Control characters in note bodies are rejected explicitly. */
import { Buffer } from 'node:buffer';
import { fileName, filesError, relativePath } from '../files/files-policy';

/** Must match NOTE_TEMP_PREFIX in smb/worker.py. */
export const NOTE_TEMP_PREFIX = '.cove-note-';
export function isNoteTemporaryName(value: string): boolean {
  return value.toLowerCase().startsWith(NOTE_TEMP_PREFIX);
}
export function noteTempName(id: string): string {
  return `${NOTE_TEMP_PREFIX}${id}.part`;
}

/** Swap backup for the replaced version; same reserved prefix, cleaned by identity. */
export function noteBackupName(id: string): string {
  return `${NOTE_TEMP_PREFIX}${id}.prev.part`;
}

const markdownExtension = /\.md$/i;
const forbiddenControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const loneSurrogate =
  /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/u;

/** User-visible file name inside the notes tree; reserved worker temp names stay unusable. */
export function noteEntryName(value: unknown): string {
  const name = fileName(value);
  if (isNoteTemporaryName(name)) throw filesError('INVALID_PATH');
  return name;
}

/** Path of a `.md` note relative to the fixed root; never the root itself. */
export function noteMarkdownPath(value: unknown): string {
  const path = relativePath(value);
  const parts = path ? path.split('/') : [];
  const last = parts[parts.length - 1] ?? '';
  if (!parts.length || !markdownExtension.test(last)) throw filesError('NOTE_UNSUPPORTED_TYPE');
  assertNoReservedPart(parts);
  return path;
}

/** Path of a directory relative to the fixed root; '' addresses the root itself. */
export function noteDirectoryPath(value: unknown): string {
  const path = relativePath(value);
  assertNoReservedPart(path ? path.split('/') : []);
  return path;
}

function assertNoReservedPart(parts: string[]): void {
  if (parts.some((part) => isNoteTemporaryName(part))) throw filesError('INVALID_PATH');
}

export function isNoteMarkdownName(name: string): boolean {
  return !isNoteTemporaryName(name) && markdownExtension.test(name) && !name.startsWith('.');
}

/** Markdown body handed over by the client; bytes are re-verified before any write. */
export function noteMarkdown(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string') throw filesError('INVALID_INPUT');
  if (forbiddenControl.test(value) || loneSurrogate.test(value))
    throw filesError('NOTE_INVALID_CONTENT');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > maxBytes) throw filesError('NOTE_TOO_LARGE');
  return value;
}

/** Strict UTF-8 decode for bodies read back from the NAS; failures never rewrite the file. */
export function decodeMarkdown(bytes: Buffer): string {
  try {
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (forbiddenControl.test(markdown) || loneSurrogate.test(markdown))
      throw filesError('NOTE_INVALID_CONTENT');
    return markdown;
  } catch {
    throw filesError('NOTE_INVALID_CONTENT');
  }
}
