import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '@cove/shared';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { ClientIpService } from '../auth/client-ip.service';
import { ImagesService } from './images.service';

@Controller('images')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('infra.images.page')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@CurrentUser() actor: AuthUser) {
    return this.images.status(actor);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() actor: AuthUser, @Query() query: Record<string, unknown>) {
    return this.images.list(actor, query);
  }

  @Post('uploads')
  @RequirePermissions('infra.images.page', 'infra.images.upload')
  createUpload(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.images.createUpload(actor, body);
  }

  @Put('uploads/:id/content')
  @RequirePermissions('infra.images.page', 'infra.images.upload')
  upload(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Req() request: Request) {
    return this.images.upload(actor, id, request);
  }

  @Get('uploads/:id')
  uploadStatus(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.images.uploadStatus(actor, id);
  }

  @Delete('uploads/:id')
  cancelUpload(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.images.cancelUpload(actor, id);
  }

  @Patch(':id/visibility')
  @RequirePermissions('infra.images.page', 'infra.images.publish')
  visibility(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.images.visibility(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('infra.images.page', 'infra.images.delete')
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.images.remove(actor, id);
  }

  @Get(':id/preview')
  preview(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Res() response: Response) {
    return this.images.preview(actor, id, response);
  }

  @Get(':id/thumbnail')
  thumbnail(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Res() response: Response) {
    return this.images.thumbnail(actor, id, response);
  }
}

@Controller('image')
export class PublicImagesController {
  constructor(
    private readonly images: ImagesService,
    private readonly clientIp: ClientIpService,
  ) {}

  @Get(':publicId')
  content(@Param('publicId') publicId: string, @Req() request: Request, @Res() response: Response) {
    return this.images.publicContent(
      publicId,
      this.clientIp.resolve(request).throttleValue,
      typeof request.headers['if-none-match'] === 'string'
        ? request.headers['if-none-match']
        : null,
      response,
    );
  }
}
