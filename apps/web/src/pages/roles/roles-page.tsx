import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/features/auth/hooks';
import { rolesApi } from '@/features/identity/api';
import { PermissionPicker } from '@/features/identity/components/permission-picker';
import type { ManagedRole, PermissionItem } from '@/features/identity/types';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const rolesKey = ['identity', 'roles'] as const;
const permissionsKey = ['identity', 'permissions'] as const;

export function RolesPage(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const roles = useQuery({ queryKey: rolesKey, queryFn: rolesApi.list });
  const permissions = useQuery({ queryKey: permissionsKey, queryFn: rolesApi.permissions });
  const can = (permission: string): boolean =>
    Boolean(user?.isSuperAdmin || user?.permissions.includes(permission));
  const filtered = useMemo(() => {
    const value = search.toLowerCase().trim();
    return value
      ? (roles.data ?? []).filter((role) =>
          `${role.name} ${role.code} ${role.description ?? ''}`.toLowerCase().includes(value),
        )
      : (roles.data ?? []);
  }, [roles.data, search]);
  const selected = roles.data?.find(({ id }) => id === selectedId) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: rolesKey });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-primary">
            {t('roles.eyebrow')}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('roles.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('roles.description')}</p>
        </div>
        {can('identity.role.create') && can('identity.role.grant') && (
          <Button onClick={() => setShowCreate((value) => !value)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('roles.create')}
          </Button>
        )}
      </header>
      {showCreate && permissions.data && (
        <Modal
          open
          title={t('roles.createTitle')}
          onClose={() => setShowCreate(false)}
          className="sm:max-w-4xl"
        >
          <RoleForm
            permissions={permissions.data}
            onCancel={() => setShowCreate(false)}
            onSubmit={async (input) => {
              await rolesApi.create(input);
              setShowCreate(false);
              await refresh();
            }}
          />
        </Modal>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('roles.search')}
              aria-label={t('roles.search')}
              className="pl-9"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('roles.count', { count: filtered.length })}
          </p>
        </div>
        {roles.isPending ? (
          <div className="flex min-h-48 items-center justify-center">
            <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : roles.isError ? (
          <div className="p-6 text-center">
            <p className="text-sm text-destructive">{t('roles.loadError')}</p>
            <Button variant="outline" className="mt-4" onClick={() => void roles.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((role) => (
              <button
                type="button"
                key={role.id}
                onClick={() => setSelectedId(selectedId === role.id ? null : role.id)}
                className={cn(
                  'min-h-44 cursor-pointer bg-card p-5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  selectedId === role.id && 'bg-accent',
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    {role.isSystem ? (
                      <ShieldCheck className="h-5 w-5" />
                    ) : (
                      <Shield className="h-5 w-5" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-1 text-xs font-medium',
                      role.status === 'ACTIVE'
                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : 'bg-destructive/10 text-destructive',
                    )}
                  >
                    {role.status === 'ACTIVE' ? t('common.active') : t('common.disabled')}
                  </span>
                </div>
                <h2 className="mt-4 font-semibold">{role.name}</h2>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{role.code}</p>
                <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{t('roles.usersCount', { count: role.userCount })}</span>
                  <span>{t('roles.permissionsCount', { count: role.permissions.length })}</span>
                  {role.isSystem && (
                    <span className="ml-auto inline-flex items-center gap-1">
                      <LockKeyhole className="h-3 w-3" />
                      {t('roles.system')}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
      {selected && permissions.data && (
        <Modal
          open
          title={selected.name}
          description={selected.code}
          onClose={() => setSelectedId(null)}
          className="sm:max-w-4xl"
        >
          <RoleDetails
            key={selected.id}
            role={selected}
            permissions={permissions.data}
            editable={
              !selected.isSystem && can('identity.role.update') && can('identity.role.grant')
            }
            canDelete={can('identity.role.delete')}
            onClose={() => setSelectedId(null)}
            onChanged={refresh}
          />
        </Modal>
      )}
    </div>
  );
}

function RoleDetails({
  role,
  permissions,
  editable,
  canDelete,
  onClose,
  onChanged,
}: {
  role: ManagedRole;
  permissions: PermissionItem[];
  editable: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}): JSX.Element {
  const { t } = useTranslation();
  if (role.isSystem)
    return (
      <div>
        <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2 font-medium text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t('roles.dynamicAdministrator')}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('roles.dynamicAdministratorHint')}
          </p>
        </div>
        {role.description && (
          <p className="mt-4 text-sm text-muted-foreground">{role.description}</p>
        )}
        <div className="mt-5">
          <PermissionPicker
            permissions={permissions}
            selected={role.permissions.map(({ id }) => id)}
            onChange={() => undefined}
            disabled
          />
        </div>
      </div>
    );
  return (
    <RoleForm
      role={role}
      permissions={permissions}
      disabled={!editable}
      onCancel={onClose}
      onSubmit={async (input) => {
        await rolesApi.update(role.id, {
          name: input.name,
          description: input.description,
          permissionIds: input.permissionIds,
        });
        await onChanged();
      }}
      onDelete={
        canDelete
          ? async () => {
              if (!window.confirm(t('roles.deleteConfirm', { name: role.name }))) return;
              await rolesApi.remove(role.id);
              onClose();
              await onChanged();
            }
          : undefined
      }
    />
  );
}

function RoleForm({
  role,
  permissions,
  disabled = false,
  onCancel,
  onSubmit,
  onDelete,
}: {
  role?: ManagedRole;
  permissions: PermissionItem[];
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    code: string;
    name: string;
    description?: string;
    permissionIds: string[];
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [code, setCode] = useState(role?.code ?? '');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissionIds, setPermissionIds] = useState(role?.permissions.map(({ id }) => id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit({ code, name, description: description || undefined, permissionIds });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('common.requestFailed'));
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('roles.code')} hint={t('roles.codeHint')}>
          <Input
            required
            disabled={Boolean(role) || disabled}
            pattern="[a-z][a-z0-9_]{2,63}"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label={t('roles.name')}>
          <Input
            required
            disabled={disabled}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </div>
      <Field label={t('roles.descriptionLabel')}>
        <Input
          disabled={disabled}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field label={t('roles.permissions')} hint={t('roles.permissionsHint')}>
        <PermissionPicker
          permissions={permissions}
          selected={permissionIds}
          onChange={setPermissionIds}
          disabled={disabled}
        />
      </Field>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <div>
          {role && onDelete && (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={pending || role.userCount > 0}
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
          <Button type="submit" disabled={disabled || pending || !code || !name}>
            {pending ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            {role ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </form>
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
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
