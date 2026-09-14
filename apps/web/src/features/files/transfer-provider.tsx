import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { filesApi, uploadFile } from './api';
import { useAuth } from '@/features/auth/hooks';
export interface UploadItem {
  id: string;
  file: File;
  name: string;
  parentPath: string;
  state: string;
  bytes: number;
  error?: string;
  operationId?: string;
}
interface Transfers {
  items: UploadItem[];
  add: (files: File[], path: string, limit: number) => void;
  cancel: (id: string) => void;
  retry: (id: string, name: string) => void;
  skip: (id: string) => void;
}
const Context = createContext<Transfers | null>(null);
export function TransferProvider({ children }: PropsWithChildren): JSX.Element {
  const { user } = useAuth();
  const cache = useQueryClient();
  const fileStatus = useQuery({
    queryKey: ['files', user?.id, 'status'],
    queryFn: filesApi.status,
    enabled:
      !!user &&
      !user.mustChangePassword &&
      (user.isSuperAdmin || user.permissions.includes('infra.files.page')),
    retry: false,
  });
  const concurrency = fileStatus.data?.maxActive ?? 2;
  const [items, setItems] = useState<UploadItem[]>([]);
  const current = useRef(items);
  current.current = items;
  const running = useRef(new Map<string, () => void>());
  const owner = useRef(user?.id);
  owner.current = user?.id;
  const update = (id: string, value: Partial<UploadItem>) =>
    setItems((old) => old.map((item) => (item.id === id ? { ...item, ...value } : item)));
  useEffect(() => {
    const active = running.current;
    return () => {
      for (const cancel of active.values()) cancel();
      active.clear();
      setItems([]);
    };
  }, [user?.id]);
  useEffect(() => {
    const block = (event: BeforeUnloadEvent) => {
      if (
        current.current.some((item) => ['queued', 'uploading', 'committing'].includes(item.state))
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', block);
    return () => window.removeEventListener('beforeunload', block);
  }, []);
  useEffect(() => {
    if (!user) return;
    for (const item of items) {
      if (running.current.size >= concurrency) break;
      if (item.state !== 'queued' || running.current.has(item.id)) continue;
      let canceled = false;
      running.current.set(item.id, () => {
        canceled = true;
      });
      update(item.id, { state: 'uploading' });
      const userId = user.id;
      void (async () => {
        try {
          const operation = await filesApi.create(
            item.parentPath,
            item.name,
            String(item.file.size),
            item.id,
          );
          if (canceled || owner.current !== userId) {
            await filesApi.cancel(operation.id).catch(() => {});
            return;
          }
          update(item.id, { operationId: operation.id });
          const transfer = uploadFile(operation.id, item.file, (bytes) =>
            update(item.id, {
              bytes,
              state: bytes === item.file.size ? 'committing' : 'uploading',
            }),
          );
          running.current.set(item.id, () => {
            canceled = true;
            transfer.abort();
          });
          await transfer.done;
          if (owner.current === userId)
            update(item.id, { state: 'succeeded', bytes: item.file.size });
          await cache.invalidateQueries({ queryKey: ['files', userId] });
        } catch (error) {
          if (owner.current === userId && !canceled)
            update(item.id, {
              state: 'failed',
              error: error instanceof Error ? error.message : 'TRANSFER_INTERRUPTED',
            });
        } finally {
          running.current.delete(item.id);
          if (owner.current === userId) setItems((old) => [...old]);
        }
      })();
    }
  }, [items, user, cache, concurrency]);
  const cancel = (id: string) => {
    const item = current.current.find((entry) => entry.id === id);
    if (!item) return;
    if (!item.operationId) {
      running.current.get(id)?.();
      update(id, { state: 'canceled' });
      return;
    }
    void filesApi
      .cancel(item.operationId)
      .then((operation) => {
        if (operation.state === 'SUCCEEDED')
          update(id, { state: 'succeeded', bytes: item.file.size });
        else {
          running.current.get(id)?.();
          update(id, { state: 'canceled' });
        }
      })
      .catch((error) =>
        update(id, { error: error instanceof Error ? error.message : 'TRANSFER_INTERRUPTED' }),
      );
  };
  return (
    <Context.Provider
      value={{
        items,
        add: (files, path, limit) =>
          setItems((old) => {
            const pending = old.filter(
              (item) => !['succeeded', 'skipped', 'canceled'].includes(item.state),
            );
            return [
              ...pending,
              ...files.slice(0, Math.max(0, 100 - pending.length)).map((file) => ({
                id: crypto.randomUUID(),
                file,
                name: file.name,
                parentPath: path,
                state: file.size > limit ? 'failed' : 'queued',
                bytes: 0,
                error: file.size > limit ? 'SIZE_LIMIT' : undefined,
              })),
            ];
          }),
        cancel,
        retry: (id, name) =>
          setItems((old) =>
            old.map((item) =>
              item.id === id
                ? {
                    ...item,
                    id: crypto.randomUUID(),
                    name,
                    state: 'queued',
                    bytes: 0,
                    error: undefined,
                    operationId: undefined,
                  }
                : item,
            ),
          ),
        skip: (id) => update(id, { state: 'skipped' }),
      }}
    >
      {children}
    </Context.Provider>
  );
}
// Provider and hook are colocated so file transfers survive route changes.
export function useTransfers(): Transfers {
  const context = useContext(Context);
  if (!context) throw new Error('Missing transfer provider');
  return context;
}
