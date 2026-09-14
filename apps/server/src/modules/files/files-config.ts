/* eslint-disable no-control-regex -- Explicitly reject control characters in untrusted SMB input. */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { filesError } from './files-policy';

@Injectable()
export class FilesConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly share: string;
  readonly domain: string;
  readonly encrypt: boolean;
  readonly keyId: string;
  readonly fingerprint: string;
  readonly python: string;
  readonly worker = resolve('smb/worker.py');
  readonly connectTimeout: number;
  readonly idleTimeout: number;
  readonly directoryTimeout: number;
  readonly maxUpload: number;
  readonly maxEntries: number;
  readonly perUser: number;
  readonly global: number;
  readonly maxQueued: number;
  readonly secureCookie: boolean;
  private readonly keys = new Map<string, Buffer>();
  constructor(config: ConfigService) {
    const str = (name: string, fallback: string) => config.get<string>(name) ?? fallback;
    const bool = (name: string, fallback: boolean) => {
      const value = str(name, String(fallback));
      if (!['true', 'false'].includes(value)) throw new Error(`Invalid ${name}`);
      return value === 'true';
    };
    const num = (name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
      const value = Number(str(name, String(fallback)));
      if (!Number.isSafeInteger(value) || value < 1 || value > max)
        throw new Error(`Invalid ${name}`);
      return value;
    };
    this.enabled = bool('SMB_ENABLED', false);
    this.host = str('SMB_HOST', '');
    this.port = num('SMB_PORT', 445, 65535);
    this.share = str('SMB_SHARE', 'home');
    this.domain = str('SMB_DOMAIN', '');
    this.encrypt = bool('SMB_ENCRYPTION_REQUIRED', true);
    this.keyId = str('SMB_CREDENTIAL_KEY_ID', 'v1');
    this.connectTimeout = num('SMB_CONNECT_TIMEOUT_MS', 10000, 120000);
    this.idleTimeout = num('SMB_IO_IDLE_TIMEOUT_MS', 60000, 3600000);
    this.directoryTimeout = num('FILES_DIRECTORY_TIMEOUT_MS', 30000, 120000);
    this.maxUpload = num('FILES_MAX_UPLOAD_BYTES', 10737418240);
    this.maxEntries = num('FILES_MAX_DIRECTORY_ENTRIES', 50000, 100000);
    this.perUser = num('FILES_MAX_ACTIVE_PER_USER', 2, 16);
    this.global = num('FILES_MAX_ACTIVE_GLOBAL', 8, 64);
    this.maxQueued = num('FILES_MAX_QUEUED_PER_USER', 100, 1000);
    this.secureCookie =
      str('NODE_ENV', 'development') === 'production' ||
      !bool('FILES_ALLOW_INSECURE_LOCAL_COOKIE', false);
    this.python = str(
      'SMB_PYTHON',
      existsSync('.venv/bin/python') ? resolve('.venv/bin/python') : 'python3',
    );
    this.fingerprint = createHash('sha256')
      .update(JSON.stringify([this.host, this.port, this.share, this.domain, this.encrypt]))
      .digest('hex');
    if (this.enabled) {
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(this.host) ||
        !/^[^\\/\u0000-\u001f:]+$/.test(this.share) ||
        this.share.length > 255 ||
        /[\\/\u0000-\u001f]/.test(this.domain) ||
        !/^[a-zA-Z0-9_-]{1,32}$/.test(this.keyId)
      )
        throw new Error('Invalid SMB target configuration');
      const addKey = (id: string, value: string) => {
        const key = Buffer.from(value, 'base64');
        if (key.length !== 32 || key.toString('base64') !== value)
          throw new Error('Invalid SMB credential key');
        this.keys.set(id, key);
      };
      try {
        const previous: Record<string, string> = JSON.parse(
          str('SMB_CREDENTIAL_PREVIOUS_KEYS', '{}') || '{}',
        ) as Record<string, string>;
        for (const [id, value] of Object.entries(previous)) addKey(id, value);
        addKey(this.keyId, str('SMB_CREDENTIAL_KEY', ''));
      } catch {
        throw new Error('Invalid SMB credential key configuration');
      }
    }
  }
  assertEnabled(): void {
    if (!this.enabled) throw filesError('SMB_DISABLED');
  }
  seal(password: string, userId: string, version: string) {
    const key = this.keys.get(this.keyId);
    if (!key) throw filesError('CREDENTIAL_KEY_UNAVAILABLE');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`${userId}:${version}:${this.fingerprint}`));
    return {
      ciphertext: Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]).toString(
        'base64',
      ),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyId: this.keyId,
    };
  }
  unseal(binding: {
    userId: string;
    version: string;
    configFingerprint: string;
    keyId: string;
    nonce: string;
    authTag: string;
    ciphertext: string;
  }): string {
    try {
      const key = this.keys.get(binding.keyId);
      if (!key) throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(binding.nonce, 'base64'));
      cipher.setAAD(
        Buffer.from(`${binding.userId}:${binding.version}:${binding.configFingerprint}`),
      );
      cipher.setAuthTag(Buffer.from(binding.authTag, 'base64'));
      return Buffer.concat([
        cipher.update(Buffer.from(binding.ciphertext, 'base64')),
        cipher.final(),
      ]).toString('utf8');
    } catch {
      throw filesError('CREDENTIAL_KEY_UNAVAILABLE');
    }
  }
}
