import type {
  FileEntriesResponse,
  FileEntry,
  FileDeleteResponse,
  FileOperationSummary,
  FilesStatus,
  SmbBindingSummary,
} from '@cove/shared';
import { apiRequest, tokenStorage, ApiError } from '@/lib/api';
export const fileApiBase =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const post = <T>(path: string, body: unknown) =>
  apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const filesApi = {
  status: () => apiRequest<FilesStatus>('/api/files/status'),
  entries: (query: Record<string, string>) =>
    apiRequest<FileEntriesResponse>(`/api/files/entries?${new URLSearchParams(query)}`),
  mkdir: (parentPath: string, name: string) =>
    post<FileEntry>('/api/files/directories', { parentPath, name }),
  rename: (path: string, name: string) =>
    apiRequest<FileEntry>('/api/files/entries', {
      method: 'PATCH',
      body: JSON.stringify({ path, name }),
    }),
  remove: (paths: string[]) =>
    apiRequest<FileDeleteResponse>('/api/files/entries', {
      method: 'DELETE',
      body: JSON.stringify({ paths }),
    }),
  create: (parentPath: string, name: string, size: string, requestId: string) =>
    post<FileOperationSummary>('/api/files/uploads', { parentPath, name, size, requestId }),
  recent: () => apiRequest<FileOperationSummary[]>('/api/files/operations'),
  operation: (id: string) => apiRequest<FileOperationSummary>(`/api/files/operations/${id}`),
  cancel: (id: string) =>
    apiRequest<FileOperationSummary>(`/api/files/uploads/${id}`, { method: 'DELETE' }),
  ticket: (path: string) => post<{ url: string }>('/api/files/download-tickets', { path }),
  binding: (id: string) => apiRequest<SmbBindingSummary>(`/api/users/${id}/smb-binding`),
  test: (id: string, username: string, password: string) =>
    post(`/api/users/${id}/smb-binding/test`, { username, password }),
  bind: (id: string, username: string, password: string, expectedVersion: string | null) =>
    apiRequest<SmbBindingSummary>(`/api/users/${id}/smb-binding`, {
      method: 'PUT',
      body: JSON.stringify({ username, password, expectedVersion }),
    }),
  unbind: (id: string) => apiRequest<void>(`/api/users/${id}/smb-binding`, { method: 'DELETE' }),
};
export function uploadFile(id: string, file: File, onProgress: (bytes: number) => void) {
  const request = new XMLHttpRequest();
  const done = new Promise<FileOperationSummary>((resolve, reject) => {
    request.open('PUT', `${fileApiBase}/api/files/uploads/${id}/content`);
    request.setRequestHeader('Authorization', `Bearer ${tokenStorage.get() ?? ''}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      let body: { message?: string; code?: string } = {};
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {
        /* Safe fallback */
      }
      if (request.status >= 200 && request.status < 300) resolve(body as FileOperationSummary);
      else {
        if (request.status === 401) tokenStorage.clear();
        reject(new ApiError(body.code ?? body.message ?? 'TRANSFER_INTERRUPTED', request.status));
      }
    };
    request.onerror = () => reject(new ApiError('SMB_UNAVAILABLE', 0));
    request.onabort = () => reject(new ApiError('TRANSFER_INTERRUPTED', 0));
    request.send(file);
  });
  return { done, abort: () => request.abort() };
}
export function fileSize(value: string | number): string {
  const n = Number(value);
  if (n === 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 4);
  return `${(n / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}
