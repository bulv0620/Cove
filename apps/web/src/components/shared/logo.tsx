import { Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface LogoProps {
  compact?: boolean;
  className?: string;
}

export function Logo({ compact = false, className }: LogoProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Server className="h-5 w-5" aria-hidden="true" />
      </span>
      {!compact && (
        <span>
          <span className="block text-sm font-semibold tracking-tight">Cove</span>
          <span className="block text-xs text-muted-foreground">{t('common.productSubtitle')}</span>
        </span>
      )}
    </div>
  );
}
