import { ChevronRight, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { PageSessionWorkspace } from '@/app/page-session-workspace';
import { createPageSessionNavigationState } from '@/app/page-session-state';
import { LanguageSwitcher } from '@/components/shared/language-switcher';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';
import { UserMenu } from '@/features/auth/components/user-menu';
import { navigationGroups, routedNavigationItems } from '@/app/navigation';
import { useTheme } from '@/app/theme-provider';
import { useAuth } from '@/features/auth/hooks';
import { readSidebarCollapsed, writeSidebarCollapsed } from '@/lib/sidebar-preference';
import { cn } from '@/lib/utils';

interface SidebarContentProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onNavigate?: () => void;
}

function SidebarContent({
  collapsed = false,
  onCollapsedChange,
  onNavigate,
}: SidebarContentProps): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <>
      <div
        className={cn(
          'flex h-16 items-center overflow-hidden border-b',
          collapsed ? 'justify-center' : 'px-5',
        )}
      >
        {!collapsed && <Logo className="min-w-0 overflow-hidden" />}
        {onCollapsedChange && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('shrink-0', collapsed ? 'h-9 min-h-9 w-9' : 'ml-auto')}
            onClick={() => onCollapsedChange(!collapsed)}
            aria-label={collapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
            aria-expanded={!collapsed}
            title={collapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
      <nav
        className={cn('flex-1 overflow-y-auto py-5', collapsed ? 'px-2' : 'px-3')}
        aria-label={t('navigation.primary')}
      >
        {navigationGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) =>
              !item.pagePermission ||
              user?.isSuperAdmin ||
              user?.permissions.includes(item.pagePermission),
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.translationKey} className="mb-6" aria-label={t(group.translationKey)}>
              <p
                className={cn(
                  'mb-2 px-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground',
                  'whitespace-nowrap',
                  collapsed && 'sr-only',
                )}
              >
                {t(group.translationKey)}
              </p>
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.translationKey}
                      to={item.to}
                      state={createPageSessionNavigationState(item.id)}
                      onClick={onNavigate}
                      title={collapsed ? t(item.translationKey) : undefined}
                      aria-label={collapsed ? t(item.translationKey) : undefined}
                      className={({ isActive }) =>
                        cn(
                          'flex h-10 items-center gap-3 overflow-hidden rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                          collapsed && 'justify-center gap-0 px-0',
                          isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )
                      }
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span
                        className={cn(
                          'min-w-0 overflow-hidden whitespace-nowrap',
                          collapsed && 'sr-only',
                        )}
                      >
                        {t(item.translationKey)}
                      </span>
                      {!collapsed && (
                        <ChevronRight
                          className="ml-auto h-3.5 w-3.5 opacity-50"
                          aria-hidden="true"
                        />
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div
        className={cn('border-t py-4 text-xs text-muted-foreground', collapsed ? 'px-2' : 'px-5')}
      >
        <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className={cn(collapsed && 'sr-only')}>{t('navigation.consoleAvailable')}</span>
        </div>
        {!collapsed && <p className="mt-1 font-mono text-[10px]">skeleton · v0.1.0</p>}
      </div>
    </>
  );
}

export function DashboardLayout(): JSX.Element {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const currentPageKey =
    routedNavigationItems.find(({ to }) => to === location.pathname)?.translationKey ??
    'navigation.dashboard';
  const { user } = useAuth();

  const setDesktopSidebarCollapsed = (collapsed: boolean): void => {
    setSidebarCollapsed(collapsed);
    writeSidebarCollapsed(collapsed);
  };

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t('navigation.skipToContent')}
      </a>

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-20 hidden flex-col overflow-x-hidden border-r bg-card transition-[width] duration-200 lg:flex',
          sidebarCollapsed ? 'w-20' : 'w-64',
        )}
      >
        <SidebarContent
          collapsed={sidebarCollapsed}
          onCollapsedChange={setDesktopSidebarCollapsed}
        />
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

      <div
        className={cn(
          'transition-[padding] duration-200',
          sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64',
        )}
      >
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6 lg:px-8">
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
            <img
              src="/icons/cove-icon-192.png"
              alt=""
              aria-hidden="true"
              className="h-4 w-4 rounded"
            />
            <span>Cove</span>
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
        <PageSessionWorkspace key={user?.id ?? 'anonymous'} />
      </div>
    </div>
  );
}
