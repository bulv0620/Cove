import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SUPER_ADMIN_KEY = 'home-ops:require-super-admin';

export const RequireSuperAdmin = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_SUPER_ADMIN_KEY, true);
