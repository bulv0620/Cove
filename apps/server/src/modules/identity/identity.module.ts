import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AccessControlModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class IdentityModule {}
