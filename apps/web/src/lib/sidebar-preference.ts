import { readStored, writeStored } from '@/lib/storage';

const SIDEBAR_COLLAPSED_KEY = 'cove.sidebar.collapsed';

export function readSidebarCollapsed(): boolean {
  return readStored(SIDEBAR_COLLAPSED_KEY) === 'true';
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  writeStored(SIDEBAR_COLLAPSED_KEY, String(collapsed));
}
