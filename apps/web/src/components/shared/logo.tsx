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
      <img
        src="/icons/cove-icon-192.png"
        alt=""
        aria-hidden="true"
        className="h-9 w-9 shrink-0 rounded-lg"
      />
      {!compact && (
        <span>
          <span className="block text-sm font-semibold tracking-tight">Cove</span>
          <span className="block text-xs text-muted-foreground">{t('common.productSubtitle')}</span>
        </span>
      )}
    </div>
  );
}
