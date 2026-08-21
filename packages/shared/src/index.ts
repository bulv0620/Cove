export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  permissions: string[];
  roleCodes: string[];
  isSuperAdmin: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface SystemStatus {
  status: 'online';
}

export type UserStatus = 'ACTIVE' | 'DISABLED';
export type RoleStatus = 'ACTIVE' | 'DISABLED';
export type ResourceStatus = 'ACTIVE' | 'DISABLED';
export type PermissionType = 'PAGE' | 'ACTION';

export type ResourceModuleCode = 'identity' | 'infrastructure' | 'system';

export interface RoleReference {
  id: string;
  code: string;
  name: string;
}

export interface ResourceReference {
  id: string;
  code: string;
  module: string;
  name: string;
  icon: string | null;
  sortOrder: number;
}

export interface ResourceItem {
  id: string;
  code: string;
  module: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  status: ResourceStatus;
  permissionCount: number;
  pagePermission: PermissionSummary | null;
  actions: PermissionSummary[];
}

export interface PermissionSummary {
  id: string;
  code: string;
  action: string;
  name: string;
  description: string | null;
  type: PermissionType;
  parentId: string | null;
  sortOrder: number;
  status: 'ACTIVE' | 'DISABLED';
}

export interface CreateResourceRequest {
  module: ResourceModuleCode;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
}

export interface UpdateResourceRequest {
  name?: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
  status?: ResourceStatus;
}

export interface CreateResourceActionRequest {
  action: string;
  name: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateResourceActionRequest {
  name?: string;
  description?: string | null;
  sortOrder?: number;
  status?: 'ACTIVE' | 'DISABLED';
}

export interface ManagedUser {
  id: string;
  username: string;
  displayName: string | null;
  status: UserStatus;
  locale: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  isSuperAdmin: boolean;
  roles: RoleReference[];
}

export interface CreateUserRequest {
  username: string;
  displayName?: string;
  password: string;
  roleIds: string[];
}

export interface UpdateUserRequest {
  displayName?: string | null;
  locale?: string | null;
  status?: UserStatus;
  roleIds?: string[];
}

export interface UpdateUserProfileRequest {
  displayName?: string | null;
  locale?: string | null;
}

export interface ChangeUserStatusRequest {
  status: UserStatus;
}

export interface AssignRolesRequest {
  roleIds: string[];
}

export interface ResetPasswordRequest {
  password: string;
}

export interface PermissionItem {
  id: string;
  code: string;
  action: string;
  name: string;
  description: string | null;
  type: PermissionType;
  parentId: string | null;
  sortOrder: number;
  resourceId: string;
  resource: ResourceReference;
}

export interface ManagedRole {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: RoleStatus;
  isSystem: boolean;
  userCount: number;
  permissions: PermissionItem[];
}

export interface CreateRoleRequest {
  code: string;
  name: string;
  description?: string;
  permissionIds: string[];
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string | null;
  status?: RoleStatus;
  permissionIds?: string[];
}
