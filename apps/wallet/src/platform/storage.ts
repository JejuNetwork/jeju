/**
 * Cross-platform Storage Adapter
 */

import { z } from 'zod';
import type { StorageAdapter } from './types';
import { getPlatformInfo } from './detection';
import { expectJson } from '../lib/validation';

class WebStorageAdapter implements StorageAdapter {
  private prefix = 'jeju_wallet_';

  async get(key: string): Promise<string | null> {
    return localStorage.getItem(this.prefix + key);
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(this.prefix + key, value);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key);
  }

  async clear(): Promise<void> {
    const keys = await this.keys();
    for (const key of keys) {
      await this.remove(key);
    }
  }

  async keys(): Promise<string[]> {
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) {
        result.push(key.slice(this.prefix.length));
      }
    }
    return result;
  }
}

class ExtensionStorageAdapter implements StorageAdapter {
  private getStorage() {
    return typeof chrome !== 'undefined' ? chrome.storage?.local : null;
  }

  async get(key: string): Promise<string | null> {
    const storage = this.getStorage();
    if (!storage) return null;
    return new Promise((resolve) => {
      storage.get(key, (result: Record<string, unknown>) => {
        resolve((result[key] as string) ?? null);
      });
    });
  }

  async set(key: string, value: string): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;
    return new Promise((resolve) => {
      storage.set({ [key]: value }, resolve);
    });
  }

  async remove(key: string): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;
    return new Promise((resolve) => {
      storage.remove(key, resolve);
    });
  }

  async clear(): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;
    return new Promise((resolve) => {
      storage.clear(resolve);
    });
  }

  async keys(): Promise<string[]> {
    const storage = this.getStorage();
    if (!storage) return [];
    return new Promise((resolve) => {
      storage.get(null, (result: Record<string, unknown>) => {
        resolve(Object.keys(result));
      });
    });
  }
}

class TauriStorageAdapter implements StorageAdapter {
  // Uses localStorage as fallback for web build
  // Tauri runtime will use native storage via invoke
  private prefix = 'jeju_tauri_';

  private isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }

  async get(key: string): Promise<string | null> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('storage_get', { key });
    }
    return localStorage.getItem(this.prefix + key);
  }

  async set(key: string, value: string): Promise<void> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('storage_set', { key, value });
      return;
    }
    localStorage.setItem(this.prefix + key, value);
  }

  async remove(key: string): Promise<void> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('storage_remove', { key });
      return;
    }
    localStorage.removeItem(this.prefix + key);
  }

  async clear(): Promise<void> {
    const keys = await this.keys();
    for (const key of keys) {
      await this.remove(key);
    }
  }

  async keys(): Promise<string[]> {
    if (this.isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('storage_keys');
    }
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) {
        result.push(key.slice(this.prefix.length));
      }
    }
    return result;
  }
}

class CapacitorStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key });
    return value;
  }

  async set(key: string, value: string): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value });
  }

  async remove(key: string): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key });
  }

  async clear(): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.clear();
  }

  async keys(): Promise<string[]> {
    const { Preferences } = await import('@capacitor/preferences');
    const { keys } = await Preferences.keys();
    return keys;
  }
}

let storageInstance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (storageInstance) return storageInstance;

  const platform = getPlatformInfo();

  switch (platform.category) {
    case 'extension':
      storageInstance = new ExtensionStorageAdapter();
      break;
    case 'desktop':
      storageInstance = new TauriStorageAdapter();
      break;
    case 'mobile':
      storageInstance = new CapacitorStorageAdapter();
      break;
    default:
      storageInstance = new WebStorageAdapter();
  }

  return storageInstance;
}

export const storage = {
  get: (key: string) => getStorage().get(key),
  set: (key: string, value: string) => getStorage().set(key, value),
  remove: (key: string) => getStorage().remove(key),
  clear: () => getStorage().clear(),
  keys: () => getStorage().keys(),

  async getJSON<T>(key: string, schema: z.ZodSchema<T>): Promise<T | null> {
    const value = await getStorage().get(key);
    if (!value) return null;
    return expectJson(value, schema, `storage key: ${key}`);
  },

  async setJSON<T>(key: string, value: T): Promise<void> {
    await getStorage().set(key, JSON.stringify(value));
  },
};
