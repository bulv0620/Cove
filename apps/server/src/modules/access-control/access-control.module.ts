import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { PermissionsService } from './permissions.service';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [ResourcesController, RolesController],
  providers: [PermissionsService, PermissionsGuard, ResourcesService, RolesService],
  exports: [PermissionsService, PermissionsGuard],
})
export class AccessControlModule {}
