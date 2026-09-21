/**
 * Serializes saves for one open note (NOTE-FR-009). In the default automatic
 * mode it also turns continuous typing into a bounded number of SMB commits
 * (NOTE-FR-011): a short browser draft, a debounced commit, and a hard cap on
 * how long unsaved edits may wait. In manual mode (`autoSave: false`, the mode
 * the Notes page uses) typing only marks the editor dirty: nothing is written
 * until the user asks for a save through `flush()`.
 * All timing and IO are injected so tests can drive the clock deterministically.
 */

export type SavePhase = 'clean' | 'draft' | 'pending' | 'saving' | 'saved' | 'failed' | 'conflict';

export interface SaveQueueSnapshot {
  phase: SavePhase;
  errorCode?: string;
  /** True when the editor holds text that has not been confirmed by the NAS. */
  dirty: boolean;
  saving: boolean;
}

export interface SaveQueueOptions {
  /**
   * False disables every timer: edits stay pending until `flush()`/`retry()`.
   * Recovery drafts are then written by the caller (e.g. on unload), not here.
   */
  autoSave?: boolean;
  draftDelayMs?: number;
  commitDelayMs?: number;
  maxHoldMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  requestId?: () => string;
  persistDraft: (markdown: string, expectedRevision: string) => void;
  clearDraft: () => void;
  commit: (
    markdown: string,
    expectedRevision: string,
    requestId: string,
  ) => Promise<{ revision: string }>;
  onSnapshot?: (snapshot: SaveQueueSnapshot) => void;
}

const DEFAULTS = { draftDelayMs: 500, commitDelayMs: 2500, maxHoldMs: 30_000 };

interface Timer {
  cancel: () => void;
}

export class SaveQueue {
  private readonly autoSave: boolean;
  private readonly draftDelayMs: number;
  private readonly commitDelayMs: number;
  private readonly maxHoldMs: number;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly makeRequestId: () => string;
  private readonly persistDraft: (markdown: string, expectedRevision: string) => void;
  private readonly clearDraft: () => void;
  private readonly commit: SaveQueueOptions['commit'];
  private readonly onSnapshot?: (snapshot: SaveQueueSnapshot) => void;

  private revision = '';
  private saved = '';
  private pending: string | null = null;
  private firstEditAt = 0;
  private lastEditAt = 0;
  private draftTimer: Timer | null = null;
  private commitTimer: Timer | null = null;
  private inFlight: Promise<void> | null = null;
  private rerunAfterFlight = false;
  private disposed = false;
  private phase: SavePhase = 'clean';
  private errorCode: string | undefined;
  private attempt: { markdown: string; requestId: string } | null = null;

  constructor(options: SaveQueueOptions) {
    this.autoSave = options.autoSave ?? true;
    this.draftDelayMs = options.draftDelayMs ?? DEFAULTS.draftDelayMs;
    this.commitDelayMs = options.commitDelayMs ?? DEFAULTS.commitDelayMs;
    this.maxHoldMs = options.maxHoldMs ?? DEFAULTS.maxHoldMs;
    this.now = options.now ?? (() => Date.now());
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      });
    this.makeRequestId = options.requestId ?? (() => crypto.randomUUID());
    this.persistDraft = options.persistDraft;
    this.clearDraft = options.clearDraft;
    this.commit = options.commit;
    this.onSnapshot = options.onSnapshot;
  }

  /**
   * Opens (or re-opens) the queue with the NAS-confirmed body and revision.
   * Re-opening also revives a disposed queue: React StrictMode runs an extra
   * unmount/mount cycle in development, and the queue outlives it because it
   * lives in component state. A real unmount never calls `start()` again.
   */
  start(markdown: string, revision: string): void {
    this.disposed = false;
    this.revision = revision;
    this.saved = markdown;
    this.pending = null;
    this.attempt = null;
    this.cancelTimers();
    this.setPhase('clean');
  }

  /** A conflicting note was resolved by reloading the stored version. */
  reload(markdown: string, revision: string): void {
    this.start(markdown, revision);
  }

  /** Restores a browser draft against the revision it originally observed. */
  restoreDraft(markdown: string, revision?: string): void {
    if (this.disposed || markdown === this.saved) return;
    this.cancelTimers();
    this.pending = markdown;
    if (!revision) {
      // A legacy draft has no safe overwrite precondition. Keep it editable,
      // but frozen, so it can only be copied or explicitly discarded.
      this.errorCode = 'NOTE_CHANGED';
      this.setPhase('conflict');
      return;
    }
    this.revision = revision;
    const at = this.now();
    this.firstEditAt = at;
    this.lastEditAt = at;
    if (this.autoSave) this.scheduleTimers(at);
    this.setPhase('pending');
  }

  edit(markdown: string): void {
    if (this.disposed) return;
    if (markdown === this.saved && this.pending === null) return;
    if (this.phase === 'conflict') {
      // Keep accepting local edits, but never create another SMB commit until
      // the user reloads or saves a copy. The browser draft remains current.
      this.pending = markdown;
      if (this.autoSave) {
        this.draftTimer?.cancel();
        this.draftTimer = this.makeTimer(this.draftDelayMs, () => {
          if (this.pending !== null) this.persistDraft(this.pending, this.revision);
        });
      }
      return;
    }
    if (markdown === this.saved) {
      // Edited back to the stored text: nothing is unsaved any more.
      this.pending = null;
      this.attempt = null;
      this.cancelTimers();
      this.clearDraft();
      this.setPhase('clean');
      return;
    }
    const at = this.now();
    if (this.pending === null) {
      this.firstEditAt = at;
      this.cancelTimers();
    }
    this.pending = markdown;
    this.lastEditAt = at;
    if (this.inFlight) {
      this.rerunAfterFlight = true;
    } else if (this.autoSave) {
      this.scheduleTimers(at);
      this.setPhase('pending');
    } else {
      this.setPhase('pending');
    }
  }

  /** Commit now (explicit save, blur, or switching away); resolves when settled. */
  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.phase === 'conflict') return this.inFlight ?? Promise.resolve();
    const base = this.inFlight ?? Promise.resolve();
    if (this.pending === null || this.pending === this.saved) return base;
    // Keep the newest text: rerun after the in-flight save settles.
    this.rerunAfterFlight = true;
    return base.then(() => {
      if (this.disposed) return;
      if (this.pending !== null && this.pending !== this.saved) return this.runCommit();
    });
  }

  /** Retry after a transient failure; conflicts must be resolved explicitly. */
  retry(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.phase !== 'failed') return Promise.resolve();
    return this.runCommit();
  }

  /** Last text held locally, for draft persistence and conflict resolution. */
  current(): string {
    return this.pending ?? this.saved;
  }

  currentRevision(): string {
    return this.revision;
  }

  snapshot(): SaveQueueSnapshot {
    return {
      phase: this.phase,
      errorCode: this.errorCode,
      dirty: this.pending !== null && this.pending !== this.saved,
      saving: this.phase === 'saving',
    };
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimers();
  }

  private scheduleTimers(at: number): void {
    this.cancelTimers();
    const draftIn = Math.max(0, this.draftDelayMs - (at - this.lastEditAt));
    this.draftTimer = this.makeTimer(draftIn, () => {
      if (this.pending !== null && this.pending !== this.saved) {
        this.persistDraft(this.pending, this.revision);
        this.setPhase('draft');
      }
    });
    // Continuous typing reschedules the debounce, but never past the hold cap.
    const capIn = Math.max(0, this.firstEditAt + this.maxHoldMs - at);
    const debounceIn = Math.max(0, this.commitDelayMs - (at - this.lastEditAt));
    this.commitTimer = this.makeTimer(Math.min(debounceIn, capIn), () => void this.runCommit());
  }

  private makeTimer(delay: number, fn: () => void): Timer {
    const cancel = this.schedule(fn, delay);
    return { cancel };
  }

  private cancelTimers(): void {
    this.draftTimer?.cancel();
    this.commitTimer?.cancel();
    this.draftTimer = null;
    this.commitTimer = null;
  }

  private runCommit(): Promise<void> {
    if (this.inFlight) {
      this.rerunAfterFlight = true;
      return this.inFlight;
    }
    this.cancelTimers();
    if (this.pending === null || this.pending === this.saved) {
      this.setPhase('clean');
      return Promise.resolve();
    }
    const markdown = this.pending;
    const requestId =
      this.attempt?.markdown === markdown ? this.attempt.requestId : this.makeRequestId();
    this.attempt = { markdown, requestId };
    this.setPhase('saving');
    this.inFlight = this.commit(markdown, this.revision, requestId)
      .then((result) => {
        this.attempt = null;
        this.revision = result.revision;
        this.saved = markdown;
        if (this.pending === markdown) {
          this.pending = null;
          this.clearDraft();
        }
        this.setPhase('saved');
      })
      .catch((error: unknown) => {
        const explicitCode =
          typeof (error as { code?: string })?.code === 'string'
            ? (error as { code?: string }).code
            : undefined;
        const code = explicitCode ?? 'TRANSFER_INTERRUPTED';
        if (this.pending === null || this.pending !== markdown) {
          this.attempt = null;
          return; // Superseded.
        }
        // A server response is a definitive outcome, so a user retry is a new
        // operation. A transport-only failure is ambiguous and must reuse the
        // idempotency key to learn whether the first request committed.
        if (explicitCode) this.attempt = null;
        this.errorCode = code;
        // NOTE_CHANGED is terminal for autosave; everything else stays retryable.
        this.setPhase(code === 'NOTE_CHANGED' ? 'conflict' : 'failed');
      })
      .then(() => {
        this.inFlight = null;
        if (this.disposed) return;
        if (this.phase === 'conflict' || this.phase === 'failed') {
          this.rerunAfterFlight = false;
          return;
        }
        if (this.rerunAfterFlight) {
          this.rerunAfterFlight = false;
          if (this.pending !== null && this.pending !== this.saved) {
            if (!this.autoSave) {
              // Manual mode: newer text stays pending until the next save.
              this.setPhase('pending');
              return;
            }
            this.firstEditAt = this.now();
            this.scheduleTimers(this.now());
            return;
          }
        }
        if (this.pending === null || this.pending === this.saved) this.setPhase('clean');
      });
    return this.inFlight;
  }

  private setPhase(phase: SavePhase): void {
    if (this.phase !== phase) {
      this.phase = phase;
      if (phase === 'clean' || phase === 'saved') this.errorCode = undefined;
    }
    this.onSnapshot?.(this.snapshot());
  }
}
