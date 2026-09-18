import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { ImagesController, PublicImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Module({
  imports: [AccessControlModule, AuthModule, FilesModule],
  controllers: [ImagesController, PublicImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}
