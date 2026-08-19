import type { SystemStatus } from '@home-ops/shared';
import { apiRequest } from '@/lib/api';

export const systemApi = {
  getStatus: (): Promise<SystemStatus> => apiRequest<SystemStatus>('/api/system/status'),
};
