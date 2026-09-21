/**
 * Per-user, per-note recovery drafts in IndexedDB (NOTE-FR-010). Drafts hold
 * unconfirmed editor text between browser refreshes; they are cleared when a
 * save succeeds, on logout/401, and whenever another user signs in.
 */

const DB_NAME = 'cove-notes';
const DB_VERSION = 1;
const STORE = 'drafts';

export interface NoteDraft {
  key: string;
  userId: string;
  bindingVersion: string;
  path: string;
  markdown: string;
  /** Revision the draft was based on; absent only on drafts from older builds. */
  revision?: string;
  savedAt: string;
}

export function draftKey(userId: string, bindingVersion: string, path: string): string {
  // \n cannot appear in any component; it keeps the composite key unambiguous.
  return [userId, bindingVersion, path].join('\n');
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB unavailable'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

export async function saveDraft(draft: Omit<NoteDraft, 'key'>): Promise<void> {
  await withStore('readwrite', (store) =>
    store.put({ ...draft, key: draftKey(draft.userId, draft.bindingVersion, draft.path) }),
  );
}

export async function getDraft(
  userId: string,
  bindingVersion: string,
  path: string,
): Promise<NoteDraft | undefined> {
  return withStore<NoteDraft | undefined>(
    'readonly',
    (store) =>
      store.get(draftKey(userId, bindingVersion, path)) as IDBRequest<NoteDraft | undefined>,
  );
}

export async function deleteDraft(
  userId: string,
  bindingVersion: string,
  path: string,
): Promise<void> {
  await withStore('readwrite', (store) => store.delete(draftKey(userId, bindingVersion, path)));
}

export async function listDrafts(): Promise<NoteDraft[]> {
  return withStore<NoteDraft[]>('readonly', (store) => store.getAll() as IDBRequest<NoteDraft[]>);
}

/** Removes drafts that do not belong to the signed-in user (NOTE-FR-010). */
export async function pruneDraftsForUser(userId: string): Promise<void> {
  const drafts = await listDrafts();
  const stale = drafts.filter((draft) => draft.userId !== userId);
  if (!stale.length) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      for (const draft of stale) store.delete(draft.key);
      const transaction = store.transaction;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('indexedDB cleanup failed'));
    });
  } finally {
    db.close();
  }
}

export async function clearAllDrafts(): Promise<void> {
  await withStore('readwrite', (store) => store.clear());
}

let authCleanupBound = false;

/**
 * Clears every draft when authentication ends (logout or 401). Idempotent;
 * called when a notes page mounts.
 */
export function bindDraftAuthCleanup(): void {
  if (authCleanupBound) return;
  authCleanupBound = true;
  window.addEventListener('cove:unauthorized', () => {
    void clearAllDrafts().catch(() => undefined);
  });
}
