const TOKEN_KEY = 'home-ops.access-token';
const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

interface NestErrorBody {
  message?: string | string[];
  error?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStorage = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event('home-ops:unauthorized'));
  },
};

async function parseError(response: Response): Promise<ApiError> {
  let body: NestErrorBody = {};
  try {
    body = (await response.json()) as NestErrorBody;
  } catch {
    // The status-based fallback below handles non-JSON responses.
  }

  const details = Array.isArray(body.message) ? body.message.join(' ') : body.message;
  const fallback: Record<number, string> = {
    400: 'Please check the submitted information.',
    401: 'Your session is invalid or has expired.',
    404: 'The requested resource was not found.',
    500: 'The server encountered an unexpected error.',
  };

  return new ApiError(
    details ?? fallback[response.status] ?? 'The request could not be completed.',
    response.status,
  );
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStorage.get();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Unable to reach the server. Check that it is running and try again.', 0);
  }

  if (!response.ok) {
    if (response.status === 401 && token) tokenStorage.clear();
    throw await parseError(response);
  }

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}
