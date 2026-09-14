import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { FilesConfig } from './files-config';
import { SmbAdapter } from './smb-adapter';
import { SmbBindingsService } from './smb-bindings.service';
import { FilesService } from './files.service';
import {
  FilesController,
  FilesDownloadController,
  SmbBindingsController,
} from './files.controller';
@Module({
  imports: [AccessControlModule],
  providers: [FilesConfig, SmbAdapter, SmbBindingsService, FilesService],
  controllers: [FilesController, FilesDownloadController, SmbBindingsController],
})
export class FilesModule {}
