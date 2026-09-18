import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, type PropsWithChildren } from 'react';
import { authApi } from './api';
import { AuthContext } from './auth-context';
import type { LoginRequest } from './types';
import { tokenStorage } from '@/lib/api';

const CURRENT_USER_KEY = ['auth', 'current-user'] as const;

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const queryClient = useQueryClient();
  const [tokenRevision, refreshTokenState] = useReducer((value: number) => value + 1, 0);
  const hasToken = Boolean(tokenStorage.get());

  useEffect(() => {
    const handleUnauthorized = (): void => {
      queryClient.clear();
      refreshTokenState();
    };
    window.addEventListener('cove:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('cove:unauthorized', handleUnauthorized);
  }, [queryClient]);

  const currentUser = useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: authApi.getCurrentUser,
    enabled: hasToken,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: ({ accessToken, user }) => {
      tokenStorage.set(accessToken);
      refreshTokenState();
      queryClient.setQueryData(CURRENT_USER_KEY, user);
    },
  });

  const login = async (credentials: LoginRequest): Promise<void> => {
    await loginMutation.mutateAsync(credentials);
  };

  const logout = (): void => {
    tokenStorage.clear();
    queryClient.clear();
    refreshTokenState();
  };

  void tokenRevision;

  return (
    <AuthContext.Provider
      value={{
        user: hasToken ? (currentUser.data ?? null) : null,
        isAuthenticated: hasToken && Boolean(currentUser.data),
        isRestoring: hasToken && currentUser.isPending,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
