import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';

export function LoginPage(): JSX.Element {
  const { t } = useTranslation();
  const { user, login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (rateLimitUntil === null) return;
    const update = (): void => {
      const remaining = Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000));
      setRetryAfterSeconds(remaining || null);
      if (remaining === 0) setRateLimitUntil(null);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [rateLimitUntil]);

  const displayedError =
    retryAfterSeconds === null ? error : t('auth.errors.rateLimited', { count: retryAfterSeconds });

  if (isAuthenticated)
    return <Navigate to={user?.mustChangePassword ? '/change-password' : '/'} replace />;

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
      } else if (
        caught instanceof ApiError &&
        caught.status === 429 &&
        caught.code === 'AUTH_RATE_LIMITED'
      ) {
        const seconds = caught.retryAfterSeconds ?? 1;
        setRateLimitUntil(Date.now() + seconds * 1000);
        setRetryAfterSeconds(seconds);
      } else if (caught instanceof ApiError && caught.status === 0) {
        setError(t('auth.errors.serverUnavailable'));
      } else {
        setError(t('auth.errors.generic'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (
      event.key !== 'Enter' ||
      event.nativeEvent.isComposing ||
      isSubmitting ||
      retryAfterSeconds !== null ||
      !username ||
      !password
    )
      return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <main className="relative isolate flex min-h-dvh flex-col bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.06),transparent_70%)]"
      />
      <header className="flex items-center justify-between gap-4 px-6 py-5 sm:px-10 sm:py-7">
        <Logo />
        <LanguageSwitcher className="rounded-full text-muted-foreground" />
      </header>

      <section
        className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 sm:py-14"
        aria-labelledby="login-title"
      >
        <div className="w-full max-w-[420px]">
          <div className="mb-8 text-center">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t('auth.heroTitle')}
            </p>
            <h1 id="login-title" className="text-3xl font-semibold tracking-tight sm:text-[2rem]">
              {t('auth.title')}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('auth.description')}</p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-[0_8px_32px_-16px_hsl(var(--foreground)/0.12)] sm:p-8">
            <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)} noValidate>
              {searchParams.get('passwordChanged') === '1' && (
                <div
                  role="status"
                  className="flex gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-300"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t('auth.changePassword.success')}</span>
                </div>
              )}
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium">
                  {t('auth.username')}
                </label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  className="h-12 rounded-lg bg-background/60 px-3.5"
                  autoFocus
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={t('auth.usernamePlaceholder')}
                  aria-invalid={Boolean(displayedError)}
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
                    onKeyDown={handlePasswordKeyDown}
                    placeholder={t('auth.passwordPlaceholder')}
                    className="h-12 rounded-lg bg-background/60 pl-3.5 pr-12"
                    aria-invalid={Boolean(displayedError)}
                    aria-describedby={displayedError ? 'login-error' : undefined}
                  />
                  <button
                    type="button"
                    className="absolute right-0 top-0 flex h-12 w-12 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {displayedError && (
                <div
                  id="login-error"
                  role={retryAfterSeconds === null ? 'alert' : 'status'}
                  className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive"
                >
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{displayedError}</span>
                </div>
              )}

              <Button
                type="submit"
                className="h-12 w-full gap-2 rounded-lg"
                disabled={isSubmitting || retryAfterSeconds !== null || !username || !password}
              >
                {isSubmitting && (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
                {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </form>
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t('auth.localAccess')}
          </p>
        </div>
      </section>
      <footer className="px-6 pb-6 pt-2 text-center text-xs leading-5 text-muted-foreground">
        Cove{' '}
        <span aria-hidden="true" className="mx-2">
          /
        </span>{' '}
        {t('common.productSubtitle')}
      </footer>
    </main>
  );
}
