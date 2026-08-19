import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { AuthUser } from '@home-ops/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '../../core/config/jwt.config';
import { AuthService } from './auth.service';

interface JwtPayload {
  sub: string;
  av: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(config),
    });
  }

  validate(payload: JwtPayload): Promise<AuthUser> {
    return this.authService.validatePayload(payload);
  }
}
