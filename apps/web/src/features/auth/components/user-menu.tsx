import {
  Check,
  ChevronDown,
  CircleUserRound,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogOut,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { authApi } from '@/features/auth/api';
import { useAuth } from '@/features/auth/hooks';
import { ApiError } from '@/lib/api';

export function UserMenu(): JSX.Element {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const roleLabel = user?.isSuperAdmin
    ? t('header.superAdministrator')
    : user?.roleCodes.join(', ') || t('header.noRole');

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('header.accountMenu')}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleUserRound className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <span className="hidden min-w-0 sm:block">
            <span
              className="block max-w-40 truncate text-xs font-medium leading-4"
              title={user?.displayName || user?.username}
            >
              {user?.displayName || user?.username}
            </span>
            <span
              className="block max-w-40 truncate text-[10px] leading-3 text-muted-foreground"
              title={roleLabel}
            >
              {roleLabel}
            </span>
          </span>
          <ChevronDown
            className="hidden h-3.5 w-3.5 text-muted-foreground sm:block"
            aria-hidden="true"
          />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-60 overflow-hidden rounded-lg border bg-card p-1 text-card-foreground shadow-xl"
          >
            <div className="border-b px-3 py-2.5 sm:hidden">
              <p className="truncate text-sm font-medium">{user?.displayName || user?.username}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{roleLabel}</p>
            </div>
            <button
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setMenuOpen(false);
                setPasswordDialogOpen(true);
              }}
            >
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t('auth.changePassword.menuLabel')}
            </button>
            <div className="my-1 border-t" />
            <button
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {t('header.signOut')}
            </button>
          </div>
        )}
      </div>

      <Modal
        open={passwordDialogOpen}
        title={t('auth.changePassword.title')}
        description={t('auth.changePassword.description')}
        className="sm:max-w-lg"
        onClose={() => setPasswordDialogOpen(false)}
      >
        <ChangePasswordForm
          onCancel={() => setPasswordDialogOpen(false)}
          onSuccess={() => {
            setPasswordDialogOpen(false);
            logout();
            navigate('/login?passwordChanged=1', { replace: true });
          }}
        />
      </Modal>
    </>
  );
}

export function ChangePasswordForm({
  onCancel,
  cancelLabel,
  onSuccess,
}: {
  onCancel?: () => void;
  cancelLabel?: string;
  onSuccess: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{
    field: 'current' | 'new' | 'confirm' | 'form';
    message: string;
  } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError({ field: 'confirm', message: t('auth.changePassword.errors.mismatch') });
      return;
    }
    if (newPassword === currentPassword) {
      setError({ field: 'new', message: t('auth.changePassword.errors.unchanged') });
      return;
    }

    setPending(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      onSuccess();
    } catch (caught) {
      if (caught instanceof ApiError && caught.message === 'Current password is incorrect.') {
        setError({
          field: 'current',
          message: t('auth.changePassword.errors.currentIncorrect'),
        });
      } else if (
        caught instanceof ApiError &&
        caught.message === 'New password must be different from the current password.'
      ) {
        setError({ field: 'new', message: t('auth.changePassword.errors.unchanged') });
      } else {
        setError({
          field: 'form',
          message: caught instanceof ApiError ? caught.message : t('common.requestFailed'),
        });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)}>
      <PasswordField
        id="current-password"
        label={t('auth.changePassword.currentPassword')}
        value={currentPassword}
        onChange={(value) => {
          setCurrentPassword(value);
          if (error?.field === 'current') setError(null);
        }}
        autoComplete="current-password"
        error={error?.field === 'current' ? error.message : undefined}
      />
      <PasswordField
        id="new-password"
        label={t('auth.changePassword.newPassword')}
        value={newPassword}
        onChange={(value) => {
          setNewPassword(value);
          if (error?.field === 'new') setError(null);
        }}
        autoComplete="new-password"
        minLength={8}
        error={error?.field === 'new' ? error.message : undefined}
      />
      <PasswordField
        id="confirm-password"
        label={t('auth.changePassword.confirmPassword')}
        value={confirmPassword}
        onChange={(value) => {
          setConfirmPassword(value);
          if (error?.field === 'confirm') setError(null);
        }}
        autoComplete="new-password"
        minLength={8}
        error={error?.field === 'confirm' ? error.message : undefined}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        {t('auth.changePassword.passwordHint')}
      </p>

      {error?.field === 'form' && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error.message}
        </p>
      )}

      <div className="flex justify-end gap-2 border-t pt-5">
        {onCancel && (
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
        )}
        <Button
          type="submit"
          disabled={
            pending || !currentPassword || newPassword.length < 8 || confirmPassword.length < 8
          }
        >
          {pending ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {pending ? t('auth.changePassword.saving') : t('auth.changePassword.submit')}
        </Button>
      </div>
    </form>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength = 1,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  minLength?: number;
  error?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          required
          minLength={minLength}
          maxLength={128}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pr-12"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
