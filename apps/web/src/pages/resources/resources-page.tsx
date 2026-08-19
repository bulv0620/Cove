import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LoaderCircle, Pencil, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/features/auth/hooks';
import { resourcesApi } from '@/features/identity/api';
import { ResourceIcon } from '@/features/identity/components/permission-picker';
import type { PermissionSummary, ResourceItem } from '@/features/identity/types';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const resourcesKey = ['identity', 'resources'] as const;
const resourceIconOptions = [
  { value: 'Users', labelKey: 'resources.iconUsers' },
  { value: 'ShieldCheck', labelKey: 'resources.iconSecurity' },
  { value: 'Layers', labelKey: 'resources.iconResources' },
  { value: 'Settings', labelKey: 'resources.iconSettings' },
  { value: 'Server', labelKey: 'resources.iconServer' },
  { value: 'Database', labelKey: 'resources.iconDatabase' },
  { value: 'HardDrive', labelKey: 'resources.iconStorage' },
  { value: 'Network', labelKey: 'resources.iconNetwork' },
  { value: 'Boxes', labelKey: 'resources.iconApps' },
  { value: 'FileStack', labelKey: 'resources.iconFiles' },
  { value: 'KeyRound', labelKey: 'resources.iconAccess' },
  { value: 'Activity', labelKey: 'resources.iconStatus' },
] as const;

export function ResourcesPage(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resourceEditor, setResourceEditor] = useState<'create' | 'edit' | null>(null);
  const [actionEditor, setActionEditor] = useState<PermissionSummary | 'create' | null>(null);
  const resources = useQuery({ queryKey: resourcesKey, queryFn: resourcesApi.list });
  const selected = resources.data?.find(({ id }) => id === selectedId) ?? null;
  const can = (permission: string) =>
    Boolean(user?.isSuperAdmin || user?.permissions.includes(permission));
  const refresh = () => queryClient.invalidateQueries({ queryKey: resourcesKey });
  const sorted = useMemo(
    () => [...(resources.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [resources.data],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-primary">
            {t('resources.eyebrow')}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('resources.title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t('resources.description')}
          </p>
        </div>
        {can('identity.resource.create') && (
          <Button onClick={() => setResourceEditor('create')}>
            <Plus className="mr-2 h-4 w-4" />
            {t('resources.create')}
          </Button>
        )}
      </header>

      {resources.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : resources.isError ? (
        <div className="p-6 text-center">
          <p className="text-sm text-destructive">{t('resources.loadError')}</p>
          <Button variant="outline" className="mt-4" onClick={() => void resources.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((resource) => (
            <button
              type="button"
              key={resource.id}
              onClick={() => setSelectedId(resource.id)}
              className={cn(
                'min-h-40 cursor-pointer rounded-lg border bg-card p-5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring',
                selectedId === resource.id && 'border-primary/50 bg-accent',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary">
                  <ResourceIcon icon={resource.icon} className="h-5 w-5" />
                </span>
                <Status active={resource.status === 'ACTIVE'} />
              </div>
              <h2 className="mt-4 font-semibold">{resource.name}</h2>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{resource.code}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {t('resources.actionsCount', { count: resource.actions.length })}
              </p>
            </button>
          ))}
          {sorted.length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t('resources.empty')}
            </div>
          )}
        </div>
      )}

      {selected && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <ResourceIcon icon={selected.icon} className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold">{selected.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">{selected.code}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {can('identity.resource.update') && (
                <Button variant="outline" onClick={() => setResourceEditor('edit')}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  {t('common.edit')}
                </Button>
              )}
              {can('identity.resource.create') && (
                <Button onClick={() => setActionEditor('create')}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('resources.addAction')}
                </Button>
              )}
            </div>
          </div>
          <div className="divide-y">
            {selected.actions.map((action) => (
              <div key={action.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{action.name}</p>
                    <Status active={action.status === 'ACTIVE'} />
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {action.code}
                  </p>
                  {action.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
                  )}
                </div>
                {can('identity.resource.update') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setActionEditor(action)}
                    aria-label={t('common.edit')}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {selected.actions.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {t('resources.noActions')}
              </p>
            )}
          </div>
        </Card>
      )}

      <Modal
        open={resourceEditor !== null}
        title={resourceEditor === 'edit' ? t('resources.editTitle') : t('resources.createTitle')}
        description={resourceEditor === 'edit' ? selected?.code : t('resources.createHint')}
        onClose={() => setResourceEditor(null)}
      >
        <ResourceForm
          resource={resourceEditor === 'edit' ? (selected ?? undefined) : undefined}
          onCancel={() => setResourceEditor(null)}
          onSubmit={async (input) => {
            if (resourceEditor === 'edit' && selected)
              await resourcesApi.update(selected.id, input);
            else await resourcesApi.create({ ...input, code: input.code! });
            setResourceEditor(null);
            await refresh();
          }}
          onDelete={
            resourceEditor === 'edit' && selected && can('identity.resource.delete')
              ? async () => {
                  if (!window.confirm(t('resources.deleteConfirm', { name: selected.name })))
                    return;
                  await resourcesApi.remove(selected.id);
                  setSelectedId(null);
                  setResourceEditor(null);
                  await refresh();
                }
              : undefined
          }
        />
      </Modal>

      <Modal
        open={actionEditor !== null && Boolean(selected)}
        title={actionEditor === 'create' ? t('resources.createAction') : t('resources.editAction')}
        description={selected?.name}
        onClose={() => setActionEditor(null)}
      >
        {selected && actionEditor && (
          <ActionForm
            action={actionEditor === 'create' ? undefined : actionEditor}
            onCancel={() => setActionEditor(null)}
            onSubmit={async (input) => {
              if (actionEditor === 'create') await resourcesApi.createAction(selected.id, input);
              else
                await resourcesApi.updateAction(selected.id, actionEditor.id, {
                  name: input.name,
                  description: input.description,
                  sortOrder: input.sortOrder,
                  status: input.status,
                });
              setActionEditor(null);
              await refresh();
            }}
            onDelete={
              actionEditor !== 'create' && can('identity.resource.delete')
                ? async () => {
                    if (
                      !window.confirm(
                        t('resources.deleteActionConfirm', { name: actionEditor.name }),
                      )
                    )
                      return;
                    await resourcesApi.removeAction(selected.id, actionEditor.id);
                    setActionEditor(null);
                    await refresh();
                  }
                : undefined
            }
          />
        )}
      </Modal>
    </div>
  );
}

type ResourceInput = {
  code?: string;
  name: string;
  description?: string;
  icon?: string;
  sortOrder: number;
  status?: 'ACTIVE' | 'DISABLED';
};

function ResourceForm({
  resource,
  onCancel,
  onSubmit,
  onDelete,
}: {
  resource?: ResourceItem;
  onCancel: () => void;
  onSubmit: (input: ResourceInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [code, setCode] = useState(resource?.code ?? 'identity.');
  const [name, setName] = useState(resource?.name ?? '');
  const [description, setDescription] = useState(resource?.description ?? '');
  const [icon, setIcon] = useState(resource?.icon ?? 'Layers');
  const [sortOrder, setSortOrder] = useState(resource?.sortOrder ?? 0);
  const [status, setStatus] = useState(resource?.status ?? 'ACTIVE');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        ...(resource ? {} : { code }),
        name,
        description: description || undefined,
        icon: icon || undefined,
        sortOrder,
        ...(resource ? { status } : {}),
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('common.requestFailed'));
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      {!resource && (
        <Field label={t('resources.code')} hint={t('resources.codeHint')}>
          <Input
            required
            pattern="identity\.[a-z][a-z0-9_]{1,54}"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
      )}
      <div className="grid gap-4">
        <Field label={t('resources.name')}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('resources.icon')}</legend>
        <p className="text-xs text-muted-foreground">{t('resources.iconHint')}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {resourceIconOptions.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border px-2 py-3 text-center text-xs transition-colors hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring',
                icon === option.value && 'border-primary bg-primary/10 text-primary',
              )}
            >
              <input
                type="radio"
                name="resource-icon"
                value={option.value}
                checked={icon === option.value}
                onChange={() => setIcon(option.value)}
                className="sr-only"
              />
              <ResourceIcon icon={option.value} className="h-5 w-5" />
              <span>{t(option.labelKey)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t('resources.descriptionLabel')}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('resources.sortOrder')}>
          <Input
            type="number"
            min={0}
            max={999}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </Field>
        {resource && (
          <Field label={t('common.status')}>
            <StatusSelect value={status} onChange={setStatus} />
          </Field>
        )}
      </div>
      {error && <ErrorNotice message={error} />}
      <FormActions
        pending={pending}
        editing={Boolean(resource)}
        onCancel={onCancel}
        onDelete={onDelete}
      />
    </form>
  );
}

type ActionInput = {
  action: string;
  name: string;
  description?: string;
  sortOrder: number;
  status?: 'ACTIVE' | 'DISABLED';
};

function ActionForm({
  action,
  onCancel,
  onSubmit,
  onDelete,
}: {
  action?: PermissionSummary;
  onCancel: () => void;
  onSubmit: (input: ActionInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [actionCode, setActionCode] = useState(action?.action ?? '');
  const [name, setName] = useState(action?.name ?? '');
  const [description, setDescription] = useState(action?.description ?? '');
  const [sortOrder, setSortOrder] = useState(action?.sortOrder ?? 0);
  const [status, setStatus] = useState(action?.status ?? 'ACTIVE');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        action: actionCode,
        name,
        description: description || undefined,
        sortOrder,
        ...(action ? { status } : {}),
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('common.requestFailed'));
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('resources.actionCode')} hint={t('resources.actionCodeHint')}>
          <Input
            required
            disabled={Boolean(action)}
            pattern="[a-z][a-z0-9_]{1,63}"
            value={actionCode}
            onChange={(e) => setActionCode(e.target.value)}
          />
        </Field>
        <Field label={t('resources.actionName')}>
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field label={t('resources.descriptionLabel')}>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('resources.sortOrder')}>
          <Input
            type="number"
            min={0}
            max={999}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </Field>
        {action && (
          <Field label={t('common.status')}>
            <StatusSelect value={status} onChange={setStatus} />
          </Field>
        )}
      </div>
      {error && <ErrorNotice message={error} />}
      <FormActions
        pending={pending}
        editing={Boolean(action)}
        onCancel={onCancel}
        onDelete={onDelete}
      />
    </form>
  );
}

function FormActions({
  pending,
  editing,
  onCancel,
  onDelete,
}: {
  pending: boolean;
  editing: boolean;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
      <div>
        {onDelete && (
          <Button
            type="button"
            variant="outline"
            className="text-destructive"
            disabled={pending}
            onClick={() => void onDelete()}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('common.delete')}
          </Button>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          {editing ? t('common.save') : t('common.create')}
        </Button>
      </div>
    </div>
  );
}
function StatusSelect({
  value,
  onChange,
}: {
  value: 'ACTIVE' | 'DISABLED';
  onChange: (value: 'ACTIVE' | 'DISABLED') => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <select
      className="h-11 w-full rounded-md border bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as 'ACTIVE' | 'DISABLED')}
    >
      <option value="ACTIVE">{t('common.active')}</option>
      <option value="DISABLED">{t('common.disabled')}</option>
    </select>
  );
}
function Status({ active }: { active: boolean }): JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'rounded-full px-2 py-1 text-xs font-medium',
        active
          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
          : 'bg-destructive/10 text-destructive',
      )}
    >
      {active ? t('common.active') : t('common.disabled')}
    </span>
  );
}
function ErrorNotice({ message }: { message: string }): JSX.Element {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
