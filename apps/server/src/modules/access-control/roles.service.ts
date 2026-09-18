import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateRoleRequest,
  ManagedRole,
  PermissionItem,
  UpdateRoleRequest,
} from '@cove/shared';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { PermissionStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';

interface ActorContext {
  id: string;
  isSuperAdmin: boolean;
  permissions: string[];
  ipAddress?: string;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listPermissions(): Promise<PermissionItem[]> {
    return this.prisma.permission.findMany({
      where: {
        status: PermissionStatus.ACTIVE,
        resource: { status: 'ACTIVE' },
      },
      orderBy: [
        { resource: { module: 'asc' } },
        { resource: { sortOrder: 'asc' } },
        { resourceId: 'asc' },
        { sortOrder: 'asc' },
        { action: 'asc' },
      ],
      select: {
        id: true,
        code: true,
        action: true,
        name: true,
        description: true,
        type: true,
        parentId: true,
        sortOrder: true,
        resourceId: true,
        resource: {
          select: {
            id: true,
            code: true,
            module: true,
            name: true,
            icon: true,
            sortOrder: true,
          },
        },
      },
    });
  }

  async listRoles(): Promise<ManagedRole[]> {
    const allPermissions = await this.listPermissions();
    const roles = await this.prisma.role.findMany({
      include: {
        permissions: {
          where: {
            permission: {
              status: PermissionStatus.ACTIVE,
              resource: { status: 'ACTIVE' },
            },
          },
          include: { permission: { include: { resource: true } } },
        },
        _count: { select: { roleAssignments: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      status: role.status,
      isSystem: role.isSystem,
      userCount: role._count.roleAssignments,
      permissions:
        role.code === 'administrator'
          ? allPermissions
          : role.permissions
              .map(({ permission }) => ({
                id: permission.id,
                code: permission.code,
                action: permission.action,
                name: permission.name,
                description: permission.description,
                type: permission.type,
                parentId: permission.parentId,
                sortOrder: permission.sortOrder,
                resourceId: permission.resourceId,
                resource: {
                  id: permission.resource.id,
                  code: permission.resource.code,
                  module: permission.resource.module,
                  name: permission.resource.name,
                  icon: permission.resource.icon,
                  sortOrder: permission.resource.sortOrder,
                },
              }))
              .sort((left, right) => left.code.localeCompare(right.code)),
    }));
  }

  async create(input: CreateRoleRequest, actor: ActorContext): Promise<ManagedRole> {
    const permissionIds = await this.normalizeGrantablePermissionIds(input.permissionIds, actor);
    try {
      const role = await this.prisma.role.create({
        data: {
          id: uuidv7(),
          code: input.code.trim(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          createdBy: actor.id,
          permissions: {
            create: permissionIds.map((permissionId) => ({
              permissionId,
              grantedBy: actor.id,
            })),
          },
        },
        select: { id: true },
      });
      await this.audit.record({
        actorUserId: actor.id,
        action: 'identity.role.create',
        targetType: 'ROLE',
        targetId: role.id,
        ipAddress: actor.ipAddress,
        metadata: { code: input.code },
      });
      return (await this.listRoles()).find(({ id }) => id === role.id)!;
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error))
        throw new ConflictException('Role code already exists.');
      throw error;
    }
  }

  async update(id: string, input: UpdateRoleRequest, actor: ActorContext): Promise<ManagedRole> {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role not found.');
    if (existing.isSystem) throw new ForbiddenException('System roles cannot be modified.');
    const permissionIds = input.permissionIds
      ? await this.normalizeGrantablePermissionIds(input.permissionIds, actor)
      : undefined;

    await this.prisma.$transaction(async (transaction) => {
      await transaction.role.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.description === undefined
            ? {}
            : { description: input.description?.trim() || null }),
          ...(input.status === undefined ? {} : { status: input.status }),
        },
      });
      if (permissionIds) {
        await transaction.rolePermission.deleteMany({ where: { roleId: id } });
        await transaction.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId: id,
            permissionId,
            grantedBy: actor.id,
          })),
        });
      }
      if (input.permissionIds || input.status !== undefined) {
        await transaction.user.updateMany({
          where: { roleAssignments: { some: { roleId: id } } },
          data: { authVersion: { increment: 1 } },
        });
      }
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.role.update',
      targetType: 'ROLE',
      targetId: id,
      ipAddress: actor.ipAddress,
    });
    return (await this.listRoles()).find((role) => role.id === id)!;
  }

  async remove(id: string, actor: ActorContext): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { roleAssignments: true } } },
    });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted.');
    if (role._count.roleAssignments > 0) {
      throw new ConflictException('Remove this role from all users before deleting it.');
    }
    await this.prisma.role.delete({ where: { id } });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.role.delete',
      targetType: 'ROLE',
      targetId: id,
      ipAddress: actor.ipAddress,
      metadata: { code: role.code },
    });
  }

  private async ensurePermissionIds(permissionIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(permissionIds)];
    const count = await this.prisma.permission.count({
      where: { id: { in: uniqueIds }, status: PermissionStatus.ACTIVE },
    });
    if (count !== uniqueIds.length)
      throw new NotFoundException('One or more permissions do not exist.');
  }

  private async normalizeGrantablePermissionIds(
    permissionIds: string[],
    actor: ActorContext,
  ): Promise<string[]> {
    await this.ensurePermissionIds(permissionIds);
    const requestedPermissions = await this.prisma.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true, parentId: true },
    });
    const normalizedIds = [
      ...new Set([
        ...permissionIds,
        ...requestedPermissions.flatMap(({ parentId }) => (parentId ? [parentId] : [])),
      ]),
    ];
    if (actor.isSuperAdmin) return normalizedIds;
    const permissions = await this.prisma.permission.findMany({
      where: { id: { in: normalizedIds } },
      select: { code: true },
    });
    if (permissions.some(({ code }) => !actor.permissions.includes(code))) {
      throw new ForbiddenException('You cannot grant permissions that you do not hold.');
    }
    return normalizedIds;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
