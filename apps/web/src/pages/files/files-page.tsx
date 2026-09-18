import { readStored, writeStored } from '@/lib/storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileType2,
  Film,
  Folder,
  FolderOpen,
  FolderTree,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  Music2,
  Pencil,
  Presentation,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type { FileEntry } from '@cove/shared';
import { filesApi, fileApiBase, fileSize } from '@/features/files/api';
import { useTransfers } from '@/features/files/transfer-provider';
import { useAuth } from '@/features/auth/hooks';
import { usePageSessionActivity } from '@/app/page-session-activity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

type FileVisual = { Icon: LucideIcon; color: string };

const extensionGroups = {
  document: new Set(['txt', 'md', 'rtf', 'doc', 'docx', 'odt', 'pages', 'epub']),
  spreadsheet: new Set(['xls', 'xlsx', 'xlsm', 'csv', 'ods', 'numbers']),
  presentation: new Set(['ppt', 'pptx', 'pps', 'ppsx', 'odp', 'key']),
  image: new Set([
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
    'bmp',
    'svg',
    'ico',
    'tif',
    'tiff',
    'heic',
    'heif',
    'avif',
    'raw',
  ]),
  video: new Set([
    'mp4',
    'mkv',
    'mov',
    'avi',
    'webm',
    'm4v',
    'flv',
    'wmv',
    'mpg',
    'mpeg',
    'ts',
    'mts',
    'm2ts',
  ]),
  audio: new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'ape']),
  archive: new Set([
    'zip',
    'rar',
    '7z',
    'tar',
    'gz',
    'gzip',
    'bz2',
    'xz',
    'tgz',
    'tbz2',
    'zst',
    'iso',
    'dmg',
  ]),
  code: new Set([
    'js',
    'jsx',
    'ts',
    'tsx',
    'html',
    'htm',
    'css',
    'scss',
    'sass',
    'less',
    'vue',
    'svelte',
    'py',
    'java',
    'kt',
    'kts',
    'c',
    'h',
    'cpp',
    'cxx',
    'hpp',
    'cs',
    'go',
    'rs',
    'php',
    'rb',
    'swift',
    'sh',
    'bash',
    'zsh',
    'fish',
    'ps1',
    'sql',
    'json',
    'yaml',
    'yml',
    'toml',
    'xml',
    'ini',
    'conf',
    'env',
  ]),
};

function fileVisual(name: string): FileVisual {
  const normalized = name.toLowerCase();
  const extension = normalized.includes('.') ? (normalized.split('.').pop() ?? '') : '';
  if (extension === 'pdf') return { Icon: FileType2, color: 'text-red-500' };
  if (extensionGroups.document.has(extension))
    return { Icon: FileText, color: 'text-blue-600 dark:text-blue-400' };
  if (extensionGroups.spreadsheet.has(extension))
    return { Icon: FileSpreadsheet, color: 'text-emerald-600 dark:text-emerald-400' };
  if (extensionGroups.presentation.has(extension))
    return { Icon: Presentation, color: 'text-orange-600 dark:text-orange-400' };
  if (extensionGroups.image.has(extension))
    return { Icon: ImageIcon, color: 'text-fuchsia-600 dark:text-fuchsia-400' };
  if (extensionGroups.video.has(extension))
    return { Icon: Film, color: 'text-violet-600 dark:text-violet-400' };
  if (extensionGroups.audio.has(extension))
    return { Icon: Music2, color: 'text-pink-600 dark:text-pink-400' };
  if (extensionGroups.archive.has(extension))
    return { Icon: FileArchive, color: 'text-amber-600 dark:text-amber-400' };
  if (
    extensionGroups.code.has(extension) ||
    ['dockerfile', 'makefile', 'jenkinsfile'].includes(normalized)
  )
    return { Icon: FileCode2, color: 'text-cyan-700 dark:text-cyan-400' };
  return { Icon: File, color: 'text-muted-foreground' };
}

function TreeNode({
  path,
  name,
  current,
  onOpen,
  depth = 0,
}: {
  path: string;
  name: string;
  current: string;
  onOpen: (path: string) => void;
  depth?: number;
}): JSX.Element {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(path === '' || current.startsWith(path + '/'));
  const children = useInfiniteQuery({
    queryKey: ['files', user?.id, 'tree', path],
    queryFn: ({ pageParam }) =>
      filesApi.entries({ path, limit: '200', ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: expanded,
    staleTime: 30000,
    retry: false,
  });
  return (
    <div>
      <div
        className={cn('flex min-h-11 items-center rounded-md', current === path && 'bg-accent')}
        style={{ paddingLeft: Math.min(depth, 6) * 12 }}
      >
        <button
          className="flex h-11 w-8 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setExpanded(!expanded)}
          aria-label={`${expanded ? t('files.close') : t('files.open')} ${name}`}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 py-3 pr-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpen(path)}
          title={name}
        >
          <Folder className="h-4 w-4 shrink-0 text-sky-500" />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {expanded && (
        <div>
          {children.isPending ? (
            <p className="px-8 py-2 text-xs text-muted-foreground">{t('files.loading')}</p>
          ) : children.isError ? (
            <button
              className="px-8 py-2 text-xs text-destructive"
              onClick={() => void children.refetch()}
            >
              {t('files.retry')}
            </button>
          ) : (
            children.data?.pages
              .flatMap((page) => page.entries)
              .filter((entry) => entry.type === 'directory' && entry.supported)
              .map((entry) => (
                <TreeNode
                  key={entry.relativePath}
                  path={entry.relativePath}
                  name={entry.name}
                  current={current}
                  onOpen={onOpen}
                  depth={depth + 1}
                />
              ))
          )}
          {children.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              disabled={children.isFetchingNextPage}
              onClick={() => void children.fetchNextPage()}
            >
              {t('files.loadMore')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function FilesPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const path = params.get('path') ?? '';
  const cache = useQueryClient();
  const transfers = useTransfers();
  const sessionActive = usePageSessionActivity();
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [sort, setSort] = useState('name'),
    [direction, setDirection] = useState('asc'),
    [hidden, setHidden] = useState(false);
  const prefKey = `cove.files.view.${user?.id ?? ''}`;
  const [view, setView] = useState(() => (readStored(prefKey) === 'grid' ? 'grid' : 'list'));
  const [selection, setSelection] = useState<FileEntry | null>(null),
    [details, setDetails] = useState(false),
    [treeOpen, setTreeOpen] = useState(false),
    [queueOpen, setQueueOpen] = useState(false),
    [newFolder, setNewFolder] = useState(false),
    [folderName, setFolderName] = useState(''),
    [renameTarget, setRenameTarget] = useState<FileEntry | null>(null),
    [renameName, setRenameName] = useState(''),
    [deleteTargets, setDeleteTargets] = useState<FileEntry[]>([]),
    [deleteFailures, setDeleteFailures] = useState<Array<{ path: string; code: string }>>([]),
    [actionError, setActionError] = useState(''),
    [dragging, setDragging] = useState(false),
    [retryId, setRetryId] = useState<string | null>(null),
    [retryName, setRetryName] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const fileInput = useRef<HTMLInputElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0),
    [width, setWidth] = useState(700),
    [height, setHeight] = useState(520);
  const scrollPositions = useRef(new Map<string, number>());
  const selectionAnchor = useRef<string | null>(null);
  const previousPath = useRef(path);
  const scrollRef = useRef(scrollTop);
  scrollRef.current = scrollTop;
  const menuRef = useRef<HTMLDivElement>(null);
  const treePopoverRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const status = useQuery({
    queryKey: ['files', user?.id, 'status'],
    queryFn: filesApi.status,
    retry: false,
  });
  const available =
    !!status.data?.enabled &&
    !!status.data.bound &&
    !['SMB_CONFIG_CHANGED'].includes(status.data.state);
  const query = useInfiniteQuery({
    queryKey: ['files', user?.id, 'entries', path, filter, sort, direction, hidden],
    queryFn: ({ pageParam }) =>
      filesApi.entries({
        path,
        filter,
        sort,
        direction,
        showHidden: String(hidden),
        limit: '200',
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: available,
    retry: false,
  });
  const recent = useQuery({
    queryKey: ['files', user?.id, 'recent'],
    queryFn: filesApi.recent,
    enabled: queueOpen && sessionActive,
    retry: false,
    refetchInterval: queueOpen && sessionActive ? 3000 : false,
  });
  const entries = useMemo(
    () => query.data?.pages.flatMap((page) => page.entries) ?? [],
    [query.data],
  );
  useEffect(() => {
    const timer = setTimeout(() => setFilter(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    scrollPositions.current.set(previousPath.current, scrollRef.current);
    previousPath.current = path;
    setSelection(null);
    setSelectedPaths(new Set());
    selectionAnchor.current = null;
    setSearch('');
    setFilter('');
    setMenu(null);
    setRenameTarget(null);
    setDeleteTargets([]);
    setDeleteFailures([]);
    setActionError('');
    const restored = scrollPositions.current.get(path) ?? 0;
    setScrollTop(restored);
    if (viewport.current) viewport.current.scrollTop = restored;
  }, [path]); // Scroll is captured only on navigation.
  useEffect(() => {
    const currentPaths = new Set(entries.map((entry) => entry.relativePath));
    setSelectedPaths((current) => {
      const next = new Set([...current].filter((entryPath) => currentPaths.has(entryPath)));
      return next.size === current.size ? current : next;
    });
    setSelection((current) => (current && currentPaths.has(current.relativePath) ? current : null));
    if (selectionAnchor.current && !currentPaths.has(selectionAnchor.current)) {
      selectionAnchor.current = null;
    }
  }, [entries]);
  useEffect(() => {
    const element = viewport.current;
    if (!element || !sessionActive) return;
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
      setHeight(element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [available, sessionActive]);
  useEffect(() => {
    if (!menu || !sessionActive) return;
    menuRef.current?.focus();
    const dismiss = () => setMenu(null);
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [menu, sessionActive]);
  useEffect(() => {
    if (!treeOpen || !sessionActive) return;
    const dismiss = (event: PointerEvent) => {
      if (!treePopoverRef.current?.contains(event.target as Node)) setTreeOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTreeOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [treeOpen, sessionActive]);
  const open = (next: string) => {
    setParams(next ? { path: next } : {});
    setTreeOpen(false);
  };
  const refresh = async () => {
    setActionError('');
    await cache.invalidateQueries({ queryKey: ['files', user?.id] });
  };
  const create = useMutation({
    mutationFn: () => filesApi.mkdir(path, folderName),
    onSuccess: async () => {
      setNewFolder(false);
      setFolderName('');
      await refresh();
    },
  });
  const renameMutation = useMutation({
    mutationFn: () => filesApi.rename(renameTarget?.relativePath ?? '', renameName),
    onSuccess: async () => {
      setRenameTarget(null);
      clearSelection();
      await refresh();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => filesApi.remove(deleteTargets.map((entry) => entry.relativePath)),
    onSuccess: async (result) => {
      const failedPaths = new Set(result.failed.map((failure) => failure.path));
      setDeleteFailures(result.failed);
      setDeleteTargets((current) => current.filter((entry) => failedPaths.has(entry.relativePath)));
      setSelectedPaths(failedPaths);
      const nextSelection = entries.find((entry) => failedPaths.has(entry.relativePath)) ?? null;
      setSelection(nextSelection);
      selectionAnchor.current = nextSelection?.relativePath ?? null;
      if (!result.failed.length) setDeleteTargets([]);
      await refresh();
    },
  });
  const errorText = (value: string) => t(`files.errors.${value}`, { defaultValue: value });
  const download = async (target: FileEntry | null = selection) => {
    if (!target || target.type !== 'file') return;
    setActionError('');
    try {
      const ticket = await filesApi.ticket(target.relativePath);
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.src = fileApiBase + ticket.url;
      document.body.appendChild(frame);
      setTimeout(() => frame.remove(), 3600000);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'TRANSFER_INTERRUPTED');
    }
  };
  const addFiles = (files: File[]) => {
    if (!status.data?.capabilities.upload) {
      setActionError('FILES_FORBIDDEN');
      return;
    }
    if (
      files.length +
        transfers.items.filter((item) => !['succeeded', 'skipped', 'canceled'].includes(item.state))
          .length >
      100
    ) {
      setActionError('RATE_LIMITED');
      return;
    }
    transfers.add(files, path, Number(status.data.maxUploadBytes));
    setQueueOpen(true);
  };
  const chooseView = (next: string) => {
    setView(next);
    setScrollTop(0);
    if (viewport.current) viewport.current.scrollTop = 0;
    writeStored(prefKey, next);
  };
  const columns = view === 'grid' ? Math.max(1, Math.floor(width / 150)) : 1;
  const rowHeight = view === 'grid' ? 142 : 56;
  const totalRows = Math.ceil(entries.length / columns);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 3),
    lastRow = Math.min(totalRows, firstRow + Math.ceil(height / rowHeight) + 6);
  const visible = entries.slice(firstRow * columns, lastRow * columns);
  const total = query.data?.pages[0]?.total ?? 0;
  const activeCount = transfers.items.filter((item) =>
    ['queued', 'uploading', 'committing'].includes(item.state),
  ).length;
  const statusError =
    status.error?.message ??
    (!status.data?.enabled
      ? 'SMB_DISABLED'
      : !status.data.bound
        ? 'SMB_NOT_BOUND'
        : status.data.state);
  const selectOnly = (entry: FileEntry) => {
    setSelectedPaths(new Set([entry.relativePath]));
    setSelection(entry);
    selectionAnchor.current = entry.relativePath;
  };
  const clearSelection = () => {
    setSelectedPaths(new Set());
    setSelection(null);
    selectionAnchor.current = null;
  };
  const selectEntry = (entry: FileEntry, toggle: boolean, range: boolean) => {
    const anchorIndex = entries.findIndex(
      (candidate) => candidate.relativePath === selectionAnchor.current,
    );
    const entryIndex = entries.findIndex(
      (candidate) => candidate.relativePath === entry.relativePath,
    );
    if (range && anchorIndex >= 0 && entryIndex >= 0) {
      const next = toggle ? new Set(selectedPaths) : new Set<string>();
      const start = Math.min(anchorIndex, entryIndex);
      const end = Math.max(anchorIndex, entryIndex);
      for (const candidate of entries.slice(start, end + 1)) next.add(candidate.relativePath);
      setSelectedPaths(next);
      setSelection(entry);
      return;
    }
    if (toggle) {
      const next = new Set(selectedPaths);
      if (next.has(entry.relativePath)) next.delete(entry.relativePath);
      else next.add(entry.relativePath);
      setSelectedPaths(next);
      setSelection(
        next.has(entry.relativePath)
          ? entry
          : (entries.find((candidate) => next.has(candidate.relativePath)) ?? null),
      );
      selectionAnchor.current = entry.relativePath;
      return;
    }
    selectOnly(entry);
  };
  const selectedCount = selectedPaths.size;
  const selectedEntries = entries.filter((entry) => selectedPaths.has(entry.relativePath));
  const showRename = (target: FileEntry | null = selection) => {
    if (!target || selectedCount !== 1 || !target.supported) return;
    renameMutation.reset();
    setRenameTarget(target);
    setRenameName(target.name);
    setMenu(null);
  };
  const showDelete = () => {
    if (!selectedEntries.length || selectedEntries.some((entry) => !entry.supported)) return;
    deleteMutation.reset();
    setDeleteFailures([]);
    setDeleteTargets(selectedEntries);
    setMenu(null);
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {status.isPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          {t('files.loading')}
        </div>
      ) : !available ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-card p-6 text-center">
          <HardDrive className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">{errorText(statusError)}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t(status.data?.enabled ? 'files.contact' : 'files.configHint')}
          </p>
          <div className="flex gap-2">
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
      ) : (
        <section
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-card"
          onDragOver={(event) => {
            event.preventDefault();
            if (event.dataTransfer.types.includes('Files')) setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const items = Array.from(event.dataTransfer.items);
            if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
              setActionError('INVALID_INPUT');
              return;
            }
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 border-2 border-primary bg-background/95">
              <Upload className="h-10 w-10 text-primary" />
              <p className="text-lg font-medium">{t('files.drop')}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-2 sm:px-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('files.back')}
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('files.forward')}
              onClick={() => navigate(1)}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('files.up')}
              disabled={!path}
              onClick={() => open(path.split('/').slice(0, -1).join('/'))}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('files.refresh')}
              disabled={query.isFetching}
              onClick={() => void refresh()}
            >
              <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />
            </Button>
            <div ref={treePopoverRef} className="relative shrink-0">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('files.tree')}
                aria-haspopup="dialog"
                aria-expanded={treeOpen}
                aria-controls="files-folder-tree"
                title={t('files.tree')}
                className={treeOpen ? 'bg-accent' : ''}
                onClick={() => setTreeOpen((current) => !current)}
              >
                <FolderTree className="h-4 w-4" />
              </Button>
              {treeOpen && (
                <div
                  id="files-folder-tree"
                  role="dialog"
                  aria-label={t('files.tree')}
                  className="absolute left-1/2 top-full z-30 mt-2 w-[min(18rem,calc(100vw-1rem))] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
                >
                  <p className="border-b px-4 py-3 text-sm font-medium">{t('files.tree')}</p>
                  <div className="max-h-[min(22rem,52dvh)] overflow-y-auto p-2">
                    <TreeNode path="" name={t('files.home')} current={path} onOpen={open} />
                  </div>
                </div>
              )}
            </div>
            <nav
              aria-label={t('files.home')}
              className="order-3 flex w-full min-w-0 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm sm:order-none sm:w-auto sm:flex-1"
            >
              <button
                className="min-h-9 rounded px-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => open('')}
              >
                {t('files.home')}
              </button>
              {path
                .split('/')
                .filter(Boolean)
                .map((part, index) => (
                  <span key={index} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <button
                      className="min-h-9 max-w-48 truncate rounded px-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      title={part}
                      onClick={() =>
                        open(
                          path
                            .split('/')
                            .slice(0, index + 1)
                            .join('/'),
                        )
                      }
                    >
                      {part}
                    </button>
                  </span>
                ))}
            </nav>
            <label className="relative ml-auto min-w-0 flex-1 sm:max-w-64">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                aria-label={t('files.search')}
                placeholder={t('files.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <Button
              variant="outline"
              size="icon"
              className="relative shrink-0"
              onClick={() => setQueueOpen(true)}
              aria-label={`${t('files.showTransfers')}${activeCount > 0 ? ` (${activeCount})` : ''}`}
              title={t('files.showTransfers')}
            >
              <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
              {activeCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground"
                >
                  {activeCount > 9 ? '9+' : activeCount}
                </span>
              )}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <Button
              disabled={!status.data?.capabilities.upload}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {t('files.upload')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <Button
              variant="ghost"
              disabled={!status.data?.capabilities.mkdir}
              onClick={() => setNewFolder(true)}
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">{t('files.mkdir')}</span>
              <span className="sr-only sm:hidden">{t('files.mkdir')}</span>
            </Button>
            <Button
              variant="ghost"
              disabled={
                selectedCount !== 1 ||
                !selection?.supported ||
                selection.type !== 'file' ||
                !status.data?.capabilities.download
              }
              onClick={() => void download()}
            >
              <Download className="mr-2 h-4 w-4" />
              {t('files.download')}
            </Button>
            <Button
              variant="ghost"
              disabled={
                selectedCount !== 1 || !selection?.supported || !status.data?.capabilities.rename
              }
              onClick={() => showRename()}
            >
              <Pencil className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">{t('files.rename')}</span>
              <span className="sr-only sm:hidden">{t('files.rename')}</span>
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={
                selectedCount === 0 ||
                selectedEntries.some((entry) => !entry.supported) ||
                !status.data?.capabilities.delete
              }
              onClick={showDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">{t('files.delete')}</span>
              <span className="sr-only sm:hidden">{t('files.delete')}</span>
            </Button>
            <div className="ml-auto flex items-center">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('files.list')}
                aria-pressed={view === 'list'}
                className={view === 'list' ? 'bg-accent' : ''}
                onClick={() => chooseView('list')}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('files.grid')}
                aria-pressed={view === 'grid'}
                className={view === 'grid' ? 'bg-accent' : ''}
                onClick={() => chooseView('grid')}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {(actionError || query.isError) && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 border-b bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <span className="flex-1">
                {errorText(actionError || query.error?.message || 'SMB_UNAVAILABLE')}
                {query.data && ` ${t('files.stale')}`}
              </span>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                {t('files.retry')}
              </Button>
            </div>
          )}
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={(event) => setHidden(event.target.checked)}
                  />
                  {t('files.hidden')}
                </label>
                <select
                  className="ml-auto min-h-8 rounded border bg-background px-2 text-foreground"
                  aria-label={t('files.type')}
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="name">{t('files.name')}</option>
                  <option value="modifiedAt">{t('files.modified')}</option>
                  <option value="sizeBytes">{t('files.size')}</option>
                  <option value="type">{t('files.type')}</option>
                </select>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t('files.sortDirection')}
                  onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
                >
                  <ArrowDown className={cn('h-3.5 w-3.5', direction === 'asc' && 'rotate-180')} />
                </button>
              </div>
              {view === 'list' && (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_90px] border-b px-4 py-2 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_140px_90px]"
                  role="row"
                >
                  <span>{t('files.name')}</span>
                  <span className="hidden sm:block">{t('files.modified')}</span>
                  <span className="text-right">{t('files.size')}</span>
                </div>
              )}
              <div
                ref={viewport}
                className="relative min-h-0 flex-1 overflow-auto"
                role="listbox"
                aria-label={t('files.browser')}
                aria-multiselectable="true"
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              >
                {query.isPending ? (
                  <div className="space-y-3 p-4" aria-label={t('files.loading')}>
                    {Array.from({ length: 7 }, (_, i) => (
                      <div
                        key={i}
                        className="h-10 animate-pulse rounded bg-muted motion-reduce:animate-none"
                      />
                    ))}
                  </div>
                ) : entries.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <Folder className="h-12 w-12 text-muted-foreground/40" />
                    <p className="font-medium">
                      {t(
                        filter
                          ? 'files.noResults'
                          : query.isError
                            ? 'files.connection'
                            : 'files.empty',
                      )}
                    </p>
                    <p className="max-w-xs text-sm text-muted-foreground">
                      {filter ? (
                        <button className="underline" onClick={() => setSearch('')}>
                          {t('files.clear')}
                        </button>
                      ) : query.isError ? (
                        errorText(query.error.message)
                      ) : (
                        t('files.emptyHint')
                      )}
                    </p>
                  </div>
                ) : (
                  <div
                    style={{ height: totalRows * rowHeight, position: 'relative' }}
                    onClick={clearSelection}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: firstRow * rowHeight,
                        left: 0,
                        right: 0,
                        display: 'grid',
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                      }}
                    >
                      {visible.map((entry, index) => {
                        const selected = selectedPaths.has(entry.relativePath);
                        const visual =
                          entry.type === 'directory'
                            ? { Icon: Folder, color: 'text-sky-500' }
                            : fileVisual(entry.name);
                        const Icon = visual.Icon;
                        return (
                          <div
                            key={entry.relativePath}
                            data-file-index={firstRow * columns + index}
                            style={{ height: rowHeight }}
                            title={entry.name}
                            role="option"
                            aria-selected={selected}
                            tabIndex={0}
                            className={cn(
                              'relative min-w-0 cursor-default select-none border-b border-border/50 px-4 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                              view === 'grid'
                                ? 'flex flex-col items-center justify-center gap-2 border-r p-3'
                                : 'grid grid-cols-[minmax(0,1fr)_90px] items-center sm:grid-cols-[minmax(0,1fr)_140px_90px]',
                              selected && 'bg-accent text-accent-foreground',
                              !entry.supported && 'opacity-60',
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectEntry(entry, event.metaKey || event.ctrlKey, event.shiftKey);
                            }}
                            onDoubleClick={() => {
                              selectOnly(entry);
                              if (entry.supported && entry.type === 'directory')
                                open(entry.relativePath);
                              else setDetails(true);
                            }}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (
                                (event.metaKey || event.ctrlKey) &&
                                event.key.toLocaleLowerCase() === 'a'
                              ) {
                                event.preventDefault();
                                setSelectedPaths(
                                  new Set(entries.map((candidate) => candidate.relativePath)),
                                );
                                setSelection(entry);
                                selectionAnchor.current = entry.relativePath;
                              }
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                selectOnly(entry);
                                if (entry.supported && entry.type === 'directory')
                                  open(entry.relativePath);
                                else setDetails(true);
                              }
                              if (event.key === 'Escape') {
                                clearSelection();
                                setMenu(null);
                              }
                              if (event.key === 'F2') {
                                event.preventDefault();
                                if (status.data?.capabilities.rename) showRename();
                              }
                              if (event.key === 'Delete') {
                                event.preventDefault();
                                if (status.data?.capabilities.delete) showDelete();
                              }
                              if (
                                ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(
                                  event.key,
                                )
                              ) {
                                event.preventDefault();
                                const delta =
                                  event.key === 'ArrowDown'
                                    ? columns
                                    : event.key === 'ArrowUp'
                                      ? -columns
                                      : event.key === 'ArrowRight'
                                        ? 1
                                        : -1;
                                const next = Math.max(
                                  0,
                                  Math.min(entries.length - 1, firstRow * columns + index + delta),
                                );
                                const nextEntry = entries[next];
                                if (nextEntry) {
                                  if (event.shiftKey)
                                    selectEntry(nextEntry, event.metaKey || event.ctrlKey, true);
                                  else selectOnly(nextEntry);
                                }
                                const top = Math.floor(next / columns) * rowHeight;
                                if (
                                  viewport.current &&
                                  (top < scrollTop ||
                                    top + rowHeight > scrollTop + viewport.current.clientHeight)
                                )
                                  viewport.current.scrollTop = top;
                                requestAnimationFrame(() =>
                                  viewport.current
                                    ?.querySelector<HTMLElement>(`[data-file-index="${next}"]`)
                                    ?.focus(),
                                );
                              }
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              if (selected) setSelection(entry);
                              else selectOnly(entry);
                              setMenu({
                                x: Math.min(event.clientX, window.innerWidth - 190),
                                y: Math.min(event.clientY, window.innerHeight - 260),
                              });
                            }}
                          >
                            <span
                              className={cn(
                                'flex min-w-0 items-center gap-3',
                                view === 'grid' && 'w-full flex-col',
                              )}
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  'shrink-0',
                                  view === 'grid' && 'absolute left-1 top-1 z-[1]',
                                )}
                                aria-label={t(
                                  selected ? 'files.deselectItem' : 'files.selectItem',
                                  { name: entry.name },
                                )}
                                aria-pressed={selected}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectEntry(entry, !event.shiftKey, event.shiftKey);
                                }}
                                onDoubleClick={(event) => event.stopPropagation()}
                              >
                                <span
                                  className={cn(
                                    'flex h-4 w-4 items-center justify-center rounded-sm border bg-background',
                                    selected && 'border-primary bg-primary text-primary-foreground',
                                  )}
                                >
                                  {selected && <Check className="h-3 w-3" aria-hidden="true" />}
                                </span>
                              </Button>
                              <Icon
                                className={cn(
                                  'shrink-0',
                                  view === 'grid' ? 'h-10 w-10' : 'h-5 w-5',
                                  visual.color,
                                )}
                              />
                              <span
                                className={cn('min-w-0', view === 'grid' && 'w-full text-center')}
                              >
                                <span className="block truncate text-sm">{entry.name}</span>
                                {!entry.supported && (
                                  <span className="block truncate text-xs text-destructive">
                                    {t('files.unsupported')}
                                  </span>
                                )}
                                {view === 'list' && (
                                  <span className="text-xs text-muted-foreground sm:hidden">
                                    {t(`files.${entry.type}`)}
                                  </span>
                                )}
                              </span>
                            </span>
                            {view === 'list' && (
                              <span className="hidden text-xs text-muted-foreground sm:block">
                                {new Date(entry.modifiedAt).toLocaleDateString(i18n.language)}
                              </span>
                            )}
                            <span
                              className={cn(
                                'text-xs tabular-nums text-muted-foreground',
                                view === 'list' && 'text-right',
                              )}
                            >
                              {entry.type === 'directory'
                                ? view === 'grid'
                                  ? t('files.directory')
                                  : '—'
                                : fileSize(entry.sizeBytes)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              {query.hasNextPage && (
                <div className="border-t px-3 py-2 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={query.isFetchingNextPage}
                    onClick={() => void query.fetchNextPage()}
                  >
                    {query.isFetchingNextPage ? t('files.loading') : t('files.loadMore')} (
                    {entries.length}/{total})
                  </Button>
                </div>
              )}
            </div>
          </div>
          <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-muted/15 px-4 py-2 text-xs text-muted-foreground">
            <span>{t('files.items', { count: total })}</span>
            {selectedCount > 0 && (
              <>
                <span>· {t('files.selected', { count: selectedCount })}</span>
                {selectedCount === 1 && selection && (
                  <>
                    <button className="min-h-8 underline" onClick={() => setDetails(true)}>
                      {t('files.details')}
                    </button>
                    {selection.type === 'directory' && selection.supported && (
                      <button
                        className="min-h-8 underline"
                        onClick={() => open(selection.relativePath)}
                      >
                        {t('files.open')}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {query.isSuccess ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  {t('files.checked')}
                </>
              ) : (
                t('files.pending')
              )}
            </span>
          </footer>
        </section>
      )}
      {menu && (
        <div
          ref={menuRef}
          tabIndex={-1}
          role="menu"
          className="fixed z-40 w-44 rounded-lg border bg-popover p-1 shadow-xl outline-none"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenu(null);
          }}
        >
          {selection?.type === 'directory' && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              disabled={!selection.supported}
              onClick={() => open(selection.relativePath)}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('files.open')}
            </Button>
          )}
          {selection?.type === 'file' && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              disabled={!selection.supported || !status.data?.capabilities.download}
              onClick={() => void download()}
            >
              <Download className="mr-2 h-4 w-4" />
              {t('files.download')}
            </Button>
          )}
          <Button variant="ghost" className="w-full justify-start" onClick={() => setDetails(true)}>
            <Info className="mr-2 h-4 w-4" />
            {t('files.details')}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={
              selectedCount !== 1 || !selection?.supported || !status.data?.capabilities.rename
            }
            onClick={() => showRename()}
          >
            <Pencil className="mr-2 h-4 w-4" />
            {t('files.rename')}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive"
            disabled={
              selectedCount === 0 ||
              selectedEntries.some((entry) => !entry.supported) ||
              !status.data?.capabilities.delete
            }
            onClick={showDelete}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('files.delete')}
          </Button>
        </div>
      )}
      <Modal
        open={queueOpen}
        title={t('files.transfer')}
        onClose={() => setQueueOpen(false)}
        className="sm:max-w-2xl"
      >
        <div className="space-y-4">
          <p className="text-xs leading-5 text-muted-foreground">
            {t('files.uploadHint')}
            {status.data && ` ${t('files.limit', { size: fileSize(status.data.maxUploadBytes) })}`}
          </p>
          <div className="max-h-[min(58dvh,32rem)] overflow-y-auto rounded-lg border">
            {transfers.items.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">{t('files.noTransfers')}</p>
            )}
            {transfers.items.map((item) => (
              <div key={item.id} className="space-y-2 border-t px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={item.name}>
                    {item.name}
                  </span>
                  <span className="text-xs">{t(`files.${item.state}`)}</span>
                  {['queued', 'uploading', 'committing'].includes(item.state) ? (
                    <Button variant="ghost" size="sm" onClick={() => transfers.cancel(item.id)}>
                      {t('files.cancel')}
                    </Button>
                  ) : (
                    ['failed', 'canceled'].includes(item.state) && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRetryId(item.id);
                            setRetryName(item.name);
                          }}
                        >
                          {t('files.retry')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => transfers.skip(item.id)}>
                          {t('files.skip')}
                        </Button>
                      </>
                    )
                  )}
                </div>
                <div
                  className="h-1 overflow-hidden rounded bg-muted"
                  role="progressbar"
                  aria-label={item.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    item.file.size
                      ? Math.round((item.bytes / item.file.size) * 100)
                      : item.state === 'succeeded'
                        ? 100
                        : 0
                  }
                >
                  <div
                    className="h-full bg-primary transition-all motion-reduce:transition-none"
                    style={{
                      width: `${item.file.size ? (item.bytes / item.file.size) * 100 : item.state === 'succeeded' ? 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {t('files.destination')}: {t('files.home')}
                  {item.parentPath && ` / ${item.parentPath}`} · {fileSize(item.bytes)} /{' '}
                  {fileSize(item.file.size)}
                </p>
                {item.error && (
                  <p role="status" className="text-xs text-destructive">
                    {errorText(item.error)}
                  </p>
                )}
              </div>
            ))}
          </div>
          {recent.data &&
            recent.data.filter(
              (row) => !transfers.items.some((item) => item.operationId === row.id),
            ).length > 0 && (
              <details className="border-t p-4">
                <summary className="cursor-pointer text-sm">{t('files.recent')}</summary>
                <div className="mt-3 max-h-48 space-y-2 overflow-auto">
                  {recent.data
                    .filter((row) => !transfers.items.some((item) => item.operationId === row.id))
                    .map((row) => (
                      <div key={row.id} className="flex min-w-0 gap-3 text-xs">
                        <span className="flex-1 truncate" title={row.relativePath}>
                          {row.relativePath}
                        </span>
                        <span>
                          {t(
                            `files.${({ RUNNING: 'uploading', COMMITTING: 'committing', QUEUED: 'queued' } as Record<string, string>)[row.state] ?? row.state.toLowerCase()}`,
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              </details>
            )}
        </div>
      </Modal>
      <Modal
        open={!!renameTarget}
        title={t('files.renameTitle')}
        description={t('files.renameDescription')}
        onClose={() => {
          if (!renameMutation.isPending) setRenameTarget(null);
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            renameMutation.mutate();
          }}
        >
          <label className="block space-y-2 text-sm">
            <span>{t('files.newName')}</span>
            <Input
              autoFocus
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              required
              maxLength={255}
            />
          </label>
          {renameMutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(renameMutation.error.message)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={renameMutation.isPending}
              onClick={() => setRenameTarget(null)}
            >
              {t('files.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                renameMutation.isPending || !renameName.trim() || renameName === renameTarget?.name
              }
            >
              {renameMutation.isPending ? t('files.renaming') : t('files.rename')}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={deleteTargets.length > 0}
        title={t('files.deleteTitle')}
        description={t('files.deleteDescription', { count: deleteTargets.length })}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setDeleteTargets([]);
            setDeleteFailures([]);
          }
        }}
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>{t('files.deleteWarning')}</p>
          </div>
          <ul className="max-h-40 overflow-y-auto rounded-md border text-sm">
            {deleteTargets.map((entry) => (
              <li key={entry.relativePath} className="truncate border-b px-3 py-2 last:border-b-0">
                {entry.name}
              </li>
            ))}
          </ul>
          {deleteFailures.length > 0 && (
            <div role="alert" className="space-y-1 text-sm text-destructive">
              <p>{t('files.deletePartial', { count: deleteFailures.length })}</p>
              {deleteFailures.map((failure) => (
                <p key={failure.path} className="truncate" title={failure.path}>
                  {failure.path.split('/').at(-1)}: {errorText(failure.code)}
                </p>
              ))}
            </div>
          )}
          {deleteMutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(deleteMutation.error.message)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={deleteMutation.isPending}
              onClick={() => {
                setDeleteTargets([]);
                setDeleteFailures([]);
              }}
            >
              {t('files.cancel')}
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleteMutation.isPending ? t('files.deleting') : t('files.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={newFolder} title={t('files.mkdir')} onClose={() => setNewFolder(false)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className="block space-y-2 text-sm">
            <span>{t('files.folderName')}</span>
            <Input
              autoFocus
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              required
              maxLength={255}
            />
          </label>
          {create.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorText(create.error.message)}
            </p>
          )}
          <Button disabled={create.isPending || !folderName} type="submit">
            {t('files.create')}
          </Button>
        </form>
      </Modal>
      <Modal
        open={details && !!selection}
        title={selection?.name ?? t('files.details')}
        onClose={() => setDetails(false)}
      >
        {selection && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-4 break-words text-sm">
            <dt className="text-muted-foreground">{t('files.type')}</dt>
            <dd>{t(`files.${selection.type}`)}</dd>
            <dt className="text-muted-foreground">{t('files.size')}</dt>
            <dd>{selection.type === 'directory' ? '—' : fileSize(selection.sizeBytes)}</dd>
            <dt className="text-muted-foreground">{t('files.modified')}</dt>
            <dd>{new Date(selection.modifiedAt).toLocaleString(i18n.language)}</dd>
            <dt className="text-muted-foreground">{t('files.destination')}</dt>
            <dd>
              {t('files.home')} / {selection.relativePath}
            </dd>
          </dl>
        )}
      </Modal>
      <Modal
        open={!!retryId}
        title={t('files.retry')}
        description={t('files.renameHint')}
        onClose={() => setRetryId(null)}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (retryId) transfers.retry(retryId, retryName);
            setRetryId(null);
          }}
        >
          <label className="block space-y-2 text-sm">
            <span>{t('files.name')}</span>
            <Input
              value={retryName}
              onChange={(event) => setRetryName(event.target.value)}
              required
              maxLength={255}
            />
          </label>
          <Button type="submit" disabled={!retryName}>
            {t('files.retry')}
          </Button>
        </form>
      </Modal>
      <p role="status" aria-live="polite" className="sr-only">
        {activeCount > 0 ? `${t('files.transfer')}: ${activeCount}` : t('files.succeeded')}
      </p>
    </div>
  );
}
