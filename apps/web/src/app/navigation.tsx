import { FilesPage } from '@/pages/files/files-page';
import { ImagesPage } from '@/pages/images/images-page';
import { NotesPage } from '@/pages/notes/notes-page';
import {
  FileStack,
  Images,
  LayoutDashboard,
  Layers,
  NotebookPen,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { DashboardPage } from '@/pages/dashboard/dashboard-page';
import { ResourcesPage } from '@/pages/resources/resources-page';
import { RolesPage } from '@/pages/roles/roles-page';
import { UsersPage } from '@/pages/users/users-page';

export interface NavigationItem {
  id: string;
  translationKey: string;
  icon: LucideIcon;
  to: string;
  pagePermission?: string;
  component: ComponentType;
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
        id: 'dashboard',
        translationKey: 'navigation.dashboard',
        icon: LayoutDashboard,
        to: '/',
        component: DashboardPage,
      },
    ],
  },
  {
    translationKey: 'navigation.identity',
    items: [
      {
        id: 'users',
        translationKey: 'navigation.users',
        icon: Users,
        to: '/users',
        pagePermission: 'identity.user.page',
        component: UsersPage,
      },
      {
        id: 'roles',
        translationKey: 'navigation.roles',
        icon: ShieldCheck,
        to: '/roles',
        pagePermission: 'identity.role.page',
        component: RolesPage,
      },
      {
        id: 'resources',
        translationKey: 'navigation.resources',
        icon: Layers,
        to: '/resources',
        pagePermission: 'identity.resource.page',
        component: ResourcesPage,
      },
    ],
  },
  {
    translationKey: 'navigation.infrastructure',
    items: [
      {
        id: 'files',
        translationKey: 'navigation.files',
        icon: FileStack,
        to: '/files',
        pagePermission: 'infra.files.page',
        component: FilesPage,
      },
      {
        id: 'images',
        translationKey: 'navigation.images',
        icon: Images,
        to: '/images',
        pagePermission: 'infra.images.page',
        component: ImagesPage,
      },
    ],
  },
  {
    translationKey: 'navigation.workspace',
    items: [
      {
        id: 'notes',
        translationKey: 'navigation.notes',
        icon: NotebookPen,
        to: '/notes',
        pagePermission: 'workspace.notes.page',
        component: NotesPage,
      },
    ],
  },
];

export const routedNavigationItems = navigationGroups.flatMap(({ items }) => items);
