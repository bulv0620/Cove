import {
  Boxes,
  CloudCog,
  FileStack,
  HardDriveDownload,
  LayoutDashboard,
  Layers,
  Network,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { DashboardPage } from '@/pages/dashboard/dashboard-page';
import { ResourcesPage } from '@/pages/resources/resources-page';
import { RolesPage } from '@/pages/roles/roles-page';
import { UsersPage } from '@/pages/users/users-page';

export interface NavigationItem {
  translationKey: string;
  icon: LucideIcon;
  to?: string;
  pagePermission?: string;
  element?: ReactNode;
}

export interface NavigationGroup {
  translationKey: string;
  items: NavigationItem[];
}

export const navigationGroups: NavigationGroup[] = [
  {
    translationKey: 'navigation.overview',
    items: [
      {
        translationKey: 'navigation.dashboard',
        icon: LayoutDashboard,
        to: '/',
        element: <DashboardPage />,
      },
    ],
  },
  {
    translationKey: 'navigation.identity',
    items: [
      {
        translationKey: 'navigation.users',
        icon: Users,
        to: '/users',
        pagePermission: 'identity.user.page',
        element: <UsersPage />,
      },
      {
        translationKey: 'navigation.roles',
        icon: ShieldCheck,
        to: '/roles',
        pagePermission: 'identity.role.page',
        element: <RolesPage />,
      },
      {
        translationKey: 'navigation.resources',
        icon: Layers,
        to: '/resources',
        pagePermission: 'identity.resource.page',
        element: <ResourcesPage />,
      },
    ],
  },
  {
    translationKey: 'navigation.infrastructure',
    items: [
      { translationKey: 'navigation.files', icon: FileStack },
      { translationKey: 'navigation.applications', icon: Boxes },
      { translationKey: 'navigation.network', icon: Network },
      { translationKey: 'navigation.backup', icon: HardDriveDownload },
      { translationKey: 'navigation.tasks', icon: CloudCog },
    ],
  },
  {
    translationKey: 'navigation.system',
    items: [{ translationKey: 'navigation.settings', icon: Settings }],
  },
];

export const routedNavigationItems = navigationGroups.flatMap(({ items }) =>
  items.filter((item): item is NavigationItem & { to: string; element: ReactNode } =>
    Boolean(item.to && item.element),
  ),
);
