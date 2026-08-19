import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@home-ops/shared';
import type { Request } from 'express';

type AuthenticatedRequest = Request & { user: AuthUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
