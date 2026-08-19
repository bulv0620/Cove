import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@home-ops/shared';
import type { Request } from 'express';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { REQUIRE_SUPER_ADMIN_KEY } from '../decorators/require-super-admin.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresSuperAdmin = this.reflector.getAllAndOverride<boolean>(REQUIRE_SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiresSuperAdmin && !required?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException();
    if (requiresSuperAdmin && !user.isSuperAdmin) {
      throw new ForbiddenException('This action is restricted to super administrators.');
    }
    if (user.isSuperAdmin) return true;
    if (required?.some((permission) => !user.permissions.includes(permission))) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return true;
  }
}
