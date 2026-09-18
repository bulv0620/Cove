import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthUser, LoginResponse } from '@cove/shared';
import type { Request } from 'express';
import { AllowPasswordChangeRequired } from '../../core/decorators/allow-password-change-required.decorator';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() credentials: LoginDto): Promise<LoginResponse> {
    return this.authService.login(credentials);
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
