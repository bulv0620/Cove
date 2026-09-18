import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@cove/shared';
import { PrismaService } from '../../database/prisma.service';
import { PermissionStatus, RoleStatus, ScopeType, UserStatus } from '../../generated/prisma/enums';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAuthUser(userId: string): Promise<(AuthUser & { authVersion: number }) | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE },
      include: {
        roleAssignments: {
          where: {
            scopeType: ScopeType.GLOBAL,
            scopeId: '*',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            role: { status: RoleStatus.ACTIVE },
          },
          include: {
            role: {
              include: {
                permissions: {
                  where: {
                    permission: {
                      status: PermissionStatus.ACTIVE,
                      resource: { status: 'ACTIVE' },
                    },
                  },
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });
    if (!user) return null;

    const isSuperAdmin = user.isSuperAdmin;
    const hasAdministratorRole = user.roleAssignments.some(
      ({ role }) => role.code === 'administrator',
    );
    const roleCodes = user.roleAssignments.map(({ role }) => role.code).sort();
    const permissions =
      isSuperAdmin || hasAdministratorRole
        ? await this.prisma.permission
            .findMany({
              where: {
                status: PermissionStatus.ACTIVE,
                resource: { status: 'ACTIVE' },
              },
              select: { code: true },
            })
            .then((items) => items.map(({ code }) => code).sort())
        : [
            ...new Set(
              user.roleAssignments.flatMap(({ role }) =>
                role.permissions.map(({ permission }) => permission.code),
              ),
            ),
          ].sort();

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      authVersion: user.authVersion,
      permissions,
      roleCodes,
      isSuperAdmin,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
