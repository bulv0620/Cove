import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateResourceActionRequest,
  CreateResourceRequest,
  PermissionSummary,
  ResourceItem,
  UpdateResourceActionRequest,
  UpdateResourceRequest,
} from '@home-ops/shared';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { PermissionStatus, PermissionType, ResourceStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';

interface ActorContext {
  id: string;
  ipAddress?: string;
}

@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ResourceItem[]> {
    const resources = await this.prisma.resource.findMany({
      orderBy: [{ module: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        permissions: { orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { action: 'asc' }] },
        _count: {
          select: { permissions: { where: { status: PermissionStatus.ACTIVE } } },
        },
      },
    });
    return resources.map((resource) => this.toResourceItem(resource));
  }

  async create(input: CreateResourceRequest, actor: ActorContext): Promise<ResourceItem> {
    const module = input.module;
    const code = `${module}.${input.key.trim()}`;
    try {
      const resource = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.resource.create({
          data: {
            id: uuidv7(),
            code,
            module,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            icon: input.icon?.trim() || null,
            sortOrder: input.sortOrder ?? 0,
          },
          select: { id: true, code: true },
        });
        await transaction.permission.create({
          data: {
            id: uuidv7(),
            code: `${created.code}.page`,
            action: 'page',
            name: input.name.trim(),
            description: input.description?.trim() || null,
            type: PermissionType.PAGE,
            sortOrder: 0,
            resourceId: created.id,
          },
        });
        return created;
      });
      await this.audit.record({
        actorUserId: actor.id,
        action: 'identity.resource.create',
        targetType: 'RESOURCE',
        targetId: resource.id,
        ipAddress: actor.ipAddress,
        metadata: { code, module },
      });
      return (await this.list()).find(({ id }) => id === resource.id)!;
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error))
        throw new ConflictException('Resource code already exists.');
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateResourceRequest,
    actor: ActorContext,
  ): Promise<ResourceItem> {
    const existing = await this.prisma.resource.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Resource not found.');
    await this.prisma.resource.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.description === undefined
          ? {}
          : { description: input.description?.trim() || null }),
        ...(input.icon === undefined ? {} : { icon: input.icon?.trim() || null }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
    });
    if (input.name !== undefined || input.description !== undefined) {
      await this.prisma.permission.updateMany({
        where: { resourceId: id, type: PermissionType.PAGE },
        data: {
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.description === undefined
            ? {}
            : { description: input.description?.trim() || null }),
        },
      });
    }
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.resource.update',
      targetType: 'RESOURCE',
      targetId: id,
      ipAddress: actor.ipAddress,
      metadata: { code: existing.code },
    });
    return (await this.list()).find(({ id: resourceId }) => resourceId === id)!;
  }

  async remove(id: string, actor: ActorContext): Promise<void> {
    const resource = await this.prisma.resource.findUnique({ where: { id } });
    if (!resource) throw new NotFoundException('Resource not found.');
    await this.prisma.$transaction([
      this.prisma.permission.deleteMany({ where: { resourceId: id } }),
      this.prisma.resource.delete({ where: { id } }),
    ]);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.resource.delete',
      targetType: 'RESOURCE',
      targetId: id,
      ipAddress: actor.ipAddress,
      metadata: { code: resource.code },
    });
  }

  async createAction(
    resourceId: string,
    input: CreateResourceActionRequest,
    actor: ActorContext,
  ): Promise<PermissionSummary> {
    const resource = await this.prisma.resource.findFirst({
      where: { id: resourceId },
      include: { permissions: { where: { type: PermissionType.PAGE }, take: 1 } },
    });
    if (!resource) throw new NotFoundException('Resource not found.');
    const page = resource.permissions[0];
    if (!page) throw new ConflictException('The resource has no page permission.');
    const action = input.action.trim();
    const code = `${resource.code}.${action}`;
    if (action === 'page') throw new BadRequestException('The action code "page" is reserved.');
    if (code.length > 128)
      throw new BadRequestException('The generated permission code is too long.');
    try {
      const permission = await this.prisma.permission.create({
        data: {
          id: uuidv7(),
          code,
          action,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          type: PermissionType.ACTION,
          parentId: page.id,
          sortOrder: input.sortOrder ?? 0,
          resourceId,
        },
      });
      await this.audit.record({
        actorUserId: actor.id,
        action: 'identity.resource.action.create',
        targetType: 'PERMISSION',
        targetId: permission.id,
        ipAddress: actor.ipAddress,
        metadata: { code: permission.code, resourceId },
      });
      return this.toPermissionSummary(permission);
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error))
        throw new ConflictException('Action code already exists.');
      throw error;
    }
  }

  async updateAction(
    resourceId: string,
    actionId: string,
    input: UpdateResourceActionRequest,
    actor: ActorContext,
  ): Promise<PermissionSummary> {
    const existing = await this.prisma.permission.findFirst({
      where: { id: actionId, resourceId, type: PermissionType.ACTION },
    });
    if (!existing) throw new NotFoundException('Resource action not found.');
    const permission = await this.prisma.permission.update({
      where: { id: actionId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.description === undefined
          ? {}
          : { description: input.description?.trim() || null }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.resource.action.update',
      targetType: 'PERMISSION',
      targetId: actionId,
      ipAddress: actor.ipAddress,
      metadata: { code: existing.code, resourceId },
    });
    return this.toPermissionSummary(permission);
  }

  async removeAction(resourceId: string, actionId: string, actor: ActorContext): Promise<void> {
    const permission = await this.prisma.permission.findFirst({
      where: { id: actionId, resourceId, type: PermissionType.ACTION },
    });
    if (!permission) throw new NotFoundException('Resource action not found.');
    await this.prisma.permission.delete({ where: { id: actionId } });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.resource.action.delete',
      targetType: 'PERMISSION',
      targetId: actionId,
      ipAddress: actor.ipAddress,
      metadata: { code: permission.code, resourceId },
    });
  }

  private toResourceItem(resource: {
    id: string;
    code: string;
    module: string;
    name: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    status: ResourceStatus;
    permissions: Array<{
      id: string;
      code: string;
      action: string;
      name: string;
      description: string | null;
      type: PermissionType;
      parentId: string | null;
      sortOrder: number;
      status: PermissionStatus;
    }>;
    _count: { permissions: number };
  }): ResourceItem {
    return {
      id: resource.id,
      code: resource.code,
      module: resource.module,
      name: resource.name,
      description: resource.description,
      icon: resource.icon,
      sortOrder: resource.sortOrder,
      status: resource.status,
      permissionCount: resource._count.permissions,
      pagePermission: resource.permissions.find(({ type }) => type === PermissionType.PAGE)
        ? this.toPermissionSummary(
            resource.permissions.find(({ type }) => type === PermissionType.PAGE)!,
          )
        : null,
      actions: resource.permissions
        .filter(({ type }) => type === PermissionType.ACTION)
        .map((permission) => this.toPermissionSummary(permission)),
    };
  }

  private toPermissionSummary(permission: {
    id: string;
    code: string;
    action: string;
    name: string;
    description: string | null;
    type: PermissionType;
    parentId: string | null;
    sortOrder: number;
    status: PermissionStatus;
  }): PermissionSummary {
    return {
      id: permission.id,
      code: permission.code,
      action: permission.action,
      name: permission.name,
      description: permission.description,
      type: permission.type,
      parentId: permission.parentId,
      sortOrder: permission.sortOrder,
      status: permission.status,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
