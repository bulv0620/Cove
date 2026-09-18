import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getJwtSecret } from '../../core/config/jwt.config';
import { AccessControlModule } from '../access-control/access-control.module';
import { IdentityModule } from '../identity/identity.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClientIpService } from './client-ip.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginThrottleConfig } from './login-throttle.config';
import { LoginThrottleService } from './login-throttle.service';

@Module({
  imports: [
    PassportModule,
    AccessControlModule,
    IdentityModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getJwtSecret(config),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LoginThrottleConfig, LoginThrottleService, ClientIpService],
  exports: [ClientIpService],
})
export class AuthModule {}
