import { Injectable } from '@nestjs/common';
import type { SystemStatus } from '@home-ops/shared';

@Injectable()
export class SystemService {
  getStatus(): SystemStatus {
    return { status: 'online' };
  }
}
