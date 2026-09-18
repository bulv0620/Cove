import { Injectable } from '@nestjs/common';
import type { SystemStatus } from '@cove/shared';

@Injectable()
export class SystemService {
  getStatus(): SystemStatus {
    return { status: 'online' };
  }
}
