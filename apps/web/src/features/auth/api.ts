import type { AuthUser, ChangePasswordRequest, LoginRequest, LoginResponse } from './types';
import { apiRequest } from '@/lib/api';

export const authApi = {
  login: (credentials: LoginRequest): Promise<LoginResponse> =>
    apiRequest<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  getCurrentUser: (): Promise<AuthUser> => apiRequest<AuthUser>('/api/auth/me'),
  changePassword: (input: ChangePasswordRequest): Promise<void> =>
    apiRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
