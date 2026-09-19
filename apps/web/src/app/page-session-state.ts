export interface PageSessionLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface PageSession {
  routeId: string;
  location: PageSessionLocation;
  openedAt: number;
  lastActivatedAt: number;
}

export interface PageSessionState {
  sessions: PageSession[];
  activeRouteId: string;
}

export const DASHBOARD_ROUTE_ID = 'dashboard';
export const DASHBOARD_LOCATION: PageSessionLocation = {
  pathname: '/',
  search: '',
  hash: '',
};
const PAGE_SESSION_ROUTE_STATE_KEY = 'pageSessionRouteId';

export function createPageSessionNavigationState(routeId: string): Record<string, string> {
  return { [PAGE_SESSION_ROUTE_STATE_KEY]: routeId };
}

export function pageSessionRouteIdFromNavigationState(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const routeId = (value as Record<string, unknown>)[PAGE_SESSION_ROUTE_STATE_KEY];
  return typeof routeId === 'string' ? routeId : null;
}

export function pageSessionLocationsEqual(
  left: PageSessionLocation,
  right: PageSessionLocation,
): boolean {
  return (
    left.pathname === right.pathname && left.search === right.search && left.hash === right.hash
  );
}

export function resolvePageSessionNavigationLocation(
  state: PageSessionState,
  routeId: string,
  requestedLocation: PageSessionLocation,
  restoreExisting: boolean,
): PageSessionLocation {
  if (!restoreExisting) return requestedLocation;
  return (
    state.sessions.find((session) => session.routeId === routeId)?.location ?? requestedLocation
  );
}

function createSession(
  routeId: string,
  location: PageSessionLocation,
  timestamp: number,
): PageSession {
  return {
    routeId,
    location,
    openedAt: timestamp,
    lastActivatedAt: timestamp,
  };
}

export function initializePageSessions(
  routeId: string,
  location: PageSessionLocation,
  timestamp: number,
): PageSessionState {
  const dashboard = createSession(DASHBOARD_ROUTE_ID, DASHBOARD_LOCATION, timestamp);
  if (routeId === DASHBOARD_ROUTE_ID) {
    return { sessions: [dashboard], activeRouteId: DASHBOARD_ROUTE_ID };
  }
  return {
    sessions: [dashboard, createSession(routeId, location, timestamp + 1)],
    activeRouteId: routeId,
  };
}

export function openOrActivatePageSession(
  state: PageSessionState,
  routeId: string,
  location: PageSessionLocation,
  timestamp: number,
): PageSessionState {
  const existing = state.sessions.find((session) => session.routeId === routeId);
  if (!existing) {
    return {
      sessions: [...state.sessions, createSession(routeId, location, timestamp)],
      activeRouteId: routeId,
    };
  }

  const locationUnchanged = pageSessionLocationsEqual(existing.location, location);
  if (state.activeRouteId === routeId && locationUnchanged) return state;

  return {
    sessions: state.sessions.map((session) =>
      session.routeId === routeId ? { ...session, location, lastActivatedAt: timestamp } : session,
    ),
    activeRouteId: routeId,
  };
}

export function closePageSession(
  state: PageSessionState,
  routeId: string,
  timestamp: number,
): PageSessionState {
  if (!state.sessions.some((session) => session.routeId === routeId)) return state;

  const remaining = state.sessions.filter((session) => session.routeId !== routeId);
  if (remaining.length === 0) {
    return {
      sessions: [createSession(DASHBOARD_ROUTE_ID, DASHBOARD_LOCATION, timestamp)],
      activeRouteId: DASHBOARD_ROUTE_ID,
    };
  }
  if (state.activeRouteId !== routeId) return { ...state, sessions: remaining };

  const fallback = remaining.reduce((latest, session) =>
    session.lastActivatedAt > latest.lastActivatedAt ? session : latest,
  );
  return { sessions: remaining, activeRouteId: fallback.routeId };
}

export function prunePageSessions(
  state: PageSessionState,
  allowedRouteIds: ReadonlySet<string>,
  timestamp: number,
): PageSessionState {
  const remaining = state.sessions.filter((session) => allowedRouteIds.has(session.routeId));
  if (remaining.length === state.sessions.length) return state;
  if (remaining.length === 0) {
    return {
      sessions: [createSession(DASHBOARD_ROUTE_ID, DASHBOARD_LOCATION, timestamp)],
      activeRouteId: DASHBOARD_ROUTE_ID,
    };
  }
  if (remaining.some((session) => session.routeId === state.activeRouteId)) {
    return { ...state, sessions: remaining };
  }
  const fallback = remaining.reduce((latest, session) =>
    session.lastActivatedAt > latest.lastActivatedAt ? session : latest,
  );
  return { sessions: remaining, activeRouteId: fallback.routeId };
}

export function activePageSession(state: PageSessionState): PageSession {
  return (
    state.sessions.find((session) => session.routeId === state.activeRouteId) ?? state.sessions[0]!
  );
}
