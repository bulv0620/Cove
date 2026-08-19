import type {
  AssignRolesRequest,
  ChangeUserStatusRequest,
  CreateResourceRequest,
  CreateResourceActionRequest,
  CreateRoleRequest,
  CreateUserRequest,
  ManagedRole,
  ManagedUser,
  PermissionItem,
  PermissionSummary,
  ResetPasswordRequest,
  ResourceItem,
  UpdateResourceRequest,
  UpdateResourceActionRequest,
  UpdateRoleRequest,
  UpdateUserProfileRequest,
} from './types';
import { apiRequest } from '@/lib/api';

export const usersApi = {
  list: (): Promise<ManagedUser[]> => apiRequest('/api/users'),
  create: (input: CreateUserRequest): Promise<ManagedUser> =>
    apiRequest('/api/users', { method: 'POST', body: JSON.stringify(input) }),
  updateProfile: (id: string, input: UpdateUserProfileRequest): Promise<ManagedUser> =>
    apiRequest(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  changeStatus: (id: string, input: ChangeUserStatusRequest): Promise<ManagedUser> =>
    apiRequest(`/api/users/${id}/status`, { method: 'PATCH', body: JSON.stringify(input) }),
  assignRoles: (id: string, input: AssignRolesRequest): Promise<ManagedUser> =>
    apiRequest(`/api/users/${id}/roles`, { method: 'PUT', body: JSON.stringify(input) }),
  resetPassword: (id: string, input: ResetPasswordRequest): Promise<void> =>
    apiRequest(`/api/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (id: string): Promise<void> => apiRequest(`/api/users/${id}`, { method: 'DELETE' }),
};

export const rolesApi = {
  list: (): Promise<ManagedRole[]> => apiRequest('/api/roles'),
  permissions: (): Promise<PermissionItem[]> => apiRequest('/api/roles/permissions'),
  create: (input: CreateRoleRequest): Promise<ManagedRole> =>
    apiRequest('/api/roles', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateRoleRequest): Promise<ManagedRole> =>
    apiRequest(`/api/roles/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string): Promise<void> => apiRequest(`/api/roles/${id}`, { method: 'DELETE' }),
};

export const resourcesApi = {
  list: (): Promise<ResourceItem[]> => apiRequest('/api/resources'),
  create: (input: CreateResourceRequest): Promise<ResourceItem> =>
    apiRequest('/api/resources', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateResourceRequest): Promise<ResourceItem> =>
    apiRequest(`/api/resources/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string): Promise<void> => apiRequest(`/api/resources/${id}`, { method: 'DELETE' }),
  createAction: (
    resourceId: string,
    input: CreateResourceActionRequest,
  ): Promise<PermissionSummary> =>
    apiRequest(`/api/resources/${resourceId}/actions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAction: (
    resourceId: string,
    actionId: string,
    input: UpdateResourceActionRequest,
  ): Promise<PermissionSummary> =>
    apiRequest(`/api/resources/${resourceId}/actions/${actionId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        sortOrder: input.sortOrder,
        status: input.status,
      }),
    }),
  removeAction: (resourceId: string, actionId: string): Promise<void> =>
    apiRequest(`/api/resources/${resourceId}/actions/${actionId}`, { method: 'DELETE' }),
};
