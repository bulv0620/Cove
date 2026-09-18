import 'dotenv/config';
import { v7 as uuidv7 } from 'uuid';
import { createPrismaAdapter } from '../src/database/prisma-adapter';
import { PrismaClient } from '../src/generated/prisma/client';
import { PermissionStatus, PermissionType } from '../src/generated/prisma/enums';

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

const resources = [
  {
    id: '40000000-0000-7000-8000-000000000004',
    code: 'infra.files',
    module: 'infrastructure',
    name: 'Files',
    description: 'Personal SMB files.',
    icon: 'FileStack',
    sortOrder: 40,
  },
  {
    id: '40000000-0000-7000-8000-000000000005',
    code: 'infra.images',
    module: 'infrastructure',
    name: 'Image Hosting',
    description: 'SMB-backed private images and manually enabled public links.',
    icon: 'Images',
    sortOrder: 50,
  },
  {
    id: '40000000-0000-7000-8000-000000000001',
    code: 'identity.user',
    module: 'identity',
    name: 'User management',
    description: 'User accounts, profiles, and role assignments.',
    icon: 'Users',
    sortOrder: 10,
  },
  {
    id: '40000000-0000-7000-8000-000000000002',
    code: 'identity.role',
    module: 'identity',
    name: 'Role management',
    description: 'Roles and their permission grants.',
    icon: 'ShieldCheck',
    sortOrder: 20,
  },
  {
    id: '40000000-0000-7000-8000-000000000003',
    code: 'identity.resource',
    module: 'identity',
    name: 'Resource management',
    description: 'Permission groups that pages and actions are organized under.',
    icon: 'Layers',
    sortOrder: 30,
  },
] as const;

const permissions = [
  {
    id: '30000000-0000-7000-8000-000000000001',
    code: 'identity.user.page',
    resourceCode: 'identity.user',
    action: 'page',
    name: 'User management',
    description: 'Access the user management page.',
    type: PermissionType.PAGE,
    parentCode: null,
    sortOrder: 10,
  },
  {
    code: 'identity.user.create',
    resourceCode: 'identity.user',
    action: 'create',
    name: 'Create users',
    type: PermissionType.ACTION,
    parentCode: 'identity.user.page',
    sortOrder: 20,
  },
  {
    code: 'identity.user.update',
    resourceCode: 'identity.user',
    action: 'update',
    name: 'Update users',
    type: PermissionType.ACTION,
    parentCode: 'identity.user.page',
    sortOrder: 30,
  },
  {
    code: 'identity.user.disable',
    resourceCode: 'identity.user',
    action: 'disable',
    name: 'Enable or disable users',
    type: PermissionType.ACTION,
    parentCode: 'identity.user.page',
    sortOrder: 40,
  },
  {
    code: 'identity.user.reset_password',
    resourceCode: 'identity.user',
    action: 'reset_password',
    name: 'Reset passwords',
    type: PermissionType.ACTION,
    parentCode: 'identity.user.page',
    sortOrder: 50,
  },
  {
    code: 'identity.user.assign_role',
    resourceCode: 'identity.user',
    action: 'assign_role',
    name: 'Assign roles',
    type: PermissionType.ACTION,
    parentCode: 'identity.user.page',
    sortOrder: 60,
  },
  {
    code: 'identity.user.delete',
    resourceCode: 'identity.user',
    action: 'delete',
    name: 'Delete users',
    type: PermissionType.ACTION,
    parentCode: 'identity.user.page',
    sortOrder: 70,
  },
  {
    id: '30000000-0000-7000-8000-000000000002',
    code: 'identity.role.page',
    resourceCode: 'identity.role',
    action: 'page',
    name: 'Role management',
    description: 'Access the role management page.',
    type: PermissionType.PAGE,
    parentCode: null,
    sortOrder: 20,
  },
  {
    code: 'identity.role.create',
    resourceCode: 'identity.role',
    action: 'create',
    name: 'Create roles',
    type: PermissionType.ACTION,
    parentCode: 'identity.role.page',
    sortOrder: 20,
  },
  {
    code: 'identity.role.update',
    resourceCode: 'identity.role',
    action: 'update',
    name: 'Update roles',
    type: PermissionType.ACTION,
    parentCode: 'identity.role.page',
    sortOrder: 30,
  },
  {
    code: 'identity.role.delete',
    resourceCode: 'identity.role',
    action: 'delete',
    name: 'Delete roles',
    type: PermissionType.ACTION,
    parentCode: 'identity.role.page',
    sortOrder: 40,
  },
  {
    code: 'identity.role.grant',
    resourceCode: 'identity.role',
    action: 'grant',
    name: 'Grant role permissions',
    type: PermissionType.ACTION,
    parentCode: 'identity.role.page',
    sortOrder: 50,
  },
  {
    id: '30000000-0000-7000-8000-000000000005',
    code: 'identity.resource.page',
    resourceCode: 'identity.resource',
    action: 'page',
    name: 'Resource management',
    description: 'Access the resource management page.',
    type: PermissionType.PAGE,
    parentCode: null,
    sortOrder: 10,
  },
  {
    code: 'identity.resource.create',
    resourceCode: 'identity.resource',
    action: 'create',
    name: 'Create resources',
    type: PermissionType.ACTION,
    parentCode: 'identity.resource.page',
    sortOrder: 20,
  },
  {
    code: 'identity.resource.update',
    resourceCode: 'identity.resource',
    action: 'update',
    name: 'Update resources',
    type: PermissionType.ACTION,
    parentCode: 'identity.resource.page',
    sortOrder: 30,
  },
  {
    code: 'identity.resource.delete',
    resourceCode: 'identity.resource',
    action: 'delete',
    name: 'Delete resources',
    type: PermissionType.ACTION,
    parentCode: 'identity.resource.page',
    sortOrder: 40,
  },

  {
    code: 'identity.user.bind_smb',
    resourceCode: 'identity.user',
    action: 'bind_smb',
    name: 'Manage SMB bindings',
    type: PermissionType.ACTION,
    parentCode: 'identity.user.page',
    sortOrder: 80,
  },
  {
    code: 'infra.files.page',
    resourceCode: 'infra.files',
    action: 'page',
    name: 'Files',
    type: PermissionType.PAGE,
    parentCode: null,
    sortOrder: 10,
  },
  {
    code: 'infra.files.upload',
    resourceCode: 'infra.files',
    action: 'upload',
    name: 'Upload files',
    type: PermissionType.ACTION,
    parentCode: 'infra.files.page',
    sortOrder: 20,
  },
  {
    code: 'infra.files.download',
    resourceCode: 'infra.files',
    action: 'download',
    name: 'Download files',
    type: PermissionType.ACTION,
    parentCode: 'infra.files.page',
    sortOrder: 30,
  },
  {
    code: 'infra.files.mkdir',
    resourceCode: 'infra.files',
    action: 'mkdir',
    name: 'Create folders',
    type: PermissionType.ACTION,
    parentCode: 'infra.files.page',
    sortOrder: 40,
  },
  {
    code: 'infra.files.rename',
    resourceCode: 'infra.files',
    action: 'rename',
    name: 'Rename files and folders',
    type: PermissionType.ACTION,
    parentCode: 'infra.files.page',
    sortOrder: 50,
  },
  {
    code: 'infra.files.delete',
    resourceCode: 'infra.files',
    action: 'delete',
    name: 'Delete files and empty folders',
    type: PermissionType.ACTION,
    parentCode: 'infra.files.page',
    sortOrder: 60,
  },
  {
    code: 'infra.images.page',
    resourceCode: 'infra.images',
    action: 'page',
    name: 'Image Hosting',
    type: PermissionType.PAGE,
    parentCode: null,
    sortOrder: 10,
  },
  {
    code: 'infra.images.upload',
    resourceCode: 'infra.images',
    action: 'upload',
    name: 'Upload images',
    type: PermissionType.ACTION,
    parentCode: 'infra.images.page',
    sortOrder: 20,
  },
  {
    code: 'infra.images.publish',
    resourceCode: 'infra.images',
    action: 'publish',
    name: 'Manage public image links',
    type: PermissionType.ACTION,
    parentCode: 'infra.images.page',
    sortOrder: 30,
  },
  {
    code: 'infra.images.delete',
    resourceCode: 'infra.images',
    action: 'delete',
    name: 'Delete hosted images',
    type: PermissionType.ACTION,
    parentCode: 'infra.images.page',
    sortOrder: 40,
  },
] as const;

const deprecatedReadPermissionCodes = [
  'identity.user.read',
  'identity.role.read',
  'system.status.read',
  'audit.read',
] as const;

const roleDefinitions = [
  {
    id: '20000000-0000-7000-8000-000000000002',
    code: 'administrator',
    name: 'Administrator',
    description: 'Built-in role with all current and future managed permissions.',
    permissions: permissions.map(({ code }) => code),
  },
] as const;

async function seedRbac(): Promise<void> {
  const resourceIds = new Map<string, string>();
  for (const definition of resources) {
    const resource = await prisma.resource.upsert({
      where: { code: definition.code },
      update: {
        module: definition.module,
        name: definition.name,
        description: definition.description,
        icon: definition.icon,
        sortOrder: definition.sortOrder,
        status: 'ACTIVE',
      },
      create: {
        id: definition.id,
        code: definition.code,
        module: definition.module,
        name: definition.name,
        description: definition.description,
        icon: definition.icon,
        sortOrder: definition.sortOrder,
      },
      select: { id: true },
    });
    resourceIds.set(definition.code, resource.id);
  }

  const permissionIds = new Map<string, string>();
  for (const definition of permissions) {
    const parentId = definition.parentCode ? permissionIds.get(definition.parentCode) : undefined;
    if (definition.parentCode && !parentId) {
      throw new Error(`Permission parent was not seeded: ${definition.parentCode}`);
    }
    const resourceId = resourceIds.get(definition.resourceCode);
    if (!resourceId) {
      throw new Error(`Permission resource was not seeded: ${definition.resourceCode}`);
    }
    const permission = await prisma.permission.upsert({
      where: { code: definition.code },
      update: {
        action: definition.action,
        name: definition.name,
        description: 'description' in definition ? definition.description : null,
        type: definition.type,
        parentId: parentId ?? null,
        sortOrder: definition.sortOrder,
        status: 'ACTIVE',
        resourceId,
      },
      create: {
        id: 'id' in definition ? definition.id : uuidv7(),
        code: definition.code,
        action: definition.action,
        name: definition.name,
        description: 'description' in definition ? definition.description : null,
        type: definition.type,
        parentId: parentId ?? null,
        sortOrder: definition.sortOrder,
        resourceId,
      },
      select: { id: true },
    });
    permissionIds.set(definition.code, permission.id);
  }

  await prisma.permission.updateMany({
    where: { code: { in: [...deprecatedReadPermissionCodes] } },
    data: { status: PermissionStatus.DISABLED, parentId: null },
  });

  await prisma.role.deleteMany({ where: { code: { in: ['super_admin', 'viewer'] } } });

  for (const definition of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { code: definition.code },
      update: {
        name: definition.name,
        description: definition.description,
        isSystem: true,
        status: 'ACTIVE',
      },
      create: {
        id: definition.id,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
    });
    const grantedPermissions = await prisma.permission.findMany({
      where: { code: { in: [...definition.permissions] } },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: grantedPermissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
      }),
    ]);
  }

  await prisma.user.updateMany({ data: { authVersion: { increment: 1 } } });

  console.log('RBAC seed complete.');
}

seedRbac()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'RBAC seed failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
