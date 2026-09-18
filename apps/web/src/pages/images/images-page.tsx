import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileImage,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { HostedImage } from '@cove/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fileSize } from '@/features/files/api';
import { useAuth } from '@/features/auth/hooks';
import { imageBlob, imagesApi, uploadImage } from '@/features/images/api';
import { cn } from '@/lib/utils';

function ProtectedImage({ image, large = false }: { image: HostedImage; large?: boolean }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void imageBlob(large ? image.previewUrl : image.thumbnailUrl)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.id, image.previewUrl, image.thumbnailUrl, large]);
  if (failed)
    return (
      <div className="flex h-full min-h-40 items-center justify-center gap-2 bg-muted text-sm text-muted-foreground">
        <FileImage className="h-5 w-5" /> {t('images.previewUnavailable')}
      </div>
    );
  if (!url)
    return (
      <div className="flex h-full min-h-40 items-center justify-center bg-muted">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  return (
    <img
      src={url}
      alt={image.name}
      className={cn('h-full w-full object-contain', !large && 'bg-muted object-cover')}
    />
  );
}

type UploadRow = {
  file: File;
  progress: number;
  state: 'queued' | 'uploading' | 'complete' | 'failed';
  error?: string;
};

export function ImagesPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const cache = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const currentUploadRef = useRef<{ id: string; controller: AbortController }>();
  const cancelRequestedRef = useRef(false);
  const [filter, setFilter] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [sort, setSort] = useState('modified');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [publishUploads, setPublishUploads] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<HostedImage | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectionError, setSelectionError] = useState(false);

  const status = useQuery({
    queryKey: ['images', user?.id, 'status'],
    queryFn: imagesApi.status,
    retry: false,
  });
  const available =
    !!status.data?.enabled &&
    !!status.data.bound &&
    !['SMB_CONFIG_CHANGED'].includes(status.data.state);
  const listing = useInfiniteQuery({
    queryKey: ['images', filter, visibility, sort],
    queryFn: ({ pageParam }) =>
      imagesApi.list({
        limit: '48',
        filter,
        visibility,
        sort,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: available,
    retry: false,
  });
  const images = listing.data?.pages.flatMap((page) => page.images) ?? [];

  const visibilityMutation = useMutation({
    mutationFn: ({ image, value }: { image: HostedImage; value: boolean }) =>
      imagesApi.visibility(image.id, value),
    onSuccess: (value) => {
      setSelected(value);
      void cache.invalidateQueries({ queryKey: ['images'] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (image: HostedImage) => imagesApi.remove(image.id),
    onSuccess: () => {
      setSelected(null);
      void cache.invalidateQueries({ queryKey: ['images'] });
    },
  });

  const fullUrl = (path: string) => new URL(path, window.location.origin).toString();
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const addFiles = (files: FileList | File[]) => {
    const allowed = /\.(jpe?g|png|webp|gif|avif)$/i;
    const max = Number(status.data?.maxUploadBytes ?? 25 * 1024 * 1024);
    const selected = Array.from(files);
    const accepted = selected.filter(
      (file) => allowed.test(file.name) && file.size > 0 && file.size <= max,
    );
    setSelectionError(accepted.length !== selected.length);
    setUploads(accepted.map((file) => ({ file, progress: 0, state: 'queued' as const })));
  };

  const startUpload = async () => {
    cancelRequestedRef.current = false;
    setUploading(true);
    for (let index = 0; index < uploads.length; index++) {
      if (cancelRequestedRef.current) break;
      const row = uploads[index];
      if (!row || row.state === 'complete') continue;
      setUploads((current) =>
        current.map((entry, i) => (i === index ? { ...entry, state: 'uploading' } : entry)),
      );
      try {
        const operation = await imagesApi.createUpload(
          row.file.name,
          String(row.file.size),
          crypto.randomUUID(),
          publishUploads,
        );
        const controller = new AbortController();
        currentUploadRef.current = { id: operation.id, controller };
        await uploadImage(
          operation.id,
          row.file,
          (progress) =>
            setUploads((current) =>
              current.map((entry, i) => (i === index ? { ...entry, progress } : entry)),
            ),
          controller.signal,
        );
        setUploads((current) =>
          current.map((entry, i) => (i === index ? { ...entry, state: 'complete' } : entry)),
        );
      } catch (error) {
        setUploads((current) =>
          current.map((entry, i) =>
            i === index
              ? {
                  ...entry,
                  state: 'failed',
                  error: error instanceof Error ? error.message : 'TRANSFER_INTERRUPTED',
                }
              : entry,
          ),
        );
      } finally {
        currentUploadRef.current = undefined;
      }
    }
    setUploading(false);
    await cache.invalidateQueries({ queryKey: ['images'] });
  };

  const cancelUploads = () => {
    cancelRequestedRef.current = true;
    const current = currentUploadRef.current;
    current?.controller.abort();
    if (current) void imagesApi.cancelUpload(current.id).catch(() => undefined);
  };

  const errorText = (value?: string) =>
    value ? t(`files.errors.${value}`, { defaultValue: t('images.requestFailed') }) : null;
  const statusError =
    status.error?.message ??
    (!status.data?.enabled
      ? 'SMB_DISABLED'
      : !status.data.bound
        ? 'SMB_NOT_BOUND'
        : status.data.state);

  const synced = useMemo(
    () =>
      listing.data?.pages[0]?.syncedAt
        ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
            new Date(listing.data.pages[0].syncedAt),
          )
        : null,
    [i18n.language, listing.data?.pages],
  );

  if (status.isPending)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin" />
      </div>
    );
  if (!available)
    return (
      <section className="flex min-h-[calc(100dvh-8rem)] flex-col items-center justify-center gap-4 bg-card p-6 text-center">
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
      </section>
    );

  return (
    <section>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('images.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('images.description')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {listing.isFetching
              ? t('images.syncing')
              : synced
                ? t('images.synced', { time: synced })
                : 'Image Hosting/'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/files?path=Image%20Hosting">
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('images.openFiles')}
            </Link>
          </Button>
          {status.data?.capabilities.upload && (
            <Button
              onClick={() => {
                setUploads([]);
                setPublishUploads(false);
                setSelectionError(false);
                setUploadOpen(true);
              }}
            >
              <Upload className="mr-2 h-4 w-4" />
              {t('images.upload')}
            </Button>
          )}
        </div>
      </header>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('images.search')}
            aria-label={t('images.search')}
          />
        </div>
        <Select value={visibility} onValueChange={setVisibility}>
          <SelectTrigger className="lg:w-40" aria-label={t('common.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('images.all')}</SelectItem>
            <SelectItem value="private">{t('images.private')}</SelectItem>
            <SelectItem value="public">{t('images.public')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="lg:w-48" aria-label={t('images.modified')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="modified">{t('images.modified')}</SelectItem>
            <SelectItem value="name">{t('images.name')}</SelectItem>
            <SelectItem value="size">{t('images.size')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void listing.refetch()}
          aria-label={t('images.refresh')}
        >
          <RefreshCw className={cn('h-4 w-4', listing.isFetching && 'animate-spin')} />
        </Button>
      </div>

      {listing.isError ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive"
        >
          {errorText(listing.error.message)}
        </div>
      ) : listing.isPending ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="aspect-[4/3] animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : images.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed p-12 text-center">
          <FileImage className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">{t('images.empty')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('images.emptyHint')}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {images.map((image) => (
            <article
              key={image.id}
              className="overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
            >
              <button
                className="block aspect-[4/3] w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => setSelected(image)}
                aria-label={`${t('images.details')}: ${image.name}`}
              >
                <ProtectedImage image={image} />
              </button>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-medium" title={image.name}>
                      {image.name}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fileSize(image.sizeBytes)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium',
                      image.isPublic
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {image.isPublic ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    {image.isPublic ? t('images.public') : t('images.private')}
                  </span>
                </div>
                {image.publicUrl ? (
                  <div className="mt-3 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-2 text-xs">
                      {image.publicUrl}
                    </code>
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={t('images.copy')}
                      onClick={() => void copy(fullUrl(image.publicUrl!))}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  status.data?.capabilities.publish && (
                    <Button
                      className="mt-3 w-full"
                      variant="outline"
                      onClick={() => visibilityMutation.mutate({ image, value: true })}
                    >
                      {t('images.enableLink')}
                    </Button>
                  )
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {listing.hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            disabled={listing.isFetchingNextPage}
            onClick={() => void listing.fetchNextPage()}
          >
            {listing.isFetchingNextPage && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
            {t('images.loadMore')}
          </Button>
        </div>
      )}

      <Modal
        open={uploadOpen}
        title={t('images.uploadTitle')}
        description={t('images.uploadDescription')}
        onClose={() => !uploading && setUploadOpen(false)}
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          multiple
          onChange={(event) => event.target.files && addFiles(event.target.files)}
        />
        <button
          type="button"
          className="flex min-h-40 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            addFiles(event.dataTransfer.files);
          }}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <span className="mt-3 font-medium">{t('images.drop')}</span>
          <span className="mt-1 text-sm text-muted-foreground">{t('images.choose')}</span>
        </button>
        {selectionError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t('images.selectionInvalid')}
          </p>
        )}
        {status.data?.capabilities.publish && (
          <label className="mt-5 flex items-start gap-3 rounded-lg border p-4">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={publishUploads}
              onChange={(event) => setPublishUploads(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t('images.publishAfterUpload')}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t('images.publishAfterUploadHint')}
              </span>
            </span>
          </label>
        )}
        {uploads.length > 0 && (
          <div className="mt-5 space-y-2">
            {uploads.map((row) => (
              <div
                key={`${row.file.name}-${row.file.lastModified}`}
                className="rounded-lg border p-3"
              >
                <div className="flex justify-between gap-3 text-sm">
                  <span className="truncate">{row.file.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {row.state === 'complete'
                      ? t('images.complete')
                      : row.state === 'failed'
                        ? t('images.failed')
                        : fileSize(row.file.size)}
                  </span>
                </div>
                {row.error && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {errorText(row.error)}
                  </p>
                )}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full bg-primary transition-[width]',
                      row.state === 'failed' && 'bg-destructive',
                    )}
                    style={{
                      width:
                        row.state === 'complete'
                          ? '100%'
                          : `${Math.min(100, (row.progress / Math.max(1, row.file.size)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {uploading ? (
            <Button variant="outline" onClick={cancelUploads}>
              {t('images.cancelUpload')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              {t('images.close')}
            </Button>
          )}
          <Button
            disabled={
              uploads.length === 0 || uploading || uploads.every((row) => row.state === 'complete')
            }
            onClick={() => void startUpload()}
          >
            {uploading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
            {uploading ? t('images.uploading') : t('images.startUpload')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!selected}
        title={t('images.details')}
        onClose={() => setSelected(null)}
        className="sm:max-w-3xl"
      >
        {selected && (
          <div>
            <div className="aspect-video overflow-hidden rounded-lg bg-muted">
              <ProtectedImage image={selected} large />
            </div>
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <p className="font-medium">{selected.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {fileSize(selected.sizeBytes)} · {selected.mediaType ?? selected.state}
                </p>
              </div>
              {selected.publicUrl ? (
                <div>
                  <label className="text-sm font-medium">{t('images.publicLink')}</label>
                  <div className="mt-2 flex gap-2">
                    <Input readOnly value={fullUrl(selected.publicUrl)} />
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={t('images.copy')}
                      onClick={() => void copy(fullUrl(selected.publicUrl!))}
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t('images.publicHint')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        void copy(`![${selected.name}](${fullUrl(selected.publicUrl!)})`)
                      }
                    >
                      {t('images.copyMarkdown')}
                    </Button>
                    {status.data?.capabilities.publish && (
                      <Button
                        variant="outline"
                        disabled={visibilityMutation.isPending}
                        onClick={() => {
                          if (window.confirm(t('images.disableConfirm')))
                            visibilityMutation.mutate({ image: selected, value: false });
                        }}
                      >
                        {t('images.disableLink')}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                status.data?.capabilities.publish && (
                  <Button
                    variant="outline"
                    disabled={visibilityMutation.isPending}
                    onClick={() => visibilityMutation.mutate({ image: selected, value: true })}
                  >
                    {t('images.enableLink')}
                  </Button>
                )
              )}{' '}
              {status.data?.capabilities.delete && (
                <div className="border-t pt-5">
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (window.confirm(t('images.deleteConfirm', { name: selected.name })))
                        deleteMutation.mutate(selected);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('images.delete')}
                  </Button>
                </div>
              )}
              {(visibilityMutation.isError || deleteMutation.isError) && (
                <p role="alert" className="text-sm text-destructive">
                  {errorText((visibilityMutation.error ?? deleteMutation.error)?.message)}
                </p>
              )}
            </div>
            <span className="sr-only" aria-live="polite">
              {copied ? t('images.copied') : ''}
            </span>
          </div>
        )}
      </Modal>
    </section>
  );
}
