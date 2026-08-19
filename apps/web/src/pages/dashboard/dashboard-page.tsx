import { useQuery } from '@tanstack/react-query';
import { Activity, Cpu, Database, HardDrive, RefreshCw, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/hooks';
import { systemApi } from '@/features/system/api';

const placeholderMetrics = [
  { translationKey: 'dashboard.cpu', icon: Cpu },
  { translationKey: 'dashboard.memory', icon: Database },
  { translationKey: 'dashboard.storage', icon: HardDrive },
];

const foundationItems = [
  { labelKey: 'dashboard.authentication', valueKey: 'dashboard.jwtActive' },
  { labelKey: 'dashboard.api', valueKey: 'dashboard.apiConnected' },
  { labelKey: 'dashboard.persistence', valueKey: 'dashboard.persistenceNotConfigured' },
] as const;

export function DashboardPage(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const status = useQuery({
    queryKey: ['system', 'status'],
    queryFn: systemApi.getStatus,
    refetchInterval: 60_000,
    enabled: Boolean(user?.isSuperAdmin),
  });

  return (
    <div>
      <div className="flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-primary">
            {t('dashboard.eyebrow')}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('dashboard.title')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('dashboard.welcome', { username: user?.username })}
          </p>
        </div>
        <p className="font-mono text-xs text-muted-foreground">{t('dashboard.updated')}</p>
      </div>

      {user?.isSuperAdmin && (
        <section className="py-7" aria-labelledby="server-status-heading">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 id="server-status-heading" className="text-base font-semibold">
                {t('dashboard.serverStatus')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.connectivity')}</p>
            </div>
            {status.isError && (
              <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {t('common.retry')}
              </Button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('dashboard.server')}
                  </p>
                  <p className="mt-4 text-2xl font-semibold tracking-tight">
                    {status.isPending
                      ? t('dashboard.checking')
                      : status.isError
                        ? t('dashboard.unavailable')
                        : t('dashboard.online')}
                  </p>
                </div>
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <Server className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={`h-2 w-2 rounded-full ${status.isSuccess ? 'bg-emerald-500' : status.isError ? 'bg-destructive' : 'bg-amber-500'}`}
                />
                {status.isSuccess
                  ? t('dashboard.apiNormal')
                  : status.isError
                    ? t('dashboard.apiUnavailable')
                    : t('dashboard.verifying')}
              </div>
            </Card>

            {placeholderMetrics.map(({ translationKey, icon: Icon }) => (
              <Card key={translationKey} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{t(translationKey)}</p>
                    <p className="mt-4 font-mono text-2xl font-semibold tracking-tight">—</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" />
                  <span>{t('dashboard.monitoringNotConfigured')}</span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="border-t pt-7" aria-labelledby="foundation-heading">
        <h2 id="foundation-heading" className="text-base font-semibold">
          {t('dashboard.foundation')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.foundationDescription')}</p>
        <div className="mt-4 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          {foundationItems.map(({ labelKey, valueKey }) => (
            <div key={labelKey} className="bg-card px-5 py-4">
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {t(labelKey)}
              </p>
              <p className="mt-2 text-sm font-medium">{t(valueKey)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
