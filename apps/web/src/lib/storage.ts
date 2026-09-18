const memory = new Map<string, string | null>();

export function readStored(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    // Keep this page usable when browser storage is unavailable or full.
  }
}

export function clearStored(key: string): void {
  memory.set(key, null);
  try {
    localStorage.removeItem(key);
  } catch {
    // Never log stored credentials when browser storage is unavailable.
  }
}
