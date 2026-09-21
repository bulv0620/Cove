import { useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';
import {
  PageSessionTabs,
  pageSessionPanelId,
  pageSessionTabId,
} from '@/components/shared/page-session-tabs';
import { useAuth } from '@/features/auth/hooks';
import { cn } from '@/lib/utils';
import { routedNavigationItems, type NavigationItem } from './navigation';
import { PageSessionActivityProvider } from './page-session-activity';
import {
  activePageSession,
  closePageSession,
  DASHBOARD_ROUTE_ID,
  initializePageSessions,
  openOrActivatePageSession,
  pageSessionLocationsEqual,
  pageSessionRouteIdFromNavigationState,
  prunePageSessions,
  resolvePageSessionNavigationLocation,
  type PageSessionLocation,
  type PageSessionState,
} from './page-session-state';

function locationSnapshot(location: PageSessionLocation): PageSessionLocation {
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
  };
}

function removeQueriesForRoutes(
  queryClient: ReturnType<typeof useQueryClient>,
  routeIds: string[],
) {
  if (routeIds.some((routeId) => ['users', 'roles', 'resources'].includes(routeId))) {
    queryClient.removeQueries({ queryKey: ['identity'] });
  }
  if (routeIds.includes('files')) {
    queryClient.removeQueries({ queryKey: ['files'] });
    queryClient.removeQueries({ queryKey: ['smb-binding'] });
  }
  if (routeIds.includes('images')) queryClient.removeQueries({ queryKey: ['images'] });
}

export function PageSessionWorkspace(): JSX.Element {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const queryClient = useQueryClient();
  const sequence = useRef(1);
  const accessibleRoutes = useMemo(
    () =>
      routedNavigationItems.filter(
        (item) =>
          !item.pagePermission ||
          user?.isSuperAdmin ||
          Boolean(user?.permissions.includes(item.pagePermission)),
      ),
    [user?.isSuperAdmin, user?.permissions],
  );
  const routesById = useMemo(
    () => new Map(accessibleRoutes.map((item) => [item.id, item])),
    [accessibleRoutes],
  );
  const currentRoute = accessibleRoutes.find((item) => item.to === location.pathname);
  const initialRoute = currentRoute ?? routesById.get(DASHBOARD_ROUTE_ID)!;
  const [state, setState] = useState<PageSessionState>(() =>
    initializePageSessions(initialRoute.id, locationSnapshot(location), sequence.current++),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const allowedRouteIds = useMemo(
    () => new Set(accessibleRoutes.map(({ id }) => id)),
    [accessibleRoutes],
  );
  const allowedRouteKey = accessibleRoutes.map(({ id }) => id).join('|');

  useLayoutEffect(() => {
    if (!currentRoute) return;
    const requestedLocation = locationSnapshot(location);
    const sidebarRouteId = pageSessionRouteIdFromNavigationState(location.state);
    const resolvedLocation = resolvePageSessionNavigationLocation(
      stateRef.current,
      currentRoute.id,
      requestedLocation,
      navigationType === 'PUSH' && sidebarRouteId === currentRoute.id,
    );
    if (!pageSessionLocationsEqual(resolvedLocation, requestedLocation)) {
      navigate(resolvedLocation, { replace: true });
      return;
    }
    setState((current) =>
      openOrActivatePageSession(current, currentRoute.id, requestedLocation, sequence.current++),
    );
  }, [currentRoute, location, navigate, navigationType]);

  useLayoutEffect(() => {
    const next = prunePageSessions(state, allowedRouteIds, sequence.current++);
    if (next === state) return;
    const removedRouteIds = state.sessions
      .filter(({ routeId }) => !allowedRouteIds.has(routeId))
      .map(({ routeId }) => routeId);
    removeQueriesForRoutes(queryClient, removedRouteIds);
    setState(next);
    if (next.activeRouteId !== state.activeRouteId) {
      const fallback = activePageSession(next);
      navigate(fallback.location, { replace: true });
    }
  }, [allowedRouteIds, allowedRouteKey, navigate, queryClient, state]);

  const activate = (routeId: string) => {
    if (routeId === state.activeRouteId) return;
    const session = state.sessions.find((candidate) => candidate.routeId === routeId);
    if (!session) return;
    setState((current) =>
      openOrActivatePageSession(current, routeId, session.location, sequence.current++),
    );
    navigate(session.location);
  };

  const close = (routeId: string) => {
    const wasActive = routeId === state.activeRouteId;
    const next = closePageSession(state, routeId, sequence.current++);
    if (next === state) return;
    setState(next);
    if (wasActive) navigate(activePageSession(next).location, { replace: true });
  };

  return (
    <>
      <Outlet />
      <PageSessionTabs
        sessions={state.sessions}
        activeRouteId={state.activeRouteId}
        routesById={routesById}
        onActivate={activate}
        onClose={close}
      />
      <main id="main-content" tabIndex={-1} className="w-full outline-none">
        {state.sessions.map((session) => {
          const route = routesById.get(session.routeId);
          if (!route) return null;
          return (
            <PageSessionPanel
              key={session.routeId}
              route={route}
              location={session.location}
              active={session.routeId === state.activeRouteId}
            />
          );
        })}
      </main>
    </>
  );
}

function PageSessionPanel({
  route,
  location,
  active,
}: {
  route: NavigationItem;
  location: PageSessionLocation;
  active: boolean;
}): JSX.Element {
  const Component = route.component;
  return (
    <section
      id={pageSessionPanelId(route.id)}
      role="tabpanel"
      aria-labelledby={pageSessionTabId(route.id)}
      aria-hidden={!active}
      hidden={!active}
      className={cn(
        'w-full outline-none',
        ['files', 'images'].includes(route.id)
          ? 'h-[calc(100dvh-6.75rem)] max-w-none overflow-hidden'
          : 'mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8',
      )}
    >
      <PageSessionActivityProvider active={active}>
        <Routes location={location}>
          <Route path="*" element={<Component />} />
        </Routes>
      </PageSessionActivityProvider>
    </section>
  );
}
