import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { statSync } from 'node:fs';
import path from 'node:path';

const API_PATH = /^\/api(?:\/|$|%2f)/i;
const PUBLIC_IMAGE_PATH = /^\/image(?:\/|$|%2f)/i;
const HASHED_ASSET_PATH = /^\/assets\//;
const DOTFILE_PATH = /(?:^|\/)\.[^/]/;

export function isPageNavigation(req: Pick<Request, 'method' | 'path' | 'accepts'>): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let requestPath: string;
  try {
    requestPath = decodeURIComponent(req.path);
  } catch {
    return false;
  }
  if (
    API_PATH.test(req.path) ||
    API_PATH.test(requestPath) ||
    PUBLIC_IMAGE_PATH.test(req.path) ||
    PUBLIC_IMAGE_PATH.test(requestPath)
  )
    return false;
  if (DOTFILE_PATH.test(requestPath)) return false;
  if (requestPath.startsWith('/assets/') || path.posix.extname(requestPath)) return false;
  return req.accepts('html') !== false;
}

export function configureStaticAssets(app: NestExpressApplication, configuredRoot?: string): void {
  if (!configuredRoot) return;

  const root = path.resolve(configuredRoot);
  const indexFile = path.join(root, 'index.html');
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`WEB_STATIC_ROOT is not a directory: ${root}`);
  }
  if (!statSync(indexFile, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Web entry file is missing: ${indexFile}`);
  }

  app.useStaticAssets(root, {
    dotfiles: 'deny',
    fallthrough: true,
    index: false,
    redirect: false,
    setHeaders: (response, filePath) => {
      const relativePath = `/${path.relative(root, filePath).split(path.sep).join('/')}`;
      response.setHeader(
        'Cache-Control',
        HASHED_ASSET_PATH.test(relativePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (API_PATH.test(req.path) || PUBLIC_IMAGE_PATH.test(req.path)) return next();
    if (!isPageNavigation(req)) {
      res.status(404).type('text/plain').send('Not Found');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile, (error) => {
      if (error) next(error);
    });
  });
}
