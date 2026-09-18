import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { AuthUser, LoginResponse } from '@cove/shared';
import type { Request, Response } from 'express';
import { AllowPasswordChangeRequired } from '../../core/decorators/allow-password-change-required.decorator';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { ClientIpService } from './client-ip.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { LoginRateLimitedException } from './login-rate-limited.exception';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly clientIp: ClientIpService,
  ) {}

  @Post('login')
  async login(
    @Body() credentials: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    try {
      return await this.authService.login(credentials, this.clientIp.resolve(request));
    } catch (error) {
      if (error instanceof LoginRateLimitedException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangeRequired()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @Body() input: ChangePasswordDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.authService.changePassword(user.id, input, request.ip);
  }

  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangeRequired()
  @Get('me')
  getCurrentUser(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
