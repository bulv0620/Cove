import type { AuthUser, LoginRequest, LoginResponse } from './types';
import { apiRequest } from '@/lib/api';

export const authApi = {
  login: (credentials: LoginRequest): Promise<LoginResponse> =>
    apiRequest<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  getCurrentUser: (): Promise<AuthUser> => apiRequest<AuthUser>('/api/auth/me'),
};
