import { KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { Logo } from '@/components/shared/logo';
import { Card } from '@/components/ui/card';
import { ChangePasswordForm } from '@/features/auth/components/user-menu';
import { useAuth } from '@/features/auth/hooks';

export function RequiredPasswordChangePage(): JSX.Element {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const returnToLogin = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-muted/40 px-5 py-16 sm:px-8">
      <LanguageSwitcher className="absolute right-4 top-4 sm:right-6 sm:top-6" />
      <div className="w-full max-w-lg">
        <Logo className="mb-8 justify-center" />
        <Card className="p-5 shadow-xl sm:p-7">
          <div className="mb-6 border-b pb-5">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t('auth.changePassword.requiredTitle')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('auth.changePassword.requiredDescription')}
            </p>
          </div>
          <ChangePasswordForm
            onCancel={returnToLogin}
            cancelLabel={t('header.signOut')}
            onSuccess={() => {
              logout();
              navigate('/login?passwordChanged=1', { replace: true });
            }}
          />
          <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('auth.changePassword.requiredSecurityHint')}</span>
          </div>
        </Card>
      </div>
    </main>
  );
}
