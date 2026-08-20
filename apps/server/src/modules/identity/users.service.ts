import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AssignRolesRequest,
  AuthUser,
  ChangeUserStatusRequest,
  CreateUserRequest,
  ManagedUser,
  ResetPasswordRequest,
  UpdateUserProfileRequest,
} from '@home-ops/shared';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import { PermissionStatus, RoleStatus, ScopeType, UserStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';

interface ActorContext extends AuthUser {
  ipAddress?: string;
}

const passwordHashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findForAuthentication(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      include: { passwordCredential: true },
    });
  }

  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async list(): Promise<ManagedUser[]> {
    const users = await this.prisma.user.findMany({
      include: {
        roleAssignments: {
          where: { scopeType: ScopeType.GLOBAL, scopeId: '*' },
          include: { role: true },
        },
      },
      orderBy: [{ isSuperAdmin: 'desc' }, { status: 'asc' }, { username: 'asc' }],
    });
    return users.map((user) => this.toManagedUser(user));
  }

  async create(input: CreateUserRequest, actor: ActorContext): Promise<ManagedUser> {
    const roles = await this.ensureAssignableRoles(input.roleIds, actor);
    const passwordHash = await argon2.hash(input.password, passwordHashOptions);
    try {
      const user = await this.prisma.user.create({
        data: {
          id: uuidv7(),
          username: input.username.trim(),
          displayName: input.displayName?.trim() || null,
          passwordCredential: { create: { passwordHash } },
          roleAssignments: {
            create: roles.map(({ id }) => ({
              id: uuidv7(),
              roleId: id,
              assignedBy: actor.id,
              scopeType: ScopeType.GLOBAL,
              scopeId: '*',
            })),
          },
        },
        select: { id: true },
      });
      await this.audit.record({
        actorUserId: actor.id,
        action: 'identity.user.create',
        targetType: 'USER',
        targetId: user.id,
        ipAddress: actor.ipAddress,
        metadata: { username: input.username },
      });
      return await this.getManagedUser(user.id);
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error))
        throw new ConflictException('Username already exists.');
      throw error;
    }
  }

  async updateProfile(
    id: string,
    input: UpdateUserProfileRequest,
    actor: ActorContext,
  ): Promise<ManagedUser> {
    const user = await this.ensureUserExists(id);
    if (user.isSuperAdmin && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only a super administrator can change this account.');
    }
    await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.displayName === undefined
          ? {}
          : { displayName: input.displayName?.trim() || null }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
      },
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.user.update',
      targetType: 'USER',
      targetId: id,
      ipAddress: actor.ipAddress,
    });
    return this.getManagedUser(id);
  }

  async changeStatus(
    id: string,
    input: ChangeUserStatusRequest,
    actor: ActorContext,
  ): Promise<ManagedUser> {
    if (id === actor.id && input.status === UserStatus.DISABLED) {
      throw new ForbiddenException('You cannot disable your own account.');
    }
    const user = await this.ensureUserExists(id);
    if (user.isSuperAdmin && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only a super administrator can change this account.');
    }
    if (input.status === UserStatus.DISABLED && user.isSuperAdmin)
      throw new ConflictException('The platform super administrator cannot be disabled.');
    await this.prisma.user.update({
      where: { id },
      data: { status: input.status, authVersion: { increment: 1 } },
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.user.status',
      targetType: 'USER',
      targetId: id,
      ipAddress: actor.ipAddress,
      metadata: { status: input.status },
    });
    return this.getManagedUser(id);
  }

  async assignRoles(
    id: string,
    input: AssignRolesRequest,
    actor: ActorContext,
  ): Promise<ManagedUser> {
    const user = await this.ensureUserExists(id);
    if (user.isSuperAdmin && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only a super administrator can change this account.');
    }
    const roles = await this.ensureAssignableRoles(input.roleIds, actor);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.roleAssignment.deleteMany({
        where: { userId: id, scopeType: ScopeType.GLOBAL, scopeId: '*' },
      });
      await transaction.roleAssignment.createMany({
        data: roles.map((role) => ({
          id: uuidv7(),
          userId: id,
          roleId: role.id,
          assignedBy: actor.id,
          scopeType: ScopeType.GLOBAL,
          scopeId: '*',
        })),
      });
      await transaction.user.update({ where: { id }, data: { authVersion: { increment: 1 } } });
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.user.assign_role',
      targetType: 'USER',
      targetId: id,
      ipAddress: actor.ipAddress,
      metadata: { roleIds: input.roleIds },
    });
    return this.getManagedUser(id);
  }

  async resetPassword(id: string, input: ResetPasswordRequest, actor: ActorContext): Promise<void> {
    const user = await this.ensureUserExists(id);
    if (user.isSuperAdmin && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only a super administrator can change this account.');
    }
    const passwordHash = await argon2.hash(input.password, passwordHashOptions);
    await this.prisma.$transaction([
      this.prisma.passwordCredential.upsert({
        where: { userId: id },
        update: { passwordHash, passwordChangedAt: new Date() },
        create: { userId: id, passwordHash },
      }),
      this.prisma.user.update({ where: { id }, data: { authVersion: { increment: 1 } } }),
    ]);
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.user.reset_password',
      targetType: 'USER',
      targetId: id,
      ipAddress: actor.ipAddress,
    });
  }

  async remove(id: string, actor: ActorContext): Promise<void> {
    if (id === actor.id) {
      throw new ForbiddenException('You cannot delete your own account.');
    }
    const user = await this.ensureUserExists(id);
    if (user.isSuperAdmin) {
      throw new ConflictException('The platform super administrator cannot be deleted.');
    }
    await this.prisma.user.delete({ where: { id } });
    await this.audit.record({
      actorUserId: actor.id,
      action: 'identity.user.delete',
      targetType: 'USER',
      targetId: id,
      ipAddress: actor.ipAddress,
      metadata: { username: user.username },
    });
  }

  private async getManagedUser(id: string): Promise<ManagedUser> {
    const users = await this.list();
    const user = users.find((item) => item.id === id);
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  private ensureUserExists(id: string) {
    return this.prisma.user
      .findUnique({
        where: { id },
        include: {
          roleAssignments: {
            where: { scopeType: ScopeType.GLOBAL, scopeId: '*' },
            include: { role: true },
          },
        },
      })
      .then((user) => {
        if (!user) throw new NotFoundException('User not found.');
        return user;
      });
  }

  private async ensureAssignableRoles(roleIds: string[], actor: ActorContext) {
    const uniqueIds = [...new Set(roleIds)];
    const roles = await this.prisma.role.findMany({
      where: { id: { in: uniqueIds }, status: RoleStatus.ACTIVE },
      include: {
        permissions: {
          where: { permission: { status: PermissionStatus.ACTIVE } },
          include: { permission: true },
        },
      },
    });
    if (roles.length !== uniqueIds.length)
      throw new NotFoundException('One or more roles do not exist.');
    if (!actor.isSuperAdmin && roles.some(({ code }) => code === 'administrator')) {
      const allPermissionCodes = await this.prisma.permission.findMany({
        where: {
          status: PermissionStatus.ACTIVE,
          resource: { status: 'ACTIVE' },
        },
        select: { code: true },
      });
      if (allPermissionCodes.some(({ code }) => !actor.permissions.includes(code))) {
        throw new ForbiddenException('You cannot assign permissions that you do not hold.');
      }
    }
    if (
      !actor.isSuperAdmin &&
      roles.some((role) =>
        role.permissions.some(({ permission }) => !actor.permissions.includes(permission.code)),
      )
    ) {
      throw new ForbiddenException('You cannot assign permissions that you do not hold.');
    }
    return roles;
  }

  private toManagedUser(user: Awaited<ReturnType<UsersService['ensureUserExists']>>): ManagedUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      locale: user.locale,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      isSuperAdmin: user.isSuperAdmin,
      roles: user.roleAssignments
        .map(({ role }) => ({ id: role.id, code: role.code, name: role.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
