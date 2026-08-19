import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function NotFoundPage(): JSX.Element {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="text-center">
        <p className="font-mono text-sm text-primary">404</p>
        <h1 className="mt-3 text-2xl font-semibold">{t('notFound.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('notFound.description')}</p>
        <Button asChild className="mt-6">
          <a href="/">{t('notFound.back')}</a>
        </Button>
      </div>
    </main>
  );
}
