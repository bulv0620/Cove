import { FilesModule } from './modules/files/files.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { SystemModule } from './modules/system/system.module';
import { ImagesModule } from './modules/images/images.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    SystemModule,
    FilesModule,
    ImagesModule,
  ],
})
export class AppModule {}
