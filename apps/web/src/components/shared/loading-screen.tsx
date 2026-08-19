import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Logo } from './logo';

export function LoadingScreen(): JSX.Element {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background" aria-busy="true">
      <div className="flex flex-col items-center gap-5 text-muted-foreground">
        <Logo />
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">{t('loading.restoreSession')}</span>
      </div>
    </main>
  );
}
