import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/features/auth/hooks';
import { resourcesApi } from '@/features/identity/api';
import { ResourceIcon } from '@/features/identity/components/permission-picker';
import type {
  PermissionSummary,
  ResourceItem,
  ResourceModuleCode,
} from '@/features/identity/types';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const resourcesKey = ['identity', 'resources'] as const;
const resourceModules = [
  {
    code: 'identity',
    labelKey: 'resources.modules.identity',
    descriptionKey: 'resources.moduleDescriptions.identity',
    icon: 'ShieldCheck',
  },
  {
    code: 'infrastructure',
    labelKey: 'resources.modules.infrastructure',
    descriptionKey: 'resources.moduleDescriptions.infrastructure',
    icon: 'Server',
  },
  {
    code: 'system',
    labelKey: 'resources.modules.system',
    descriptionKey: 'resources.moduleDescriptions.system',
    icon: 'Settings',
  },
] as const satisfies ReadonlyArray<{
  code: ResourceModuleCode;
  labelKey: string;
  descriptionKey: string;
  icon: string;
}>;
type ModuleFilter = 'all' | ResourceModuleCode;
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
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');
  const [search, setSearch] = useState('');
  const [resourceEditor, setResourceEditor] = useState<'create' | 'edit' | null>(null);
  const [actionEditor, setActionEditor] = useState<PermissionSummary | 'create' | null>(null);
  const resources = useQuery({ queryKey: resourcesKey, queryFn: resourcesApi.list });
  const can = (permission: string) =>
    Boolean(user?.isSuperAdmin || user?.permissions.includes(permission));
  const refresh = () => queryClient.invalidateQueries({ queryKey: resourcesKey });
  const sorted = useMemo(() => {
    const moduleOrder = new Map(resourceModules.map(({ code }, index) => [code, index]));
    return [...(resources.data ?? [])].sort(
      (a, b) =>
        (moduleOrder.get(a.module as ResourceModuleCode) ?? resourceModules.length) -
          (moduleOrder.get(b.module as ResourceModuleCode) ?? resourceModules.length) ||
        a.sortOrder - b.sortOrder ||
        a.code.localeCompare(b.code),
    );
  }, [resources.data]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleResources = useMemo(
    () =>
      sorted.filter(
        (resource) =>
          (moduleFilter === 'all' || resource.module === moduleFilter) &&
          (!normalizedSearch ||
            resource.name.toLocaleLowerCase().includes(normalizedSearch) ||
            resource.code.toLocaleLowerCase().includes(normalizedSearch)),
      ),
    [moduleFilter, normalizedSearch, sorted],
  );
  const selected =
    visibleResources.find(({ id }) => id === selectedId) ?? visibleResources[0] ?? null;
  const initialCreateModule: ResourceModuleCode =
    moduleFilter === 'all' ? 'identity' : moduleFilter;

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
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
            <div
              className="flex max-w-full gap-1 overflow-x-auto"
              aria-label={t('resources.moduleFilter')}
            >
              <ModuleFilterButton
                active={moduleFilter === 'all'}
                label={t('resources.modules.all')}
                count={sorted.length}
                onClick={() => setModuleFilter('all')}
              />
              {resourceModules.map((module) => (
                <ModuleFilterButton
                  key={module.code}
                  active={moduleFilter === module.code}
                  label={t(module.labelKey)}
                  count={sorted.filter(({ module: code }) => code === module.code).length}
                  onClick={() => setModuleFilter(module.code)}
                />
              ))}
            </div>
            <label className="relative block w-full lg:max-w-xs">
              <span className="sr-only">{t('resources.search')}</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                placeholder={t('resources.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]">
            <Card className="overflow-hidden">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-semibold">{t('resources.resourceList')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('resources.filteredCount', { count: visibleResources.length })}
                </p>
              </div>
              <div className="divide-y">
                {visibleResources.map((resource) => {
                  const moduleDefinition = resourceModules.find(
                    ({ code }) => code === resource.module,
                  );
                  return (
                    <button
                      type="button"
                      key={resource.id}
                      onClick={() => setSelectedId(resource.id)}
                      className={cn(
                        'flex min-h-20 w-full cursor-pointer items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        selected?.id === resource.id && 'bg-accent',
                      )}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <ResourceIcon icon={resource.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{resource.name}</span>
                          <Status active={resource.status === 'ACTIVE'} compact />
                        </span>
                        <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                          {resource.code}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {moduleDefinition ? t(moduleDefinition.labelKey) : resource.module}
                          {' · '}
                          {t('resources.actionsCount', { count: resource.actions.length })}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {visibleResources.length === 0 && (
                  <div className="p-6 text-center">
                    <p className="text-sm text-muted-foreground">{t('resources.emptyFiltered')}</p>
                    {can('identity.resource.create') && !normalizedSearch && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => setResourceEditor('create')}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {t('resources.create')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {selected ? (
              <Card className="overflow-hidden">
                <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <ResourceIcon icon={selected.icon} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{selected.name}</h2>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {selected.code}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                <div className="grid gap-px border-b bg-border sm:grid-cols-3">
                  <ResourceMeta
                    label={t('resources.module')}
                    value={
                      resourceModules.find(({ code }) => code === selected.module)
                        ? t(resourceModules.find(({ code }) => code === selected.module)!.labelKey)
                        : selected.module
                    }
                  />
                  <ResourceMeta
                    label={t('common.status')}
                    value={selected.status === 'ACTIVE' ? t('common.active') : t('common.disabled')}
                  />
                  <ResourceMeta
                    label={t('resources.sortOrder')}
                    value={String(selected.sortOrder)}
                  />
                </div>
                <section aria-labelledby="page-permission-heading" className="border-b p-5">
                  <p
                    id="page-permission-heading"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {t('resources.pagePermission')}
                  </p>
                  <p className="mt-2 font-mono text-sm">
                    {selected.pagePermission?.code ?? t('resources.missingPagePermission')}
                  </p>
                </section>
                <section aria-labelledby="action-permissions-heading">
                  <div className="border-b px-5 py-4">
                    <h3 id="action-permissions-heading" className="text-sm font-semibold">
                      {t('resources.actionPermissions')}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('resources.actionsCount', { count: selected.actions.length })}
                    </p>
                  </div>
                  <div className="divide-y">
                    {selected.actions.map((action) => (
                      <div
                        key={action.id}
                        className="flex items-center justify-between gap-4 px-5 py-4"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{action.name}</p>
                            <Status active={action.status === 'ACTIVE'} />
                          </div>
                          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                            {action.code}
                          </p>
                          {action.description && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {action.description}
                            </p>
                          )}
                        </div>
                        {can('identity.resource.update') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setActionEditor(action)}
                            aria-label={t('resources.editActionNamed', { name: action.name })}
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
                </section>
              </Card>
            ) : (
              <Card className="flex min-h-72 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {t('resources.selectResource')}
              </Card>
            )}
          </div>
        </div>
      )}

      <Modal
        open={resourceEditor !== null}
        title={resourceEditor === 'edit' ? t('resources.editTitle') : t('resources.createTitle')}
        description={resourceEditor === 'edit' ? selected?.code : t('resources.createHint')}
        onClose={() => setResourceEditor(null)}
      >
        <ResourceForm
          resource={resourceEditor === 'edit' ? (selected ?? undefined) : undefined}
          initialModule={initialCreateModule}
          onCancel={() => setResourceEditor(null)}
          onSubmit={async (input) => {
            if (resourceEditor === 'edit' && selected)
              await resourcesApi.update(selected.id, input);
            else
              await resourcesApi.create({
                module: input.module!,
                key: input.key!,
                name: input.name,
                description: input.description,
                icon: input.icon,
                sortOrder: input.sortOrder,
              });
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
  module?: ResourceModuleCode;
  key?: string;
  name: string;
  description?: string;
  icon?: string;
  sortOrder: number;
  status?: 'ACTIVE' | 'DISABLED';
};

function ResourceForm({
  resource,
  initialModule,
  onCancel,
  onSubmit,
  onDelete,
}: {
  resource?: ResourceItem;
  initialModule: ResourceModuleCode;
  onCancel: () => void;
  onSubmit: (input: ResourceInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [module, setModule] = useState<ResourceModuleCode>(initialModule);
  const [resourceKey, setResourceKey] = useState('');
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
        ...(resource ? {} : { module, key: resourceKey }),
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('resources.module')}
            hint={t(resourceModules.find(({ code }) => code === module)!.descriptionKey)}
          >
            <Select
              required
              value={module}
              onValueChange={(value) => setModule(value as ResourceModuleCode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {resourceModules.map((option) => (
                  <SelectItem key={option.code} value={option.code}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('resources.resourceKey')} hint={t('resources.resourceKeyHint')}>
            <Input
              required
              pattern="[a-z][a-z0-9_]{1,63}"
              value={resourceKey}
              onChange={(event) => setResourceKey(event.target.value)}
            />
          </Field>
          <div className="rounded-md border bg-muted/30 px-3 py-2 sm:col-span-2">
            <p className="text-xs text-muted-foreground">{t('resources.generatedCode')}</p>
            <p className="mt-1 break-all font-mono text-sm">
              {module}.{resourceKey || t('resources.resourceKeyPlaceholder')}
            </p>
          </div>
        </div>
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

function ModuleFilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 font-mono text-[10px]',
          active ? 'bg-primary-foreground/15' : 'bg-muted',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ResourceMeta({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="bg-card px-5 py-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
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
    <Select value={value} onValueChange={(next) => onChange(next as 'ACTIVE' | 'DISABLED')}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ACTIVE">{t('common.active')}</SelectItem>
        <SelectItem value="DISABLED">{t('common.disabled')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
function Status({ active, compact = false }: { active: boolean; compact?: boolean }): JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'rounded-full px-2 py-1 text-xs font-medium',
        compact && 'px-1.5 py-0.5 text-[10px]',
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
