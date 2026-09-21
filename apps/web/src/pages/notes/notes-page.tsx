import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  LoaderCircle,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { FileEntry, NoteContent, NotesEntriesResponse } from '@cove/shared';
import { usePageSessionActivity } from '@/app/page-session-activity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/features/auth/hooks';
import { notesApi } from '@/features/notes/api';
import { readStored, writeStored } from '@/lib/storage';
import {
  bindDraftAuthCleanup,
  deleteDraft,
  getDraft,
  pruneDraftsForUser,
  saveDraft,
} from '@/features/notes/drafts';
import {
  createNoteImageUpload,
  imageAltText,
  isSupportedImage,
} from '@/features/notes/image-uploads';
import { MarkdownEditor, type MarkdownEditorHandle } from '@/features/notes/markdown-editor';
import { SaveQueue, type SaveQueueSnapshot } from '@/features/notes/save-queue';
import { cn } from '@/lib/utils';

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function baseName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

function joinPath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

/** The tree root itself cannot be renamed or deleted. */
function isRootEntry(entry: FileEntry): boolean {
  return entry.relativePath === '';
}

/** How long a rejected-paste notice stays before it clears itself. */
const UNSUPPORTED_NOTICE_MS = 6000;

/** Width bounds for the tree pane; the reader's choice is remembered per user. */
const TREE_MIN_WIDTH = 200;
const TREE_MAX_WIDTH = 520;
const TREE_DEFAULT_WIDTH = 280;
const TREE_KEYBOARD_STEP = 16;

function clampTreeWidth(width: number): number {
  return Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, Math.round(width)));
}

/** Client-side pre-check only; the server remains authoritative (NOTE-FR-003). */
function isPlausibleName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (/[\\/:*?"<>|]/u.test(name)) return false;
  // Reject control characters without a control-character regex class.
  if (
    [...name].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    return false;
  return !name.endsWith('.') && !name.endsWith(' ');
}

/** Appends .md; returns null for names with a non-markdown extension. */
function normalizeNoteName(raw: string): string | null {
  const name = raw.trim();
  if (!isPlausibleName(name)) return null;
  if (/\.md$/i.test(name)) return name;
  return /\.[^./\\]+$/.test(name) ? null : `${name}.md`;
}

function normalizeFolderName(raw: string): string | null {
  const name = raw.trim();
  return isPlausibleName(name) ? name : null;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'TRANSFER_INTERRUPTED';
}

function timestampSuffix(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(
    at.getMinutes(),
  )}${pad(at.getSeconds())}`;
}

type DialogState =
  | { kind: 'createNote'; dir: string }
  | { kind: 'createFolder'; dir: string }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'delete'; entry: FileEntry }
  | null;

/** Row menu opened by right-click (or the keyboard context-menu key). */
interface TreeMenuState {
  entry: FileEntry;
  x: number;
  y: number;
}

/**
 * Navigating away from a dirty note is confirmed first. `path` is the note to
 * open, or null when the editor is being closed.
 */
interface SwitchPrompt {
  path: string | null;
}

interface ImageUploadRow {
  key: string;
  fileName: string;
  sizeBytes: number;
  ratio: number;
  state: 'uploading' | 'failed';
  errorCode?: string;
  controller: AbortController;
  file: File;
}

interface NoteEditorProps {
  path: string;
  initial: NoteContent;
  userId: string;
  bindingVersion: string;
  canUpdate: boolean;
  onBack: () => void;
  onOpenPath: (path: string) => void;
  onSessionChange: (session: NoteEditorSession | null) => void;
  /** Whether the tree pane is collapsed, and the toggle that flips it. */
  treeCollapsed: boolean;
  onToggleTree: () => void;
}

/** What the page needs to know about the open note to guard navigation. */
interface NoteEditorSession {
  path: string;
  isDirty: () => boolean;
  /** Commits the pending text; never throws — the outcome is the result. */
  save: () => Promise<{ ok: boolean; errorCode?: string }>;
  /** Abandons the local text so unmounting writes no recovery draft. */
  discard: () => void;
}

/**
 * One open note. Keyed by path + binding version so switching notes or a
 * re-bind rebuilds the save queue; the queue itself lives for this mount only.
 * Saving is explicit (NOTE-FR-011): the queue runs in manual mode, so typing
 * never reaches the NAS until the user saves.
 */
function NoteEditor({
  path,
  initial,
  userId,
  bindingVersion,
  canUpdate,
  onBack,
  onOpenPath,
  onSessionChange,
  treeCollapsed,
  onToggleTree,
}: NoteEditorProps) {
  const { t, i18n } = useTranslation();
  const cache = useQueryClient();
  const sessionActive = usePageSessionActivity();
  const [snapshot, setSnapshot] = useState<SaveQueueSnapshot>({
    phase: 'clean',
    dirty: false,
    saving: false,
  });
  const [mountedMarkdown, setMountedMarkdown] = useState(initial.markdown);
  const [epoch, setEpoch] = useState(0);
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof getDraft>>>();
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingCopy, setSavingCopy] = useState(false);
  const [imageUploads, setImageUploads] = useState<ImageUploadRow[]>([]);
  const [unsupportedImageCount, setUnsupportedImageCount] = useState(0);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const imageUploadsRef = useRef<ImageUploadRow[]>([]);
  const discardedRef = useRef(false);

  const [queue] = useState(
    () =>
      new SaveQueue({
        // Manual saving: edits only mark the note dirty until the user saves.
        autoSave: false,
        persistDraft: (markdown, revision) => {
          void saveDraft({
            userId,
            bindingVersion,
            path,
            markdown,
            revision,
            savedAt: new Date().toISOString(),
          }).catch(() => undefined);
        },
        clearDraft: () => {
          void deleteDraft(userId, bindingVersion, path).catch(() => undefined);
        },
        commit: async (markdown, expectedRevision, requestId) => {
          const result = await notesApi.save({
            path,
            markdown,
            expectedRevision,
            requestId,
          });
          cache.setQueryData<NoteContent>(['notes', userId, 'content', path], (previous) =>
            previous
              ? {
                  ...previous,
                  markdown,
                  revision: result.revision,
                  sizeBytes: result.sizeBytes,
                  modifiedAt: result.modifiedAt,
                }
              : previous,
          );
          // The save replaced the NAS object: keep the sibling listing's entry
          // pointing at the committed identity, which is what rename and delete
          // check against (NOTE-NFR-003).
          cache.setQueryData<InfiniteData<NotesEntriesResponse>>(
            ['notes', userId, 'tree', parentPath(path)],
            (previous) =>
              previous && {
                ...previous,
                pages: previous.pages.map((page) => ({
                  ...page,
                  entries: page.entries.map((entry) =>
                    entry.relativePath === path
                      ? {
                          ...entry,
                          objectId: result.objectId,
                          sizeBytes: result.sizeBytes,
                          modifiedAt: result.modifiedAt,
                        }
                      : entry,
                  ),
                })),
              },
          );
          return { revision: result.revision };
        },
        onSnapshot: (next) => {
          setSnapshot(next);
          if (next.phase === 'conflict') setConflictDismissed(false);
        },
      }),
  );

  useEffect(() => {
    onSessionChange({
      path,
      isDirty: () => queue.snapshot().dirty,
      save: async () => {
        if (imageUploadsRef.current.some((row) => row.state === 'uploading'))
          return { ok: false, errorCode: 'FILE_BUSY' };
        await queue.flush();
        const next = queue.snapshot();
        if (!next.dirty && next.phase !== 'failed' && next.phase !== 'conflict')
          return { ok: true };
        return { ok: false, errorCode: next.errorCode ?? 'TRANSFER_INTERRUPTED' };
      },
      discard: () => {
        discardedRef.current = true;
      },
    });
    return () => onSessionChange(null);
  }, [onSessionChange, path, queue]);

  // One-time open: seed the queue and surface any stored recovery draft.
  useEffect(() => {
    queue.start(initial.markdown, initial.revision);
    let active = true;
    void getDraft(userId, bindingVersion, path)
      .then((existing) => {
        if (!active) return;
        if (existing && existing.markdown !== initial.markdown) setDraft(existing);
        else if (existing) void deleteDraft(userId, bindingVersion, path).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // Only on mount: later cache updates must not reset editor state.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Unmount: persist the newest text as a draft so a crash loses nothing, then stop.
  useEffect(() => {
    const readLocal = () => ({
      state: queue.snapshot(),
      text: queue.current(),
      revision: queue.currentRevision(),
    });
    return () => {
      const { state, text, revision } = readLocal();
      if (!discardedRef.current && state.dirty && text !== null) {
        void saveDraft({
          userId,
          bindingVersion,
          path,
          markdown: text,
          revision,
          savedAt: new Date().toISOString(),
        }).catch(() => undefined);
      }
      queue.dispose();
    };
  }, [queue, userId, bindingVersion, path]);

  // Refresh or app switch: the draft is the only safety net for unsaved text,
  // because leaving the page never commits to the NAS on its own.
  useEffect(() => {
    const flush = () => {
      if (discardedRef.current) return;
      const state = queue.snapshot();
      if (state.dirty)
        void saveDraft({
          userId,
          bindingVersion,
          path,
          markdown: queue.current(),
          revision: queue.currentRevision(),
          savedAt: new Date().toISOString(),
        }).catch(() => undefined);
    };
    window.addEventListener('pagehide', flush);
    const onVisibility = () => {
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [bindingVersion, path, queue, userId]);

  // Cmd/Ctrl+S saves, but only while the Notes page session is the active one.
  useEffect(() => {
    if (!sessionActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void queue.flush();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [queue, sessionActive]);

  const restoreDraft = () => {
    if (!draft) return;
    setMountedMarkdown(draft.markdown);
    setEpoch((value) => value + 1);
    setDraft(undefined);
    queue.restoreDraft(draft.markdown, draft.revision);
  };

  const discardDraft = () => {
    void deleteDraft(userId, bindingVersion, path).catch(() => undefined);
    setDraft(undefined);
  };

  const patchUpload = (key: string, patch: Partial<ImageUploadRow>) => {
    setImageUploads((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeUpload = (key: string) => {
    setImageUploads((rows) => rows.filter((row) => row.key !== key));
  };

  useEffect(() => {
    imageUploadsRef.current = imageUploads;
  }, [imageUploads]);

  // The notice for a rejected paste is transient feedback, not a state to keep.
  useEffect(() => {
    if (unsupportedImageCount === 0) return;
    const timer = setTimeout(() => setUnsupportedImageCount(0), UNSUPPORTED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [unsupportedImageCount]);

  useEffect(
    () => () => {
      for (const row of imageUploadsRef.current) {
        if (row.state === 'uploading') row.controller.abort();
      }
    },
    [],
  );

  /** Runs one image through hosting; inserts the URL only after confirmation. */
  const runImageUpload = (row: ImageUploadRow) => {
    const controller = row.controller.signal.aborted ? new AbortController() : row.controller;
    const upload = createNoteImageUpload(row.file);
    patchUpload(row.key, { state: 'uploading', ratio: 0, errorCode: undefined, controller });
    void upload
      .run({
        onProgress: (ratio) => patchUpload(row.key, { ratio }),
        signal: controller.signal,
      })
      .then(({ url }) => {
        // A finished upload has nothing left to report: drop its card.
        removeUpload(row.key);
        editorRef.current?.insertMarkdown(`\n\n![${imageAltText(row.fileName)}](${url})\n\n`);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          // A cancelled upload has nothing to report: drop its card.
          removeUpload(row.key);
          return;
        }
        const code =
          error instanceof Error && error.message ? error.message : 'TRANSFER_INTERRUPTED';
        patchUpload(row.key, { state: 'failed', errorCode: code });
      });
  };

  /** Paste/drop entry point (NOTE-FR-012): queue every image for hosting. */
  const handleImageFiles = (files: File[]) => {
    if (!canUpdate) return;
    const rows: ImageUploadRow[] = [];
    for (const file of files) {
      if (!isSupportedImage(file)) continue;
      rows.push({
        key: crypto.randomUUID(),
        fileName: file.name,
        sizeBytes: file.size,
        ratio: 0,
        state: 'uploading',
        controller: new AbortController(),
        file,
      });
    }
    if (rows.length === 0) {
      setUnsupportedImageCount((count) => count + files.filter((f) => !isSupportedImage(f)).length);
      return;
    }
    setImageUploads((current) => [...current, ...rows]);
    for (const row of rows) runImageUpload(row);
  };

  const cancelImageUpload = (row: ImageUploadRow) => {
    row.controller.abort();
    removeUpload(row.key);
  };

  /** Conflict resolution: drop the local version and reload the stored one. */
  const reloadStored = async () => {
    setActionError(null);
    try {
      const fresh = await notesApi.content(path);
      cache.setQueryData<NoteContent>(['notes', userId, 'content', path], fresh);
      queue.reload(fresh.markdown, fresh.revision);
      setMountedMarkdown(fresh.markdown);
      setEpoch((value) => value + 1);
      void deleteDraft(userId, bindingVersion, path).catch(() => undefined);
    } catch (error) {
      setActionError(errorText(errorCodeOf(error)));
    }
  };

  /** Conflict resolution: write the local text to a fresh note and open it. */
  const saveCopyAsNew = async () => {
    setActionError(null);
    setSavingCopy(true);
    try {
      const stem = baseName(path).replace(/\.md$/i, '');
      const copyPath = joinPath(parentPath(path), `${stem}-copy-${timestampSuffix(new Date())}.md`);
      await notesApi.createFile(copyPath);
      const fresh = await notesApi.content(copyPath);
      const local = queue.current();
      const saved = await notesApi.save({
        path: copyPath,
        markdown: local,
        expectedRevision: fresh.revision,
        requestId: crypto.randomUUID(),
      });
      queue.start(local, saved.revision);
      await deleteDraft(userId, bindingVersion, path).catch(() => undefined);
      await cache.invalidateQueries({ queryKey: ['notes', userId, 'tree'] });
      onOpenPath(copyPath);
    } catch (error) {
      setActionError(errorText(errorCodeOf(error)));
    } finally {
      setSavingCopy(false);
    }
  };

  const errorText = (code?: string | null) =>
    code
      ? t(`notes.errors.${code}`, { defaultValue: t('notes.errors.TRANSFER_INTERRUPTED') })
      : null;

  const statusLabel =
    snapshot.phase === 'saving'
      ? t('notes.saving')
      : snapshot.phase === 'saved'
        ? t('notes.saved')
        : snapshot.phase === 'failed'
          ? t('notes.saveFailed')
          : snapshot.phase === 'conflict'
            ? t('notes.conflictTitle')
            : snapshot.dirty
              ? t('notes.unsaved')
              : '';
  const saving = snapshot.phase === 'saving';
  const canSave = canUpdate && snapshot.dirty && !saving && snapshot.phase !== 'conflict';

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label={baseName(path)}
    >
      <header className="flex min-h-11 items-center gap-2 border-b px-2 py-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 min-h-0 lg:hidden"
          onClick={onBack}
          aria-label={t('notes.back')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="hidden h-8 w-8 min-h-0 lg:inline-flex"
          aria-label={treeCollapsed ? t('notes.showTree') : t('notes.hideTree')}
          aria-expanded={!treeCollapsed}
          onClick={onToggleTree}
        >
          {treeCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
        <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium" title={baseName(path)}>
          {baseName(path)}
        </h2>
        <span
          className={cn(
            'hidden shrink-0 text-xs sm:inline',
            snapshot.phase === 'failed' || snapshot.phase === 'conflict'
              ? 'text-destructive'
              : snapshot.dirty
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground',
          )}
          aria-live="polite"
        >
          {statusLabel}
        </span>
        <Button
          size="sm"
          className="shrink-0"
          disabled={!canSave}
          onClick={() => void queue.flush()}
        >
          {saving ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {t('notes.save')}
        </Button>
      </header>

      {snapshot.phase === 'failed' && (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {errorText(snapshot.errorCode)}
        </p>
      )}

      {draft && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm">
          <span className="min-w-0 flex-1">
            {t('notes.draftFound', {
              time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(
                new Date(draft.savedAt),
              ),
            })}
          </span>
          <Button size="sm" onClick={restoreDraft}>
            {t('notes.draftRestore')}
          </Button>
          <Button size="sm" variant="outline" onClick={discardDraft}>
            {t('notes.draftDiscard')}
          </Button>
        </div>
      )}

      {snapshot.phase === 'conflict' && !conflictDismissed && (
        <div className="border-b bg-amber-500/10 px-4 py-3">
          <p
            role="alert"
            className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400"
          >
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {t('notes.conflictTitle')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('notes.conflictDescription')}</p>
          {actionError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {actionError}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void reloadStored()}>
              {t('notes.conflictReload')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={savingCopy}
              onClick={() => void saveCopyAsNew()}
            >
              {t('notes.conflictSaveAsNew')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConflictDismissed(true)}>
              {t('notes.conflictKeep')}
            </Button>
          </div>
        </div>
      )}

      {(imageUploads.length > 0 || unsupportedImageCount > 0) && (
        <div
          className="absolute bottom-3 right-3 z-10 max-h-[45vh] w-72 max-w-[calc(100%-1.5rem)] space-y-2 overflow-y-auto rounded-lg border bg-popover p-3 shadow-lg"
          aria-label={t('notes.imageUploads')}
        >
          {unsupportedImageCount > 0 && (
            <p role="alert" className="text-xs text-destructive">
              {t('notes.imageUnsupportedType')}
            </p>
          )}
          {imageUploads.map((row) => (
            <div key={row.key} className="rounded-lg border p-2.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium" title={row.fileName}>
                  {row.fileName}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {row.state === 'uploading'
                    ? `${Math.round(row.ratio * 100)}%`
                    : t('notes.saveFailed')}
                </span>
                {row.state === 'uploading' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => cancelImageUpload(row)}
                  >
                    {t('notes.cancel')}
                  </Button>
                )}
                {row.state === 'failed' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => runImageUpload(row)}
                  >
                    {t('notes.retry')}
                  </Button>
                )}
              </div>
              {row.state === 'failed' && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {errorText(row.errorCode)}
                </p>
              )}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full bg-primary transition-[width]',
                    row.state === 'failed' && 'bg-destructive',
                  )}
                  style={{ width: `${Math.round(row.ratio * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The editor host needs a definite height: MDXEditor's full-height mode
          stretches its contenteditable through a flex chain, which only works
          when every link has a resolvable height. Its own scroller then takes
          over, and clicking the empty space below the text lands in the
          contenteditable, so the caret goes to the last line. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MarkdownEditor
          key={epoch}
          ref={editorRef}
          markdown={mountedMarkdown}
          readOnly={!canUpdate}
          label={t('notes.editorLabel')}
          onChange={(markdown, normalized) => {
            if (!normalized) queue.edit(markdown);
          }}
          onImageFiles={handleImageFiles}
          className="h-full"
        />
      </div>
    </section>
  );
}

interface NoteTreeContext {
  userId: string;
  current: string | null;
  available: boolean;
  onOpenNote: (path: string) => void;
  /** Opens the row menu at the pointer (or at the row for keyboard users). */
  onContextMenu: (entry: FileEntry, event: MouseEvent<HTMLDivElement>) => void;
}

/**
 * One directory row and, when expanded, its children (directories first).
 * Children are fetched lazily per directory, so a deep tree costs one listing
 * per opened level and never reads note bodies (NOTE-NFR-007).
 */
function NoteTreeNode({
  entry,
  depth,
  ctx,
}: {
  entry: FileEntry;
  depth: number;
  ctx: NoteTreeContext;
}): JSX.Element {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const isDirectory = entry.type === 'directory';
  const isRoot = entry.relativePath === '';
  const [expanded, setExpanded] = useState(
    isRoot || (ctx.current ?? '').startsWith(entry.relativePath + '/'),
  );
  const children = useInfiniteQuery({
    queryKey: ['notes', ctx.userId, 'tree', entry.relativePath],
    queryFn: ({ pageParam }) =>
      notesApi.entries(
        pageParam ? { path: entry.relativePath, cursor: pageParam } : { path: entry.relativePath },
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: ctx.available && isDirectory && expanded,
    retry: false,
  });
  const childEntries = children.data?.pages.flatMap((page) => page.entries) ?? [];
  const selected = ctx.current === entry.relativePath;
  const toggleDirectory = () => {
    setExpanded((value) => !value);
  };

  return (
    <div>
      <div
        className={cn(
          'flex min-h-9 items-center gap-1 rounded-md pr-1 text-sm hover:bg-accent',
          selected && 'bg-accent',
        )}
        style={{ paddingLeft: 4 + Math.min(depth, 6) * 12 }}
        onContextMenu={(event) => ctx.onContextMenu(entry, event)}
      >
        {isDirectory ? (
          <button
            type="button"
            className="flex h-7 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${expanded ? t('notes.collapse') : t('notes.expand')} ${entry.name}`}
            aria-expanded={expanded}
            onClick={toggleDirectory}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span aria-hidden className="h-7 w-6 shrink-0" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={entry.name}
          onClick={() => (isDirectory ? toggleDirectory() : ctx.onOpenNote(entry.relativePath))}
        >
          {isDirectory ? (
            <Folder className="h-4 w-4 shrink-0 text-sky-500" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className={cn('truncate', selected && 'font-medium')}>{entry.name}</span>
        </button>
      </div>

      {isDirectory && expanded && (
        <div>
          {children.isPending ? (
            <p
              className="py-2 text-xs text-muted-foreground"
              style={{ paddingLeft: 34 + Math.min(depth + 1, 6) * 12 }}
            >
              {t('notes.loading')}
            </p>
          ) : children.isError ? (
            <button
              type="button"
              className="py-2 text-xs text-destructive"
              style={{ paddingLeft: 34 + Math.min(depth + 1, 6) * 12 }}
              onClick={() => void children.refetch()}
            >
              {errorText(errorCodeOf(children.error)) ?? t('notes.retry')}
            </button>
          ) : childEntries.length === 0 && isRoot ? (
            <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
              <FileText className="h-7 w-7 text-muted-foreground" />
              <p className="mt-1 text-sm font-medium">{t('notes.emptyFolder')}</p>
              <p className="text-xs text-muted-foreground">{t('notes.emptyFolderHint')}</p>
            </div>
          ) : (
            childEntries.map((child) => (
              <NoteTreeNode key={child.relativePath} entry={child} depth={depth + 1} ctx={ctx} />
            ))
          )}
          {children.hasNextPage && (
            <div className="py-1" style={{ paddingLeft: 34 + Math.min(depth + 1, 6) * 12 }}>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 min-h-0 px-2 text-xs"
                disabled={children.isFetchingNextPage}
                onClick={() => void children.fetchNextPage()}
              >
                {children.isFetchingNextPage && (
                  <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                )}
                {t('notes.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Maps a stable error code to localized copy; null when there is no code. */
function useErrorText(): (code?: string | null) => string | null {
  const { t } = useTranslation();
  return (code) =>
    code
      ? t(`notes.errors.${code}`, { defaultValue: t('notes.errors.TRANSFER_INTERRUPTED') })
      : null;
}

export function NotesPage(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const noteParam = params.get('note');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [nameValue, setNameValue] = useState('');
  const [menu, setMenu] = useState<TreeMenuState | null>(null);
  const [editorSession, setEditorSession] = useState<NoteEditorSession | null>(null);
  const [switching, setSwitching] = useState<SwitchPrompt | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchSaving, setSwitchSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const sessionActive = usePageSessionActivity();

  // Tree pane preferences, kept per user like the other page preferences.
  const treePrefs = `cove.notes.tree.${user?.id ?? ''}`;
  const [treeWidth, setTreeWidthState] = useState(() => {
    const stored = Number(readStored(`${treePrefs}.width`));
    return stored > 0 ? clampTreeWidth(stored) : TREE_DEFAULT_WIDTH;
  });
  const [treeCollapsed, setTreeCollapsedState] = useState(
    () => readStored(`${treePrefs}.collapsed`) === 'true',
  );
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(treeWidth);
  const dragRef = useRef<{ pointerX: number; width: number } | null>(null);
  const setTreeWidth = (width: number, persist = false) => {
    const next = clampTreeWidth(width);
    widthRef.current = next;
    setTreeWidthState(next);
    if (persist) writeStored(`${treePrefs}.width`, String(next));
  };
  const setTreeCollapsed = (collapsed: boolean) => {
    setTreeCollapsedState(collapsed);
    writeStored(`${treePrefs}.collapsed`, String(collapsed));
  };
  const resizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerX: event.clientX, width: widthRef.current };
    setResizing(true);
  };
  const resizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setTreeWidth(drag.width + (event.clientX - drag.pointerX));
  };
  const resizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    writeStored(`${treePrefs}.width`, String(widthRef.current));
  };
  const resizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowLeft'
        ? -TREE_KEYBOARD_STEP
        : event.key === 'ArrowRight'
          ? TREE_KEYBOARD_STEP
          : 0;
    if (step === 0) return;
    event.preventDefault();
    setTreeWidth(widthRef.current + step, true);
  };
  const handleSessionChange = useCallback((session: NoteEditorSession | null) => {
    setEditorSession(session);
  }, []);
  const errorText = useErrorText();

  const status = useQuery({
    queryKey: ['notes', user?.id, 'status'],
    queryFn: notesApi.status,
    retry: false,
    enabled: !!user?.id,
  });
  const available =
    !!status.data?.enabled && !!status.data.bound && status.data.state !== 'SMB_CONFIG_CHANGED';
  const bindingVersion = status.data?.version ?? '';

  const content = useQuery({
    queryKey: ['notes', user?.id, 'content', noteParam],
    queryFn: () => notesApi.content(noteParam!),
    enabled: available && !!noteParam,
    retry: false,
  });

  useEffect(() => {
    bindDraftAuthCleanup();
    if (user?.id) void pruneDraftsForUser(user.id).catch(() => undefined);
  }, [user?.id]);

  // Row menu: focus it on open, dismiss on outside press or Escape.
  useEffect(() => {
    if (!menu || !sessionActive) return;
    menuRef.current?.focus();
    const dismiss = () => setMenu(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [menu, sessionActive]);

  const navigate = (nextNote: string | null) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('dir'); // Legacy navigation parameter.
      if (nextNote) next.set('note', nextNote);
      else next.delete('note');
      return next;
    });
  };

  /** Opens a note (or closes the editor) once the dirty check has passed. */
  const openNote = (nextNote: string | null) => {
    setSwitching(null);
    setSwitchError(null);
    navigate(nextNote);
  };

  /** Guard (NOTE-FR-009): confirm before abandoning unsaved text. */
  const requestOpenNote = (nextNote: string | null) => {
    if (nextNote === noteParam) return;
    if (editorSession?.isDirty()) {
      setSwitchError(null);
      setSwitching({ path: nextNote });
      return;
    }
    openNote(nextNote);
  };

  const saveThenSwitch = async () => {
    const target = switching?.path ?? null;
    if (!editorSession) {
      openNote(target);
      return;
    }
    setSwitchSaving(true);
    setSwitchError(null);
    const result = await editorSession.save();
    setSwitchSaving(false);
    if (!result.ok) {
      setSwitchError(errorText(result.errorCode));
      return;
    }
    openNote(target);
  };

  const discardThenSwitch = () => {
    editorSession?.discard();
    if (noteParam && user?.id)
      void deleteDraft(user.id, bindingVersion, noteParam).catch(() => undefined);
    openNote(switching?.path ?? null);
  };

  const closeDialog = () => {
    setDialog(null);
    createMutation.reset();
    renameMutation.reset();
    deleteMutation.reset();
  };

  const createMutation = useMutation({
    mutationFn: async (request: { kind: 'note' | 'folder'; path: string }) => {
      if (request.kind === 'folder') await notesApi.createFolder(request.path);
      else await notesApi.createFile(request.path);
      return request;
    },
    onSuccess: (request) => {
      closeDialog();
      void cache.invalidateQueries({ queryKey: ['notes', user?.id, 'tree'] });
      if (request.kind === 'note') openNote(request.path);
    },
  });
  const renameMutation = useMutation({
    mutationFn: async (request: { from: string; to: string; objectId?: string | null }) => {
      // Renaming the open note moves it out from under the editor, so unsaved
      // text is committed first; a failed save aborts the rename.
      if (editorSession?.path === request.from) {
        const result = await editorSession.save();
        if (!result.ok)
          throw Object.assign(new Error(result.errorCode ?? 'TRANSFER_INTERRUPTED'), {
            code: result.errorCode,
          });
      }
      await notesApi.rename(request.from, baseName(request.to), request.objectId);
      return request;
    },
    onSuccess: (request) => {
      closeDialog();
      void cache.invalidateQueries({ queryKey: ['notes', user?.id, 'tree'] });
      if (noteParam === request.from) openNote(request.to);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (request: { path: string; objectId?: string | null }) =>
      notesApi.remove(request.path, request.objectId).then(() => request),
    onSuccess: (request) => {
      closeDialog();
      void cache.invalidateQueries({ queryKey: ['notes', user?.id, 'tree'] });
      if (noteParam === request.path) {
        // The note is gone: drop the local text instead of drafting it back.
        editorSession?.discard();
        openNote(null);
      }
    },
  });
  // The dialog kind owns its mutation: selecting by isPending would drop the
  // error the moment a request fails and flip back to another mutation.
  const dialogMutation =
    dialog?.kind === 'createNote' || dialog?.kind === 'createFolder'
      ? createMutation
      : dialog?.kind === 'rename'
        ? renameMutation
        : deleteMutation;

  const submitDialog = (event: FormEvent) => {
    event.preventDefault();
    if (!dialog) return;
    if (dialog.kind === 'createNote') {
      const name = normalizeNoteName(nameValue);
      if (!name) return;
      createMutation.mutate({ kind: 'note', path: joinPath(dialog.dir, name) });
    } else if (dialog.kind === 'createFolder') {
      const name = normalizeFolderName(nameValue);
      if (!name) return;
      createMutation.mutate({ kind: 'folder', path: joinPath(dialog.dir, name) });
    } else if (dialog.kind === 'rename') {
      const isNote = dialog.entry.type === 'file';
      const name = isNote ? normalizeNoteName(nameValue) : normalizeFolderName(nameValue);
      if (!name || name === dialog.entry.name) return;
      renameMutation.mutate({
        from: dialog.entry.relativePath,
        to: joinPath(parentPath(dialog.entry.relativePath), name),
        objectId: dialog.entry.objectId,
      });
    }
  };

  const startDelete = (entry: FileEntry) => {
    setNameValue('');
    setDialog({ kind: 'delete', entry });
  };

  /** Menu items run against the row they were opened on, then close the menu. */
  const startCreate = (kind: 'note' | 'folder', dir: string) => {
    setNameValue('');
    setMenu(null);
    setDialog(kind === 'note' ? { kind: 'createNote', dir } : { kind: 'createFolder', dir });
  };

  /** Reloads one directory listing only; other levels keep their cache. */
  const refreshDir = (dir: string) => {
    setMenu(null);
    void cache.invalidateQueries({
      queryKey: ['notes', user?.id, 'tree', dir],
      exact: true,
    });
  };

  const openRowMenu = (entry: FileEntry, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const isDirectory = entry.type === 'directory';
    const canManage =
      !isRootEntry(entry) &&
      (!!status.data?.capabilities.rename || !!status.data?.capabilities.delete);
    if (!isDirectory && !canManage) return; // Never open an empty menu.
    // The context-menu key reports no coordinates: anchor to the row instead.
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      entry,
      x: Math.min(fromKeyboard ? rect.left + 24 : event.clientX, window.innerWidth - 200),
      y: Math.min(fromKeyboard ? rect.bottom : event.clientY, window.innerHeight - 220),
    });
  };

  const dialogTitle =
    dialog?.kind === 'createNote'
      ? t('notes.newNote')
      : dialog?.kind === 'createFolder'
        ? t('notes.newFolder')
        : dialog?.kind === 'rename'
          ? t('notes.renameTitle')
          : dialog?.kind === 'delete'
            ? t('notes.deleteTitle', { name: dialog.entry.name })
            : '';

  /** Where a create dialog will place the new item, named for the dialog. */
  const createDir =
    (dialog?.kind === 'createNote' || dialog?.kind === 'createFolder' ? dialog.dir : '') ||
    t('notes.title');

  const statusError =
    status.error?.message ??
    (!status.data?.enabled
      ? 'SMB_DISABLED'
      : !status.data.bound
        ? 'SMB_NOT_BOUND'
        : status.data.state);

  const treeContext: NoteTreeContext = {
    userId: user?.id ?? '',
    current: noteParam,
    available,
    onOpenNote: requestOpenNote,
    onContextMenu: openRowMenu,
  };
  const rootEntry: FileEntry = {
    name: t('notes.title'),
    relativePath: '',
    type: 'directory',
    sizeBytes: '0',
    modifiedAt: '',
    hidden: false,
    supported: true,
    objectId: null,
  };

  if (status.isPending)
    return (
      <div
        className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-2"
        aria-busy="true"
      >
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (!available)
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-4 bg-card p-6 text-center">
        <NotebookPen className="h-10 w-10 text-muted-foreground" />
        <p className="font-medium">{errorText(statusError)}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {t(status.data?.enabled ? 'files.contact' : 'files.configHint')}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => void status.refetch()}>
            {t('files.refresh')}
          </Button>
          {(user?.isSuperAdmin || user?.permissions.includes('identity.user.page')) && (
            <Button asChild>
              <Link to="/users">{t('files.manage')}</Link>
            </Button>
          )}
        </div>
      </div>
    );

  const nameInvalid =
    dialog?.kind === 'createFolder' ||
    (dialog?.kind === 'rename' && dialog.entry.type === 'directory')
      ? nameValue.trim().length > 0 && !normalizeFolderName(nameValue)
      : nameValue.trim().length > 0 && !normalizeNoteName(nameValue);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <section
        className={cn(
          'relative flex min-h-0 flex-1 overflow-hidden bg-card',
          resizing && 'cursor-col-resize select-none',
        )}
        style={{ '--notes-tree-width': `${treeWidth}px` } as CSSProperties}
      >
        {/* Directory tree: hidden on phones while a note is open, and when the
            reader collapses it on wider screens. */}
        <aside
          className={cn(
            'min-h-0 shrink-0 flex-col overflow-hidden',
            !treeCollapsed && 'border-r lg:w-[var(--notes-tree-width)]',
            noteParam ? 'hidden lg:flex' : 'flex',
            treeCollapsed && 'lg:hidden',
          )}
          aria-label={t('notes.tree')}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <NoteTreeNode entry={rootEntry} depth={0} ctx={treeContext} />
          </div>
        </aside>

        {/* Drag handle: resize the tree, double-click restores the default. */}
        {!treeCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('notes.resizeTree')}
            aria-valuenow={treeWidth}
            aria-valuemin={TREE_MIN_WIDTH}
            aria-valuemax={TREE_MAX_WIDTH}
            tabIndex={0}
            className={cn(
              // Overlaps the pane border instead of adding a gap between the
              // panes: the divider itself is the boundary line.
              'hidden w-1.5 shrink-0 cursor-col-resize transition-colors focus-visible:bg-primary/40 focus-visible:outline-none lg:-ml-1.5 lg:block',
              resizing ? 'bg-primary/40' : 'hover:bg-primary/25',
            )}
            onPointerDown={resizeStart}
            onPointerMove={resizeMove}
            onPointerUp={resizeEnd}
            onPointerCancel={resizeEnd}
            onKeyDown={resizeKeyDown}
            onDoubleClick={() => setTreeWidth(TREE_DEFAULT_WIDTH, true)}
          />
        )}

        {/* Editor: only when a note is open; full width on phones. */}
        {noteParam ? (
          content.isPending ? (
            <div
              className="flex min-h-0 min-w-0 flex-1 items-center justify-center"
              aria-busy="true"
            >
              <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : content.isError ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <TriangleAlert className="h-8 w-8 text-muted-foreground" />
              <p role="alert" className="text-sm text-destructive">
                {errorText(errorCodeOf(content.error))}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void content.refetch()}>
                  {t('notes.retry')}
                </Button>
                <Button variant="ghost" onClick={() => openNote(null)}>
                  {t('notes.back')}
                </Button>
              </div>
            </div>
          ) : (
            <NoteEditor
              key={`${noteParam}:${bindingVersion}`}
              path={noteParam}
              initial={content.data}
              userId={user!.id}
              bindingVersion={bindingVersion}
              canUpdate={
                !!status.data?.capabilities.update &&
                !(
                  (renameMutation.isPending && editorSession?.path === noteParam) ||
                  (deleteMutation.isPending && editorSession?.path === noteParam)
                )
              }
              onBack={() => requestOpenNote(null)}
              onOpenPath={(nextPath) => openNote(nextPath)}
              onSessionChange={handleSessionChange}
              treeCollapsed={treeCollapsed}
              onToggleTree={() => setTreeCollapsed(!treeCollapsed)}
            />
          )
        ) : (
          // No note open: the editor pane holds a single empty state, which is
          // about the open note — never about the folder listing on the left.
          <div className="relative hidden min-h-0 min-w-0 flex-1 items-center justify-center text-center lg:flex">
            {/* Same corner as the editor header, so the toggle never moves. */}
            <Button
              size="icon"
              variant="ghost"
              className="absolute left-2 top-2 h-8 w-8 min-h-0"
              aria-label={treeCollapsed ? t('notes.showTree') : t('notes.hideTree')}
              aria-expanded={!treeCollapsed}
              onClick={() => setTreeCollapsed(!treeCollapsed)}
            >
              {treeCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
            <div className="max-w-sm p-8">
              <NotebookPen className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-4 text-sm font-medium">{t('notes.noNote')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('notes.noNoteHint')}</p>
            </div>
          </div>
        )}
      </section>

      {menu && (
        <div
          ref={menuRef}
          tabIndex={-1}
          role="menu"
          aria-label={menu.entry.name}
          className="fixed z-40 w-48 rounded-lg border bg-popover p-1 shadow-xl outline-none"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.entry.type === 'directory' && status.data?.capabilities.create && (
            <>
              <Button
                variant="ghost"
                role="menuitem"
                className="w-full justify-start"
                onClick={() => startCreate('note', menu.entry.relativePath)}
              >
                <FilePlus2 className="mr-2 h-4 w-4" />
                {t('notes.newNote')}
              </Button>
              <Button
                variant="ghost"
                role="menuitem"
                className="w-full justify-start"
                onClick={() => startCreate('folder', menu.entry.relativePath)}
              >
                <FolderPlus className="mr-2 h-4 w-4" />
                {t('notes.newFolder')}
              </Button>
            </>
          )}
          {!isRootEntry(menu.entry) && status.data?.capabilities.rename && (
            <Button
              variant="ghost"
              role="menuitem"
              className="w-full justify-start"
              onClick={() => {
                setNameValue(menu.entry.name);
                setDialog({ kind: 'rename', entry: menu.entry });
                setMenu(null);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              {t('notes.rename')}
            </Button>
          )}
          {!isRootEntry(menu.entry) && status.data?.capabilities.delete && (
            <Button
              variant="ghost"
              role="menuitem"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                setMenu(null);
                startDelete(menu.entry);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('notes.delete')}
            </Button>
          )}
          {menu.entry.type === 'directory' && (
            <Button
              variant="ghost"
              role="menuitem"
              className="w-full justify-start"
              onClick={() => refreshDir(menu.entry.relativePath)}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('notes.refresh')}
            </Button>
          )}
        </div>
      )}

      <Modal
        open={!!switching}
        title={t('notes.unsavedTitle')}
        description={t('notes.unsavedDescription', {
          name: noteParam ? baseName(noteParam) : '',
        })}
        onClose={() => setSwitching(null)}
        className="sm:max-w-md"
      >
        <div>
          {switchError && (
            <p role="alert" className="text-sm text-destructive">
              {switchError}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setSwitching(null)}>
              {t('notes.keepEditing')}
            </Button>
            <Button variant="outline" disabled={switchSaving} onClick={discardThenSwitch}>
              {t('notes.discardAndSwitch')}
            </Button>
            <Button disabled={switchSaving} onClick={() => void saveThenSwitch()}>
              {switchSaving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {t('notes.saveAndSwitch')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!dialog}
        title={dialogTitle}
        description={
          dialog?.kind === 'rename'
            ? t('notes.renameDescription')
            : dialog?.kind === 'delete'
              ? t('notes.deleteDescription')
              : dialog?.kind === 'createNote'
                ? `${t('notes.createIn', { dir: createDir })} · ${t('notes.mdHint')}`
                : dialog?.kind === 'createFolder'
                  ? t('notes.createIn', { dir: createDir })
                  : undefined
        }
        onClose={closeDialog}
        className="sm:max-w-md"
      >
        {dialog?.kind === 'delete' && dialog.entry ? (
          <div>
            <p className="text-sm text-destructive">{t('notes.deleteWarning')}</p>
            {deleteMutation.isError && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {errorText(errorCodeOf(deleteMutation.error))}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={closeDialog}>
                {t('notes.cancel')}
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() =>
                  deleteMutation.mutate({
                    path: dialog.entry!.relativePath,
                    objectId: dialog.entry!.objectId,
                  })
                }
              >
                {deleteMutation.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                {t('notes.deleteConfirm')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitDialog}>
            <label className="block text-sm font-medium" htmlFor="notes-dialog-name">
              {dialog?.kind === 'rename'
                ? t('notes.newName')
                : dialog?.kind === 'createFolder'
                  ? t('notes.folderName')
                  : t('notes.noteName')}
            </label>
            <Input
              id="notes-dialog-name"
              className="mt-2"
              value={nameValue}
              onChange={(event) => setNameValue(event.target.value)}
              autoFocus
              spellCheck={false}
            />
            {nameInvalid ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {t('notes.nameInvalid')}
              </p>
            ) : dialogMutation.isError ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {errorText(errorCodeOf(dialogMutation.error))}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialog}>
                {t('notes.cancel')}
              </Button>
              <Button type="submit" disabled={dialogMutation.isPending || !nameValue.trim()}>
                {dialogMutation.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                {dialog?.kind === 'rename' ? t('notes.rename') : t('notes.create')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
