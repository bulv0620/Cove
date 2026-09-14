import { AppWindow, ChevronRight, Menu, Moon, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';
import { UserMenu } from '@/features/auth/components/user-menu';
import { navigationGroups, routedNavigationItems } from '@/app/navigation';
import { useTheme } from '@/app/theme-provider';
import { useAuth } from '@/features/auth/hooks';
import { cn } from '@/lib/utils';

function SidebarContent({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <>
      <div className="flex h-16 items-center border-b px-5">
        <Logo />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label={t('navigation.primary')}>
        {navigationGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) =>
              !item.pagePermission ||
              user?.isSuperAdmin ||
              user?.permissions.includes(item.pagePermission),
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.translationKey} className="mb-6">
              <p className="mb-2 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {t(group.translationKey)}
              </p>
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  if (!item.to) {
                    return (
                      <button
                        key={item.translationKey}
                        type="button"
                        disabled
                        className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground/70 disabled:cursor-not-allowed"
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span>{t(item.translationKey)}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wide">
                          {t('common.soon')}
                        </span>
                      </button>
                    );
                  }
                  return (
                    <NavLink
                      key={item.translationKey}
                      to={item.to}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                          isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )
                      }
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{t(item.translationKey)}</span>
                      <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-50" aria-hidden="true" />
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t px-5 py-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span>{t('navigation.consoleAvailable')}</span>
        </div>
        <p className="mt-1 font-mono text-[10px]">skeleton · v0.1.0</p>
      </div>
    </>
  );
}

export function DashboardLayout(): JSX.Element {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentPageKey =
    routedNavigationItems.find(({ to }) => to === location.pathname)?.translationKey ??
    'navigation.dashboard';
  const isFilesPage = location.pathname === '/files';

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t('navigation.skipToContent')}
      </a>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r bg-card lg:flex">
        <SidebarContent />
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 cursor-default bg-slate-950/60"
            aria-label={t('navigation.closeNavigation')}
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative flex h-full w-[min(82vw,320px)] flex-col bg-card shadow-xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10"
              onClick={() => setMobileMenuOpen(false)}
              aria-label={t('navigation.closeMenu')}
            >
              <X className="h-5 w-5" />
            </Button>
            <SidebarContent onNavigate={() => setMobileMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileMenuOpen(true)}
            aria-label={t('navigation.openMenu')}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
            <AppWindow className="h-4 w-4" aria-hidden="true" />
            <span>Home Ops</span>
            <span>/</span>
            <span className="text-foreground">{t(currentPageKey)}</span>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('header.switchToLight') : t('header.switchToDark')}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <UserMenu />
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'w-full outline-none',
            isFilesPage
              ? 'h-[calc(100dvh-4rem)] max-w-none overflow-hidden'
              : 'mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8',
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
