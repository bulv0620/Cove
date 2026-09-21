import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { FilesModule } from '../files/files.module';
import { NotesConfig } from './notes-config';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  imports: [AccessControlModule, FilesModule],
  controllers: [NotesController],
  providers: [NotesConfig, NotesService],
  exports: [],
})
export class NotesModule {}
