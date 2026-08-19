import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps): JSX.Element {
  const { i18n, t } = useTranslation();
  const isChinese = i18n.resolvedLanguage?.startsWith('zh') ?? false;
  const targetLanguage = isChinese ? 'en' : 'zh-CN';

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn('gap-2 px-3', className)}
      onClick={() => void i18n.changeLanguage(targetLanguage)}
      aria-label={isChinese ? t('common.switchToEnglish') : t('common.switchToChinese')}
      title={isChinese ? t('common.switchToEnglish') : t('common.switchToChinese')}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="font-mono text-xs">{isChinese ? '中文' : 'EN'}</span>
    </Button>
  );
}
