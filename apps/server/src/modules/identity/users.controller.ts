import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  AuthUser,
  CreateUserResponse,
  ManagedUser,
  ResetPasswordResponse,
} from '@cove/shared';
import type { Request } from 'express';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { ChangeUserStatusDto } from './dto/change-user-status.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions('identity.user.page')
  @Get()
  list(): Promise<ManagedUser[]> {
    return this.users.list();
  }

  @RequirePermissions('identity.user.create', 'identity.user.assign_role')
  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @Body() input: CreateUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<CreateUserResponse> {
    return this.users.create(input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.user.update')
  @Patch(':id')
  updateProfile(
    @Param('id') id: string,
    @Body() input: UpdateUserProfileDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ) {
    return this.users.updateProfile(id, input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.user.disable')
  @Patch(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body() input: ChangeUserStatusDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ) {
    return this.users.changeStatus(id, input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.user.assign_role')
  @Put(':id/roles')
  assignRoles(
    @Param('id') id: string,
    @Body() input: AssignRolesDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ) {
    return this.users.assignRoles(id, input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.user.reset_password')
  @Post(':id/reset-password')
  @Header('Cache-Control', 'no-store')
  async resetPassword(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<ResetPasswordResponse> {
    return this.users.resetPassword(id, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.user.delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.users.remove(id, { ...actor, ipAddress: request.ip });
  }
}
