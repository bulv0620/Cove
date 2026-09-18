import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { NavigationItem } from '@/app/navigation';
import type { PageSession } from '@/app/page-session-state';
import { cn } from '@/lib/utils';

export function pageSessionTabId(routeId: string): string {
  return `page-session-tab-${routeId}`;
}

export function pageSessionPanelId(routeId: string): string {
  return `page-session-panel-${routeId}`;
}

export function PageSessionTabs({
  sessions,
  activeRouteId,
  routesById,
  onActivate,
  onClose,
}: {
  sessions: PageSession[];
  activeRouteId: string;
  routesById: ReadonlyMap<string, NavigationItem>;
  onActivate: (routeId: string) => void;
  onClose: (routeId: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusedRouteId, setFocusedRouteId] = useState(activeRouteId);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);
  const sessionIds = useMemo(() => sessions.map(({ routeId }) => routeId), [sessions]);

  useEffect(() => {
    setFocusedRouteId(activeRouteId);
    tabRefs.current.get(activeRouteId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeRouteId]);

  useEffect(() => {
    if (sessionIds.includes(focusedRouteId)) return;
    setFocusedRouteId(activeRouteId);
  }, [activeRouteId, focusedRouteId, sessionIds]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      setCanScrollBack(scroller.scrollLeft > 1);
      setCanScrollForward(scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1);
    };
    const updateAfterResize = () => {
      tabRefs.current.get(activeRouteId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      update();
    };
    updateAfterResize();
    const observer = new ResizeObserver(updateAfterResize);
    observer.observe(scroller);
    scroller.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', update);
    };
  }, [activeRouteId, sessions]);

  const moveFocus = (index: number) => {
    const routeId = sessionIds[index];
    if (!routeId) return;
    setFocusedRouteId(routeId);
    tabRefs.current.get(routeId)?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const routeId = sessionIds[index];
    if (!routeId) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFocus((index - 1 + sessionIds.length) % sessionIds.length);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveFocus((index + 1) % sessionIds.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveFocus(sessionIds.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(routeId);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onClose(routeId);
    }
  };

  const scrollByPage = (direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(160, scroller.clientWidth * 0.7) });
  };

  return (
    <div className="sticky top-16 z-10 flex h-11 min-w-0 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90">
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center border-r text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!canScrollBack}
        onClick={() => scrollByPage(-1)}
        aria-label={t('navigation.scrollTabsBack')}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <div
        ref={scrollerRef}
        role="tablist"
        aria-label={t('navigation.pageSessions')}
        className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {sessions.map((session, index) => {
          const route = routesById.get(session.routeId);
          if (!route) return null;
          const Icon = route.icon;
          const active = session.routeId === activeRouteId;
          const title = t(route.translationKey);
          return (
            <div
              key={session.routeId}
              className={cn(
                'relative flex h-11 min-w-36 max-w-56 shrink-0 border-r transition-colors duration-200 motion-reduce:transition-none',
                active ? 'bg-background text-foreground' : 'bg-muted/30 text-muted-foreground',
              )}
            >
              <button
                ref={(element) => {
                  if (element) tabRefs.current.set(session.routeId, element);
                  else tabRefs.current.delete(session.routeId);
                }}
                type="button"
                id={pageSessionTabId(session.routeId)}
                role="tab"
                aria-selected={active}
                aria-controls={pageSessionPanelId(session.routeId)}
                tabIndex={focusedRouteId === session.routeId ? 0 : -1}
                title={title}
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 text-left text-sm outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active ? 'font-semibold' : 'font-medium hover:bg-accent/60 hover:text-foreground',
                )}
                onFocus={() => setFocusedRouteId(session.routeId)}
                onClick={() => onActivate(session.routeId)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <Icon
                  className={cn('h-4 w-4 shrink-0', active && 'text-primary')}
                  aria-hidden="true"
                />
                <span className="truncate">{title}</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={t('navigation.closePageSession', { page: title })}
                title={t('navigation.closePageSession', { page: title })}
                onClick={() => onClose(session.routeId)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center border-l text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!canScrollForward}
        onClick={() => scrollByPage(1)}
        aria-label={t('navigation.scrollTabsForward')}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
