import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser, ManagedRole, PermissionItem } from '@cove/shared';
import type { Request } from 'express';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermissions('identity.role.page')
  @Get()
  list(): Promise<ManagedRole[]> {
    return this.roles.listRoles();
  }

  @RequirePermissions('identity.role.page')
  @Get('permissions')
  listPermissions(): Promise<PermissionItem[]> {
    return this.roles.listPermissions();
  }

  @RequirePermissions('identity.role.create', 'identity.role.grant')
  @Post()
  create(
    @Body() input: CreateRoleDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<ManagedRole> {
    return this.roles.create(input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.role.update', 'identity.role.grant')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateRoleDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<ManagedRole> {
    return this.roles.update(id, input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.role.delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.roles.remove(id, { ...actor, ipAddress: request.ip });
  }
}
