import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserCog,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/features/auth/hooks';
import { SmbBindingPanel } from '@/features/files/smb-binding-panel';
import { rolesApi, usersApi } from '@/features/identity/api';
import type { ManagedUser } from '@/features/identity/types';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const usersKey = ['identity', 'users'] as const;
const rolesKey = ['identity', 'roles'] as const;

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

export function UsersPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [smbSelectedId, setSmbSelectedId] = useState<string | null>(null);
  const [temporaryCredential, setTemporaryCredential] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const users = useQuery({ queryKey: usersKey, queryFn: usersApi.list });
  const roles = useQuery({ queryKey: rolesKey, queryFn: rolesApi.list });
  const can = (permission: string): boolean =>
    Boolean(currentUser?.isSuperAdmin || currentUser?.permissions.includes(permission));
  const filteredUsers = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return users.data ?? [];
    return (users.data ?? []).filter((item) =>
      [item.username, item.displayName ?? '', ...item.roles.map((role) => role.name)]
        .join(' ')
        .toLowerCase()
        .includes(value),
    );
  }, [search, users.data]);
  const selected = users.data?.find(({ id }) => id === selectedId) ?? null;
  const smbSelected = users.data?.find(({ id }) => id === smbSelectedId) ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-primary">
            {t('users.eyebrow')}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('users.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('users.description')}</p>
        </div>
        {can('identity.user.create') && can('identity.user.assign_role') && (
          <Button onClick={() => setShowCreate((value) => !value)}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('users.create')}
          </Button>
        )}
      </header>

      {showCreate && roles.data && (
        <Modal
          open
          title={t('users.createTitle')}
          description={t('users.createHint')}
          onClose={() => setShowCreate(false)}
        >
          <CreateUserForm
            roles={roles.data.filter((role) => role.status === 'ACTIVE')}
            onCancel={() => setShowCreate(false)}
            onCreated={async ({ username, password }) => {
              setShowCreate(false);
              setTemporaryCredential({ username, password });
              await queryClient.invalidateQueries({ queryKey: usersKey });
            }}
          />
        </Modal>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('users.search')}
              className="pl-9"
              aria-label={t('users.search')}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('users.count', { count: filteredUsers.length })}
          </p>
        </div>
        {users.isPending ? (
          <div className="flex min-h-48 items-center justify-center">
            <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : users.isError ? (
          <div className="p-6 text-center">
            <p className="text-sm text-destructive">{t('users.loadError')}</p>
            <Button variant="outline" className="mt-4" onClick={() => void users.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('users.user')}</th>
                  <th className="px-4 py-3 font-medium">{t('users.roles')}</th>
                  <th className="px-4 py-3 font-medium">{t('users.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('files.bindTitle')}</th>
                  <th className="px-4 py-3 font-medium">{t('users.lastLogin')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredUsers.map((item) => (
                  <tr
                    key={item.id}
                    className={cn(
                      'transition-colors hover:bg-muted/40',
                      (selectedId === item.id || smbSelectedId === item.id) && 'bg-accent/60',
                    )}
                  >
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{item.displayName || item.username}</p>
                        {item.isSuperAdmin && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            {t('users.platformSuperAdmin')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {item.username}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {item.roles.length ? (
                          item.roles.map((role) => (
                            <span
                              key={role.id}
                              className="rounded-full border bg-background px-2 py-0.5 text-xs"
                            >
                              {role.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">{t('users.noRoles')}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge active={item.status === 'ACTIVE'} />
                    </td>
                    <td className="px-4 py-4 text-xs">
                      {t(item.smbBound ? 'files.bound' : 'files.unbound')}
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {item.lastLoginAt
                        ? new Intl.DateTimeFormat(i18n.language, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(item.lastLoginAt))
                        : t('users.never')}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSmbSelectedId(null);
                            setSelectedId(item.id);
                          }}
                        >
                          <UserCog className="mr-2 h-4 w-4" aria-hidden="true" />
                          {t('common.manage')}
                        </Button>
                        {can('identity.user.bind_smb') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedId(null);
                              setSmbSelectedId(item.id);
                            }}
                          >
                            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
                            {t('files.bindTitle')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && roles.data && (
        <Modal
          open
          title={t('users.manageTitle')}
          description={selected.username}
          onClose={() => setSelectedId(null)}
          className="sm:max-w-4xl"
        >
          <UserEditor
            key={selected.id}
            user={selected}
            roles={roles.data}
            currentUserId={currentUser?.id ?? ''}
            can={can}
            onChanged={() => queryClient.invalidateQueries({ queryKey: usersKey })}
            onDeleted={async () => {
              setSelectedId(null);
              await queryClient.invalidateQueries({ queryKey: usersKey });
            }}
            onPasswordReset={(password) => {
              setSelectedId(null);
              setTemporaryCredential({ username: selected.username, password });
            }}
          />
        </Modal>
      )}

      {smbSelected && can('identity.user.bind_smb') && (
        <Modal
          open
          title={t('files.bindTitle')}
          description={smbSelected.username}
          onClose={() => setSmbSelectedId(null)}
          className="sm:max-w-lg"
        >
          <SmbBindingPanel
            key={smbSelected.id}
            userId={smbSelected.id}
            onChanged={() => queryClient.invalidateQueries({ queryKey: usersKey })}
          />
        </Modal>
      )}

      {temporaryCredential && (
        <TemporaryPasswordDialog
          username={temporaryCredential.username}
          password={temporaryCredential.password}
          onClose={() => setTemporaryCredential(null)}
        />
      )}
    </div>
  );
}

function TemporaryPasswordDialog({
  username,
  password,
  onClose,
}: {
  username: string;
  password: string;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };
  const confirmClose = () => {
    if (!window.confirm(t('users.discardTemporaryPasswordConfirm'))) return;
    onClose();
  };

  return (
    <Modal
      open
      title={t('users.temporaryPasswordTitle')}
      description={t('users.temporaryPasswordDescription', { name: username })}
      onClose={confirmClose}
      className="sm:max-w-lg"
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium">{t('users.temporaryPasswordLabel')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="min-h-11 flex-1 select-all overflow-x-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-sm font-semibold tracking-wide">
              {password}
            </code>
            <Button type="button" variant="outline" onClick={() => void copyPassword()}>
              {copyState === 'copied' ? (
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {copyState === 'copied' ? t('users.passwordCopied') : t('users.copyPassword')}
            </Button>
          </div>
          {copyState === 'error' && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {t('users.passwordCopyFailed')}
            </p>
          )}
        </div>
        <div className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300"
            aria-hidden="true"
          />
          <p>{t('users.temporaryPasswordWarning')}</p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            {t('users.closeTemporaryPassword')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StatusBadge({ active }: { active: boolean }): JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium',
        active
          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
          : 'bg-destructive/10 text-destructive',
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-destructive')}
      />
      {active ? t('common.active') : t('common.disabled')}
    </span>
  );
}

interface RoleOption {
  id: string;
  name: string;
  code: string;
}

function RolePicker({
  roles,
  selected,
  onChange,
}: {
  roles: RoleOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}): JSX.Element {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map((role) => (
        <label
          key={role.id}
          className="flex min-h-14 cursor-pointer items-center gap-3 overflow-hidden rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
        >
          <input
            type="checkbox"
            checked={selected.includes(role.id)}
            onChange={() =>
              onChange(
                selected.includes(role.id)
                  ? selected.filter((id) => id !== role.id)
                  : [...selected, role.id],
              )
            }
            className="h-4 w-4 shrink-0 accent-primary"
          />
          <span className="min-w-0 flex-1 overflow-hidden">
            <span className="block truncate font-medium" title={role.name}>
              {role.name}
            </span>
            <span
              className="block truncate font-mono text-xs text-muted-foreground"
              title={role.code}
            >
              {role.code}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function CreateUserForm({
  roles,
  onCancel,
  onCreated,
}: {
  roles: RoleOption[];
  onCancel: () => void;
  onCreated: (credential: { username: string; password: string }) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: usersApi.create,
    onSuccess: ({ user, temporaryPassword }) =>
      onCreated({ username: user.username, password: temporaryPassword }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ username, displayName: displayName || undefined, roleIds });
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('users.username')}>
          <Input
            required
            minLength={3}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label={t('users.displayName')}>
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </Field>
      </div>
      <Field label={t('users.roles')}>
        <RolePicker roles={roles} selected={roleIds} onChange={setRoleIds} />
      </Field>
      {mutation.error && (
        <ErrorNotice
          message={
            mutation.error instanceof ApiError ? mutation.error.message : t('common.requestFailed')
          }
        />
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending || !username}>
          {mutation.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
          {t('common.create')}
        </Button>
      </div>
    </form>
  );
}

function UserEditor({
  user,
  roles,
  currentUserId,
  can,
  onChanged,
  onDeleted,
  onPasswordReset,
}: {
  user: ManagedUser;
  roles: RoleOption[];
  currentUserId: string;
  can: (permission: string) => boolean;
  onChanged: () => Promise<unknown>;
  onDeleted: () => Promise<void>;
  onPasswordReset: (password: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [roleIds, setRoleIds] = useState(user.roles.map(({ id }) => id));
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setDisplayName(user.displayName ?? '');
    setRoleIds(user.roles.map(({ id }) => id));
    setMessage(null);
  }, [user]);
  const save = useMutation({
    mutationFn: async () => {
      if (can('identity.user.update')) await usersApi.updateProfile(user.id, { displayName });
      const original = user.roles
        .map(({ id }) => id)
        .sort()
        .join(',');
      if (
        !user.isSuperAdmin &&
        can('identity.user.assign_role') &&
        [...roleIds].sort().join(',') !== original
      )
        await usersApi.assignRoles(user.id, { roleIds });
    },
    onSuccess: async () => {
      setMessage(t('common.saved'));
      await onChanged();
    },
  });
  const status = useMutation({
    mutationFn: () =>
      usersApi.changeStatus(user.id, { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }),
    onSuccess: onChanged,
  });
  const reset = useMutation({
    mutationFn: () => usersApi.resetPassword(user.id),
    onSuccess: ({ temporaryPassword }) => onPasswordReset(temporaryPassword),
  });
  const remove = useMutation({
    mutationFn: () => usersApi.remove(user.id),
    onSuccess: onDeleted,
  });
  const error = save.error ?? status.error ?? reset.error ?? remove.error;
  const availableRoles = roles;
  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label={t('users.displayName')}>
            <Input
              disabled={!can('identity.user.update')}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          {user.isSuperAdmin ? (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2 font-medium text-primary">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {t('users.platformSuperAdmin')}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('users.platformSuperAdminHint')}
              </p>
            </div>
          ) : (
            <Field label={t('users.roles')}>
              <RolePicker roles={availableRoles} selected={roleIds} onChange={setRoleIds} />
            </Field>
          )}
          <Button
            onClick={() => save.mutate()}
            disabled={
              save.isPending ||
              (!can('identity.user.update') &&
                (user.isSuperAdmin || !can('identity.user.assign_role')))
            }
          >
            <Check className="mr-2 h-4 w-4" />
            {t('common.save')}
          </Button>
        </div>
        <div className="space-y-5 border-t pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div>
            <h3 className="text-sm font-semibold">{t('users.accountStatus')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('users.statusHint')}</p>
            {can('identity.user.disable') && (
              <Button
                className="mt-3"
                variant="outline"
                disabled={status.isPending || user.id === currentUserId}
                onClick={() => status.mutate()}
              >
                {user.status === 'ACTIVE' ? t('users.disable') : t('users.enable')}
              </Button>
            )}
          </div>
          <div className="border-t pt-5">
            <h3 className="text-sm font-semibold">{t('users.resetPassword')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('users.resetPasswordHint')}</p>
            <div className="mt-3">
              <Button
                variant="outline"
                disabled={!can('identity.user.reset_password') || reset.isPending}
                onClick={() => {
                  if (!window.confirm(t('users.resetPasswordConfirm', { name: user.username })))
                    return;
                  reset.mutate();
                }}
              >
                {reset.isPending ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {t('users.generateTemporaryPassword')}
              </Button>
            </div>
          </div>
          {can('identity.user.delete') && !user.isSuperAdmin && user.id !== currentUserId && (
            <div className="border-t pt-5">
              <h3 className="text-sm font-semibold text-destructive">{t('users.deleteAccount')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('users.deleteHint')}</p>
              <Button
                className="mt-3 text-destructive hover:text-destructive"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  if (!window.confirm(t('users.deleteConfirm', { name: user.username }))) return;
                  remove.mutate();
                }}
              >
                {remove.isPending ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                {t('users.deleteAccount')}
              </Button>
            </div>
          )}
        </div>
      </div>
      {message && (
        <p aria-live="polite" className="mt-5 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </p>
      )}
      {error && (
        <div className="mt-5">
          <ErrorNotice
            message={error instanceof ApiError ? error.message : t('common.requestFailed')}
          />
        </div>
      )}
    </div>
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
