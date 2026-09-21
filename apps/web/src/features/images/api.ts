import type {
  HostedImage,
  HostedImagesResponse,
  ImageHostingStatus,
  ImageUploadSummary,
} from '@cove/shared';
import { apiRequest, ApiError, tokenStorage } from '@/lib/api';

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const post = <T>(path: string, body: unknown) =>
  apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const imagesApi = {
  status: () => apiRequest<ImageHostingStatus>('/api/images/status'),
  list: (query: Record<string, string>) =>
    apiRequest<HostedImagesResponse>(`/api/images?${new URLSearchParams(query)}`),
  createUpload: (name: string, size: string, requestId: string, publish: boolean) =>
    post<ImageUploadSummary>('/api/images/uploads', { name, size, requestId, publish }),
  visibility: (id: string, value: boolean) =>
    apiRequest<HostedImage>(`/api/images/${id}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ public: value }),
    }),
  remove: (id: string) => apiRequest<void>(`/api/images/${id}`, { method: 'DELETE' }),
  cancelUpload: (id: string) =>
    apiRequest<ImageUploadSummary>(`/api/images/uploads/${id}`, { method: 'DELETE' }),
};

export function uploadImage(
  id: string,
  file: File,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<HostedImage> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('TRANSFER_INTERRUPTED', 0));
      return;
    }
    const request = new XMLHttpRequest();
    request.open('PUT', `${apiBase}/api/images/uploads/${id}/content`);
    request.setRequestHeader('Authorization', `Bearer ${tokenStorage.get() ?? ''}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(request.responseText) as unknown;
      } catch {
        body = {};
      }
      if (request.status >= 200 && request.status < 300) resolve(body as HostedImage);
      else {
        const value = body as { code?: string; message?: string };
        reject(new ApiError(value.code ?? value.message ?? 'TRANSFER_INTERRUPTED', request.status));
      }
    };
    request.onerror = () => reject(new ApiError('SMB_UNAVAILABLE', 0));
    request.onabort = () => reject(new ApiError('TRANSFER_INTERRUPTED', 0));
    signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}

export async function imageBlob(path: string): Promise<Blob> {
  const headers = new Headers({ Accept: 'image/*' });
  const token = tokenStorage.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { headers });
  if (!response.ok) throw new ApiError('PREVIEW_UNAVAILABLE', response.status);
  return response.blob();
}
