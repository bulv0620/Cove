import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import { filesApi } from './api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
export function SmbBindingPanel({
  userId,
  onChanged,
}: {
  userId: string;
  onChanged: () => Promise<unknown>;
}): JSX.Element {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [username, setUsername] = useState<string | null>(null),
    [password, setPassword] = useState(''),
    [visible, setVisible] = useState(false),
    [message, setMessage] = useState('');
  const binding = useQuery({
    queryKey: ['smb-binding', userId],
    queryFn: () => filesApi.binding(userId),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (action: 'test' | 'save' | 'unbind') => {
      setMessage('');
      const name = username ?? binding.data?.username ?? '';
      if (action === 'test') {
        await filesApi.test(userId, name, password);
        setMessage('files.connectSuccess');
        return;
      }
      if (action === 'save') {
        await filesApi.bind(userId, name, password, binding.data?.version ?? null);
        setMessage('files.saved');
      } else {
        await filesApi.unbind(userId);
        setMessage('');
      }
      setPassword('');
      setVisible(false);
      await cache.invalidateQueries({ queryKey: ['smb-binding', userId] });
      await cache.invalidateQueries({ queryKey: ['files'] });
      await onChanged();
    },
  });
  const error = mutation.error ?? binding.error;
  const busy = mutation.isPending;
  const isTesting = busy && mutation.variables === 'test';

  if (binding.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" role="status">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t('files.bindingLoading')}</span>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 px-4 py-3">
        <span className="text-sm font-medium">{t('files.connection')}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            binding.data?.bound
              ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              binding.data?.bound ? 'bg-emerald-500' : 'bg-muted-foreground/60',
            )}
            aria-hidden="true"
          />
          {t(binding.data?.bound ? 'files.bound' : 'files.unbound')}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{t('files.bindHint')}</p>
      {binding.data && !binding.data.enabled ? (
        <p className="text-sm">{t('files.configHint')}</p>
      ) : (
        <>
          <label className="block space-y-1 text-sm">
            <span>{t('files.username')}</span>
            <Input
              autoComplete="off"
              value={username ?? binding.data?.username ?? ''}
              onChange={(event) => {
                setUsername(event.target.value);
                setMessage('');
                mutation.reset();
              }}
              disabled={busy}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t('files.password')}</span>
            <Input
              type={visible ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setMessage('');
                mutation.reset();
              }}
              disabled={busy}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-xs text-muted-foreground">{t('files.passwordHint')}</p>
            <Button size="sm" variant="ghost" onClick={() => setVisible(!visible)}>
              {t(visible ? 'files.hidePassword' : 'files.showPassword')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {binding.data?.share} · {t('files.lastCheck')}:{' '}
            {binding.data?.lastCheckedAt
              ? new Date(binding.data.lastCheckedAt).toLocaleString()
              : t('files.never')}
          </p>
          {binding.data?.bound && binding.data.state !== 'READY' && (
            <p className="text-sm text-destructive">
              {t(`files.errors.${binding.data.state}`, { defaultValue: binding.data.state })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !password}
              onClick={() => mutation.mutate('test')}
            >
              {isTesting && (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {t(isTesting ? 'files.testing' : 'files.test')}
            </Button>
            <Button disabled={busy || !password} onClick={() => mutation.mutate('save')}>
              {t('files.save')}
            </Button>
            {binding.data?.bound && (
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('files.unbindConfirm'))) mutation.mutate('unbind');
                }}
              >
                {t('files.unbind')}
              </Button>
            )}
          </div>
        </>
      )}
      {message && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300"
        >
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{t(message)}</p>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
        >
          <CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{t(`files.errors.${error.message}`, { defaultValue: error.message })}</p>
        </div>
      )}
    </section>
  );
}
