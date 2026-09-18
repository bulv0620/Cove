import { Injectable } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { FilesConfig } from './files-config';
import { filesError } from './files-policy';
import type { FileEntry } from '@cove/shared';

export interface SmbCredentials {
  username: string;
  password: string;
}
export interface WorkerEvent {
  result?: unknown;
  error?: string;
  ready?: FileEntry;
  created?: { objectId: string };
  prepared?: {
    bytes: string;
    objectId: string;
    mediaType?: string;
    extension?: string;
    sha256?: string;
  };
  progress?: string;
}
export interface WorkerHandle {
  process: ChildProcess;
  input: Writable;
  output: Readable;
  done: Promise<unknown>;
  commit: () => void;
  cancel: () => void;
}

@Injectable()
export class SmbAdapter {
  private activeWorkers = 0;
  assertCapacity(): void {
    if (this.activeWorkers >= this.config.global) throw filesError('RATE_LIMITED');
  }
  constructor(private readonly config: FilesConfig) {}
  start(
    credentials: SmbCredentials,
    input: Record<string, unknown>,
    onEvent?: (event: WorkerEvent) => Promise<void> | void,
  ): WorkerHandle {
    this.config.assertEnabled();
    this.assertCapacity();
    const child = spawn(this.config.python, ['-u', this.config.worker], {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      // Do not pass database, JWT, encryption keys, or any NAS credential through env.
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
    this.activeWorkers++;
    child.once('close', () => {
      this.activeWorkers--;
    });
    const stdin = child.stdin!;
    const stdout = child.stdout!;
    let timer: ReturnType<typeof setTimeout>;
    let failure: Error | undefined;
    let result: unknown;
    let buffer = '';
    let eventChain = Promise.resolve();
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        failure = filesError('SMB_TIMEOUT');
        child.kill();
      }, this.config.idleTimeout);
      timer.unref();
    };
    touch();
    const maxOutput = this.config.maxEntries * 4096 + 65536;
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      touch();
      buffer += chunk;
      if (Buffer.byteLength(buffer) > maxOutput) {
        failure = filesError('DIRECTORY_TOO_LARGE');
        child.kill();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line) as WorkerEvent;
          if (event.error) failure = filesError(event.error);
          if (event.result !== undefined) result = event.result;
          eventChain = eventChain
            .then(async () => {
              await onEvent?.(event);
            })
            .catch(() => {
              failure = filesError('TRANSFER_INTERRUPTED');
              child.kill();
            });
        } catch {
          failure = filesError('SMB_UNAVAILABLE');
          child.kill();
        }
      }
    });
    // Reading data through downstream backpressure also resets the inactivity timeout.
    const originalRead = stdout.read.bind(stdout);
    stdout.read = (size?: number) => {
      const chunk = originalRead(size);
      if (chunk) touch();
      return chunk;
    };
    stdin.on('error', () => {
      /* Exit handling provides a sanitized protocol error. */
    });
    const done = new Promise<unknown>((resolve, reject) => {
      child.once('error', () => {
        clearTimeout(timer);
        reject(filesError('SMB_UNAVAILABLE'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        void eventChain.then(() => {
          if (code !== 0 || failure || result === undefined)
            reject(failure ?? filesError('TRANSFER_INTERRUPTED'));
          else resolve(result);
        });
      });
    });
    void done.catch(() => {});
    stdin.write(
      JSON.stringify({
        host: this.config.host,
        port: this.config.port,
        share: this.config.share,
        domain: this.config.domain,
        encrypt: this.config.encrypt,
        connectTimeout: this.config.connectTimeout,
        maxEntries: this.config.maxEntries,
        ...credentials,
        ...input,
      }) + '\n',
    );
    return {
      process: child,
      input: stdin,
      output: stdout,
      done,
      commit: () => {
        (child.stdio[3] as Writable).end('commit\n');
      },
      cancel: () => {
        failure = filesError('TRANSFER_INTERRUPTED');
        child.kill();
      },
    };
  }
  async call<T>(credentials: SmbCredentials, input: Record<string, unknown>): Promise<T> {
    const worker = this.start(credentials, input);
    worker.output.resume();
    worker.input.end();
    const timer = setTimeout(() => worker.cancel(), this.config.directoryTimeout);
    timer.unref();
    try {
      return (await worker.done) as T;
    } finally {
      clearTimeout(timer);
    }
  }
  async writeChunk(worker: WorkerHandle, chunk: Buffer): Promise<void> {
    try {
      if (!worker.input.write(chunk))
        await Promise.race([
          once(worker.input, 'drain'),
          worker.done.then(() => {
            throw filesError('TRANSFER_INTERRUPTED');
          }),
        ]);
    } catch {
      // Prefer the sanitized SMB status over transport errors such as EPIPE.
      await worker.done;
      throw filesError('TRANSFER_INTERRUPTED');
    }
  }
}
