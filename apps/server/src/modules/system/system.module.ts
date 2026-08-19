import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [AccessControlModule],
  controllers: [SystemController],
  providers: [SystemService],
})
export class SystemModule {}
