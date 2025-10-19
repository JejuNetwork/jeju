/**
 * Browser Database using IndexedDB via idb-keyval
 * Simpler alternative to full PGLite for browser deployment
 */

import { get, set, del, keys } from 'idb-keyval';

export interface BrowserDatabaseAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export async function createBrowserDatabase(): Promise<BrowserDatabaseAdapter> {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return await get(key);
    },
    
    async set<T>(key: string, value: T): Promise<void> {
      await set(key, value);
    },
    
    async delete(key: string): Promise<void> {
      await del(key);
    },
    
    async keys(): Promise<string[]> {
      return await keys();
    },
  };
}

