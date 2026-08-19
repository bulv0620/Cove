import type { ConfigService } from '@nestjs/config';

const DEVELOPMENT_SECRET = 'home-ops-development-only-secret-change-me';

export function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (secret) return secret;

  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error('JWT_SECRET must be set in production.');
  }

  return DEVELOPMENT_SECRET;
}
