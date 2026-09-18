import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditResult } from '../../generated/prisma/enums';

interface AuditEvent {
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  result?: AuditResult;
  ipAddress?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    event: AuditEvent,
    database: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await database.auditLog.create({
      data: {
        id: uuidv7(),
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        result: event.result,
        ipAddress: event.ipAddress,
        ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
      },
    });
  }
}
