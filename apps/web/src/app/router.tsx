import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { routedNavigationItems } from '@/app/navigation';
import { LoadingScreen } from '@/components/shared/loading-screen';
import { useAuth } from '@/features/auth/hooks';
import { DashboardLayout } from '@/layouts/dashboard-layout';
import { LoginPage } from '@/pages/login/login-page';
import { NotFoundPage } from '@/pages/not-found/not-found-page';

function ProtectedRoute(): JSX.Element {
  const { isAuthenticated, isRestoring } = useAuth();
  if (isRestoring) return <LoadingScreen />;
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

function PublicOnlyRoute(): JSX.Element {
  const { isAuthenticated, isRestoring } = useAuth();
  if (isRestoring) return <LoadingScreen />;
  return isAuthenticated ? <Navigate to="/" replace /> : <Outlet />;
}

function PermissionRoute({ permission }: { permission: string }): JSX.Element {
  const { user } = useAuth();
  const allowed = user?.isSuperAdmin || user?.permissions.includes(permission);
  return allowed ? <Outlet /> : <Navigate to="/" replace />;
}

export const router = createBrowserRouter([
  {
    element: <PublicOnlyRoute />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: routedNavigationItems.map((item) =>
          item.pagePermission
            ? {
                element: <PermissionRoute permission={item.pagePermission} />,
                children: [{ path: item.to, element: item.element }],
              }
            : { path: item.to, element: item.element },
        ),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
