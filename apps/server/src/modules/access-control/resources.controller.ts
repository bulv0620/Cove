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
import type { AuthUser, PermissionSummary, ResourceItem } from '@home-ops/shared';
import type { Request } from 'express';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { CreateResourceDto } from './dto/create-resource.dto';
import { CreateResourceActionDto } from './dto/create-resource-action.dto';
import { UpdateResourceDto } from './dto/update-resource.dto';
import { UpdateResourceActionDto } from './dto/update-resource-action.dto';
import { ResourcesService } from './resources.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @RequirePermissions('identity.resource.page')
  @Get()
  list(): Promise<ResourceItem[]> {
    return this.resources.list();
  }

  @RequirePermissions('identity.resource.create')
  @Post()
  create(
    @Body() input: CreateResourceDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<ResourceItem> {
    return this.resources.create(input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.resource.create')
  @Post(':resourceId/actions')
  createAction(
    @Param('resourceId') resourceId: string,
    @Body() input: CreateResourceActionDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<PermissionSummary> {
    return this.resources.createAction(resourceId, input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.resource.update')
  @Patch(':resourceId/actions/:actionId')
  updateAction(
    @Param('resourceId') resourceId: string,
    @Param('actionId') actionId: string,
    @Body() input: UpdateResourceActionDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<PermissionSummary> {
    return this.resources.updateAction(resourceId, actionId, input, {
      ...actor,
      ipAddress: request.ip,
    });
  }

  @RequirePermissions('identity.resource.delete')
  @Delete(':resourceId/actions/:actionId')
  @HttpCode(204)
  async removeAction(
    @Param('resourceId') resourceId: string,
    @Param('actionId') actionId: string,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.resources.removeAction(resourceId, actionId, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.resource.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateResourceDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<ResourceItem> {
    return this.resources.update(id, input, { ...actor, ipAddress: request.ip });
  }

  @RequirePermissions('identity.resource.delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.resources.remove(id, { ...actor, ipAddress: request.ip });
  }
}
