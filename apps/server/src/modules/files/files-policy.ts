/* eslint-disable no-control-regex -- Explicitly reject control characters in untrusted SMB input. */
import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export const UPLOAD_TEMP_PREFIX = '.cove-upload-';
export function isTemporaryName(value: string): boolean {
  return value.toLowerCase().startsWith(UPLOAD_TEMP_PREFIX);
}

const statuses: Record<string, number> = {
  INVALID_PATH: 400,
  INVALID_INPUT: 400,
  SIZE_MISMATCH: 400,
  INVALID_IMAGE: 400,
  UNSUPPORTED_IMAGE: 400,
  AUTH_EXPIRED: 401,
  FILES_FORBIDDEN: 403,
  SMB_ACCESS_DENIED: 403,
  PATH_NOT_FOUND: 404,
  OPERATION_NOT_FOUND: 404,
  SMB_NOT_BOUND: 409,
  SMB_CREDENTIALS_INVALID: 409,
  SMB_CONFIG_CHANGED: 409,
  SMB_ROOT_UNAVAILABLE: 409,
  NAME_CONFLICT: 409,
  BINDING_CHANGED: 409,
  FILE_BUSY: 409,
  DIRECTORY_NOT_EMPTY: 409,
  TRANSFER_INTERRUPTED: 409,
  NOTE_CHANGED: 409,
  NOTE_ROOT_CONFLICT: 409,
  NOTE_INVALID_CONTENT: 400,
  NOTE_UNSUPPORTED_TYPE: 400,
  NOTE_TOO_LARGE: 413,
  UNSUPPORTED_LINK: 400,
  SIZE_LIMIT: 413,
  DIRECTORY_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  SMB_DISABLED: 503,
  SMB_UNAVAILABLE: 503,
  SMB_SECURITY_REQUIRED: 503,
  CREDENTIAL_KEY_UNAVAILABLE: 503,
  SMB_DISK_FULL: 507,
  SMB_TIMEOUT: 504,
};
export function filesError(code: string): HttpException {
  return new HttpException(
    {
      code,
      message: code,
      retryable: ['SMB_UNAVAILABLE', 'SMB_TIMEOUT', 'RATE_LIMITED', 'FILE_BUSY'].includes(code),
      requestId: randomUUID(),
    },
    statuses[code] ?? 502,
  );
}
export function errorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && 'code' in response) return String(response.code);
  }
  return 'SMB_UNAVAILABLE';
}
export function fileName(value: unknown, allowTemporary = false): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    /[\\/:"<>|?*\u0000-\u001f\u007f]/u.test(value) ||
    /[. ]$/u.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ||
    (!allowTemporary && isTemporaryName(value))
  )
    throw filesError('INVALID_PATH');
  return value;
}
export function relativePath(value: unknown, allowTemporary = false): string {
  if (typeof value !== 'string' || value.length > 2048) throw filesError('INVALID_PATH');
  if (value === '') return '';
  return value
    .split('/')
    .map((part) => fileName(part, allowTemporary))
    .join('/');
}
export function childPath(parent: unknown, name: unknown): string {
  return [relativePath(parent), fileName(name)].filter(Boolean).join('/');
}
export function objectInput(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw filesError('INVALID_INPUT');
  return value as Record<string, unknown>;
}
