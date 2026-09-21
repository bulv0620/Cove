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
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '@cove/shared';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { NotesService } from './notes.service';

@Controller('notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('workspace.notes.page')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@CurrentUser() actor: AuthUser) {
    return this.notes.status(actor);
  }

  @Get('entries')
  @Header('Cache-Control', 'no-store')
  entries(@CurrentUser() actor: AuthUser, @Query() query: Record<string, unknown>) {
    return this.notes.entries(actor, query);
  }

  @Get('content')
  @Header('Cache-Control', 'no-store')
  content(@CurrentUser() actor: AuthUser, @Query() query: Record<string, unknown>) {
    return this.notes.content(actor, query);
  }

  @Post()
  @RequirePermissions('workspace.notes.page', 'workspace.notes.create')
  create(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.notes.createFile(actor, body);
  }

  @Post('folders')
  @RequirePermissions('workspace.notes.page', 'workspace.notes.create')
  createFolder(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.notes.createFolder(actor, body);
  }

  @Patch('content')
  @RequirePermissions('workspace.notes.page', 'workspace.notes.update')
  save(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.notes.save(actor, body);
  }

  @Patch('rename')
  @RequirePermissions('workspace.notes.page', 'workspace.notes.rename')
  rename(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.notes.rename(actor, body);
  }

  @Delete('entries')
  @HttpCode(204)
  @RequirePermissions('workspace.notes.page', 'workspace.notes.delete')
  remove(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.notes.remove(actor, body);
  }

  @Get('operations/:id')
  operation(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.notes.operation(actor, id);
  }
}
