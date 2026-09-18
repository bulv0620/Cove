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
import { FilesService } from './files.service';
import { SmbBindingsService } from './smb-bindings.service';
import { filesError } from './files-policy';

@Controller('users/:id/smb-binding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('identity.user.page', 'identity.user.bind_smb')
export class SmbBindingsController {
  constructor(private readonly bindings: SmbBindingsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string) {
    return this.bindings.summary(id);
  }
  @Post('test')
  @Header('Cache-Control', 'no-store')
  test(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.bindings.test(id, body, actor);
  }
  @Put()
  @Header('Cache-Control', 'no-store')
  save(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthUser) {
    return this.bindings.save(id, body, actor);
  }
  @Delete()
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.bindings.remove(id, actor);
  }
}
@Controller('files')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('infra.files.page')
export class FilesController {
  constructor(private readonly files: FilesService) {}
  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@CurrentUser() actor: AuthUser) {
    return this.files.status(actor);
  }
  @Get('entries')
  @Header('Cache-Control', 'no-store')
  entries(@CurrentUser() actor: AuthUser, @Query() query: Record<string, unknown>) {
    return this.files.entries(actor, query);
  }
  @Get('stat')
  @Header('Cache-Control', 'no-store')
  stat(@CurrentUser() actor: AuthUser, @Query('path') path: string) {
    return this.files.stat(actor, path);
  }
  @Post('directories')
  @RequirePermissions('infra.files.page', 'infra.files.mkdir')
  mkdir(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.files.mkdir(actor, body);
  }
  @Patch('entries')
  @RequirePermissions('infra.files.page', 'infra.files.rename')
  rename(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.files.rename(actor, body);
  }
  @Delete('entries')
  @RequirePermissions('infra.files.page', 'infra.files.delete')
  removeEntries(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.files.removeEntries(actor, body);
  }
  @Post('uploads')
  @RequirePermissions('infra.files.page', 'infra.files.upload')
  create(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.files.createUpload(actor, body);
  }
  @Put('uploads/:id/content')
  @RequirePermissions('infra.files.page', 'infra.files.upload')
  upload(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Req() request: Request) {
    return this.files.upload(actor, id, request);
  }
  @Get('operations')
  @Header('Cache-Control', 'no-store')
  recent(@CurrentUser() actor: AuthUser) {
    return this.files.recent(actor);
  }
  @Get('operations/:id')
  @Header('Cache-Control', 'no-store')
  operation(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.files.operation(actor, id);
  }
  @Delete('uploads/:id')
  cancel(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.files.cancel(actor, id);
  }
  @Post('download-tickets')
  @RequirePermissions('infra.files.page', 'infra.files.download')
  @Header('Cache-Control', 'no-store')
  async ticket(
    @CurrentUser() actor: AuthUser,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      !this.files.config.secureCookie &&
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
    )
      throw filesError('SMB_SECURITY_REQUIRED');
    const ticket = await this.files.ticket(actor, body);
    response.cookie('files_download', ticket.secret, {
      path: ticket.url,
      httpOnly: true,
      secure: this.files.config.secureCookie,
      sameSite: 'strict',
      maxAge: 60000,
    });
    return { url: ticket.url };
  }
}
// This route uses a single-use scoped cookie, not an anonymous bypass of JWT authentication.
@Controller('files/downloads')
export class FilesDownloadController {
  constructor(private readonly files: FilesService) {}
  @Get(':id/content')
  async content(@Param('id') id: string, @Req() request: Request, @Res() response: Response) {
    const value =
      request.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('files_download='))
        ?.slice('files_download='.length) ?? '';
    response.clearCookie('files_download', {
      path: `/api/files/downloads/${id}/content`,
      httpOnly: true,
      sameSite: 'strict',
      secure: this.files.config.secureCookie,
    });
    await this.files.download(id, value, response);
  }
}
