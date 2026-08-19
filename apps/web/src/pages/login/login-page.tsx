import { Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';

export function LoginPage(): JSX.Element {
  const { t } = useTranslation();
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login({ username, password });
      const destination = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(destination, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError(t('auth.errors.invalidCredentials'));
      } else if (caught instanceof ApiError && caught.status === 0) {
        setError(t('auth.errors.serverUnavailable'));
      } else {
        setError(t('auth.errors.generic'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-dvh bg-card lg:grid-cols-[minmax(0,1fr)_minmax(480px,0.72fr)]">
      <section className="relative hidden overflow-hidden border-r bg-slate-950 text-slate-100 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />
        <Logo className="relative [&_span:first-child]:bg-blue-500" />
        <div className="relative max-w-xl">
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-blue-300">
            {t('auth.privateInfrastructure')}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight xl:text-5xl">
            {t('auth.heroTitle')}
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">
            {t('auth.heroDescription')}
          </p>
        </div>
        <div className="relative flex items-center gap-3 text-sm text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          {t('auth.localAccess')}
        </div>
      </section>

      <section className="relative flex min-h-dvh items-center justify-center bg-background px-5 py-10 sm:px-8">
        <LanguageSwitcher className="absolute right-4 top-4 sm:right-6 sm:top-6" />
        <div className="w-full max-w-sm">
          <Logo className="mb-12 lg:hidden" />
          <div className="mb-8">
            <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-primary">
              {t('auth.secureAccess')}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">{t('auth.title')}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('auth.description')}</p>
          </div>

          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                {t('auth.username')}
              </label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t('auth.usernamePlaceholder')}
                aria-invalid={Boolean(error)}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t('auth.password')}
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  className="pr-12"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                />
                <button
                  type="button"
                  className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                id="login-error"
                role="alert"
                className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive"
              >
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || !username || !password}
            >
              {isSubmitting && (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs leading-5 text-muted-foreground">
            {t('auth.developmentNote')}
          </p>
        </div>
      </section>
    </main>
  );
}
