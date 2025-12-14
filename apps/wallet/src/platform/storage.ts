/**
 * Cross-platform Storage Adapter
 */

import type { StorageAdapter } from './types';
import { getPlatformInfo } from './detection';

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

  async get(key: string): Promise<string | null> {
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke('storage_get', { key });
      } catch {
        // Fall back to localStorage
      }
    }
    return localStorage.getItem(this.prefix + key);
  }

  async set(key: string, value: string): Promise<void> {
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('storage_set', { key, value });
        return;
      } catch {
        // Fall back to localStorage
      }
    }
    localStorage.setItem(this.prefix + key, value);
  }

  async remove(key: string): Promise<void> {
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('storage_remove', { key });
        return;
      } catch {
        // Fall back to localStorage
      }
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
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke('storage_keys');
      } catch {
        // Fall back to localStorage
      }
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
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
    } catch (err) {
      console.error('Failed to set storage:', err);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
    } catch (err) {
      console.error('Failed to remove from storage:', err);
    }
  }

  async clear(): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.clear();
    } catch (err) {
      console.error('Failed to clear storage:', err);
    }
  }

  async keys(): Promise<string[]> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { keys } = await Preferences.keys();
      return keys;
    } catch {
      return [];
    }
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

  async getJSON<T>(key: string): Promise<T | null> {
    const value = await getStorage().get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  },

  async setJSON<T>(key: string, value: T): Promise<void> {
    await getStorage().set(key, JSON.stringify(value));
  },
};
