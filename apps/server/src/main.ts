import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import { FilesConfig } from './modules/files/files-config';
import { filesEvents } from './modules/files/files-events';
import { NotesConfig } from './modules/notes/notes-config';
import { AppModule } from './app.module';
import { configureStaticAssets } from './static-assets';
import type { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Note bodies travel as JSON; allow the escaped worst case of the size limit.
  app.useBodyParser('json', {
    limit: app.get(NotesConfig).maxNoteBytes * 3 + 65_536,
  });

  // Transfers are bounded by byte limits and inactivity, not a fixed total duration.
  const httpServer = app.getHttpServer() as Server;
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 60_000;
  const idleTimeout = Math.max(120_000, app.get(FilesConfig).idleTimeout * 2);
  app.enableShutdownHooks();
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.setTimeout(idleTimeout, () => req.destroy());
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      /^\/api\/(users|roles|resources|auth)(\/|$)/.test(req.path)
    ) {
      res.once('finish', () => filesEvents.emit('recheck'));
    }
    next();
  });
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'image/:publicId', method: RequestMethod.GET }],
  });
  app.enableCors({ origin: true, credentials: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  configureStaticAssets(app, config.get<string>('WEB_STATIC_ROOT'));

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}

void bootstrap();
