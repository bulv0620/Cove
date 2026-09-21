import type {
  FileEntry,
  NoteContent,
  NoteOperationSummary,
  NoteSaveResult,
  NotesEntriesResponse,
  NotesStatus,
} from '@cove/shared';
import { apiRequest } from '@/lib/api';

const post = <T>(path: string, body: unknown) =>
  apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const notesApi = {
  status: () => apiRequest<NotesStatus>('/api/notes/status'),
  entries: (query: Record<string, string>) =>
    apiRequest<NotesEntriesResponse>(`/api/notes/entries?${new URLSearchParams(query)}`),
  content: (path: string) =>
    apiRequest<NoteContent>(`/api/notes/content?${new URLSearchParams({ path })}`),
  createFile: (path: string) => post<{ path: string }>('/api/notes', { path }),
  createFolder: (path: string) => post<FileEntry>('/api/notes/folders', { path }),
  save: (body: { path: string; markdown: string; expectedRevision: string; requestId: string }) =>
    apiRequest<NoteSaveResult>('/api/notes/content', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  rename: (path: string, newName: string, objectId?: string | null) =>
    apiRequest<FileEntry>('/api/notes/rename', {
      method: 'PATCH',
      body: JSON.stringify({ path, newName, objectId }),
    }),
  remove: (path: string, objectId?: string | null) =>
    apiRequest<void>('/api/notes/entries', {
      method: 'DELETE',
      body: JSON.stringify({ path, objectId }),
    }),
  operation: (id: string) => apiRequest<NoteOperationSummary>(`/api/notes/operations/${id}`),
};
