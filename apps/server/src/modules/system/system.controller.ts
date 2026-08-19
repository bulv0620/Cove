import { Controller, Get, UseGuards } from '@nestjs/common';
import type { SystemStatus } from '@home-ops/shared';
import { RequireSuperAdmin } from '../../core/decorators/require-super-admin.decorator';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { SystemService } from './system.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('status')
  @RequireSuperAdmin()
  getStatus(): SystemStatus {
    return this.systemService.getStatus();
  }
}
