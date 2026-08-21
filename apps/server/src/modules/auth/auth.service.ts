import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '../../generated/prisma/enums';
import type {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
} from '@home-ops/shared';
import argon2 from 'argon2';
import { PermissionsService } from '../access-control/permissions.service';
import { UsersService } from '../identity/users.service';

interface JwtPayload {
  sub: string;
  av: number;
}

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = argon2.hash('home-ops-invalid-password-sentinel', {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const username = credentials.username.trim();
    const databaseUser = await this.usersService.findForAuthentication(username);
    const passwordHash = databaseUser?.passwordCredential?.passwordHash ?? this.dummyPasswordHash;
    const isPasswordValid = await argon2.verify(await passwordHash, credentials.password);
    const isValid =
      databaseUser !== null &&
      databaseUser.status === UserStatus.ACTIVE &&
      databaseUser.passwordCredential !== null &&
      isPasswordValid;

    if (!isValid) {
      throw new UnauthorizedException('Invalid username or password.');
    }

    const user = await this.permissionsService.getAuthUser(databaseUser.id);
    if (!user) throw new UnauthorizedException();
    const payload: JwtPayload = { sub: user.id, av: user.authVersion };
    await this.usersService.recordSuccessfulLogin(user.id);

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: this.toPublicAuthUser(user),
    };
  }

  async validatePayload(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.permissionsService.getAuthUser(payload.sub);
    if (!user || user.authVersion !== payload.av) throw new UnauthorizedException();
    return this.toPublicAuthUser(user);
  }

  changePassword(userId: string, input: ChangePasswordRequest, ipAddress?: string): Promise<void> {
    return this.usersService.changeOwnPassword(userId, input, ipAddress);
  }

  private toPublicAuthUser(user: AuthUser & { authVersion: number }): AuthUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      permissions: user.permissions,
      roleCodes: user.roleCodes,
      isSuperAdmin: user.isSuperAdmin,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
