import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { Blob, File } from 'node:buffer';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
Object.defineProperty(globalThis, 'Blob', { value: Blob, configurable: true });
Object.defineProperty(globalThis, 'File', { value: File, configurable: true });
if (typeof window !== 'undefined') {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => values.get(k) ?? null,

      setItem: (k: string, v: string) => values.set(k, String(v)),

      removeItem: (k: string) => values.delete(k),

      clear: () => values.clear()
    },
    configurable: true
  });
}

afterEach(() => {
  cleanup();
  if (typeof localStorage !== 'undefined') localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
