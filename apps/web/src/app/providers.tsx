import { TransferProvider } from '@/features/files/transfer-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';
import { ThemeProvider } from './theme-provider';
import { AuthProvider } from '@/features/auth/auth-provider';

export function AppProviders({ children }: PropsWithChildren): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TransferProvider>{children}</TransferProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
