/**
 * Secure Storage Adapter
 */

import type { SecureStorageAdapter, SecureStorageOptions } from './types';
import { getPlatformInfo } from './detection';

class WebSecureStorage implements SecureStorageAdapter {
  private encryptionKey: CryptoKey | null = null;
  private prefix = 'jeju_secure_';

  private async getKey(): Promise<CryptoKey> {
    if (this.encryptionKey) return this.encryptionKey;

    const encoder = new TextEncoder();
    const baseData = encoder.encode(navigator.userAgent + '_jeju_wallet_v1');
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      baseData,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this.encryptionKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('jeju_wallet_salt'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return this.encryptionKey;
  }

  async get(key: string): Promise<string | null> {
    const stored = localStorage.getItem(this.prefix + key);
    if (!stored) return null;

    let parsed: { iv?: string; data?: string };
    parsed = JSON.parse(stored) as { iv?: string; data?: string };
    if (!parsed.iv || !parsed.data) {
      throw new Error(`Invalid secure storage format for key: ${key}`);
    }
    
    const cryptoKey = await this.getKey();
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(atob(parsed.iv), c => c.charCodeAt(0)) },
      cryptoKey,
      Uint8Array.from(atob(parsed.data), c => c.charCodeAt(0))
    );

    return new TextDecoder().decode(decrypted);
  }

  async set(key: string, value: string): Promise<void> {
    const cryptoKey = await this.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoder.encode(value)
    );

    const stored = {
      iv: btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    };

    localStorage.setItem(this.prefix + key, JSON.stringify(stored));
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key);
  }

  async hasKey(key: string): Promise<boolean> {
    return localStorage.getItem(this.prefix + key) !== null;
  }
}

class ExtensionSecureStorage implements SecureStorageAdapter {
  private getStorage() {
    return typeof chrome !== 'undefined' ? chrome.storage?.local : null;
  }

  async get(key: string): Promise<string | null> {
    const storage = this.getStorage();
    if (!storage) return null;
    return new Promise((resolve) => {
      storage.get(`secure_${key}`, (result: Record<string, unknown>) => {
        resolve((result[`secure_${key}`] as string) ?? null);
      });
    });
  }

  async set(key: string, value: string): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;
    return new Promise((resolve) => {
      storage.set({ [`secure_${key}`]: value }, resolve);
    });
  }

  async remove(key: string): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;
    return new Promise((resolve) => {
      storage.remove(`secure_${key}`, resolve);
    });
  }

  async hasKey(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }
}

class TauriSecureStorage implements SecureStorageAdapter {
  private webFallback = new WebSecureStorage();
  
  private isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }

  async get(key: string, _options?: SecureStorageOptions): Promise<string | null> {
    if (this.isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke('keyring_get', { key });
      } catch (tauriError) {
        // Log and fall back to web secure storage - Tauri keyring may not be available
        console.warn('Tauri keyring unavailable, using web fallback:', tauriError);
      }
    }
    return this.webFallback.get(key);
  }

  async set(key: string, value: string, _options?: SecureStorageOptions): Promise<void> {
    if (this.isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('keyring_set', { key, value });
        return;
      } catch (tauriError) {
        // Log and fall back to web secure storage - Tauri keyring may not be available
        console.warn('Tauri keyring unavailable, using web fallback:', tauriError);
      }
    }
    await this.webFallback.set(key, value);
  }

  async remove(key: string): Promise<void> {
    if (this.isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('keyring_delete', { key });
        return;
      } catch (tauriError) {
        // Log and fall back to web secure storage - Tauri keyring may not be available
        console.warn('Tauri keyring unavailable, using web fallback:', tauriError);
      }
    }
    await this.webFallback.remove(key);
  }

  async hasKey(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }
}

class CapacitorSecureStorage implements SecureStorageAdapter {
  async get(key: string, _options?: SecureStorageOptions): Promise<string | null> {
    const { Preferences } = await import('@capacitor/preferences');
    const result = await Preferences.get({ key: `secure_${key}` });
    return result.value;
  }

  async set(key: string, value: string, _options?: SecureStorageOptions): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: `secure_${key}`, value });
  }

  async remove(key: string): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: `secure_${key}` });
  }

  async hasKey(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }
}

let secureStorageInstance: SecureStorageAdapter | null = null;

export function getSecureStorage(): SecureStorageAdapter {
  if (secureStorageInstance) return secureStorageInstance;

  const platform = getPlatformInfo();

  switch (platform.category) {
    case 'extension':
      secureStorageInstance = new ExtensionSecureStorage();
      break;
    case 'desktop':
      secureStorageInstance = new TauriSecureStorage();
      break;
    case 'mobile':
      secureStorageInstance = new CapacitorSecureStorage();
      break;
    default:
      secureStorageInstance = new WebSecureStorage();
  }

  return secureStorageInstance;
}

export const secureStorage = {
  get: (key: string, options?: SecureStorageOptions) => getSecureStorage().get(key, options),
  set: (key: string, value: string, options?: SecureStorageOptions) => 
    getSecureStorage().set(key, value, options),
  remove: (key: string) => getSecureStorage().remove(key),
  hasKey: (key: string) => getSecureStorage().hasKey(key),
};

export const keyStorage = {
  async savePrivateKey(address: string, encryptedKey: string): Promise<void> {
    await secureStorage.set(`pk_${address}`, encryptedKey, {
      authenticateWithBiometrics: true,
    });
  },

  async getPrivateKey(address: string): Promise<string | null> {
    return secureStorage.get(`pk_${address}`, {
      authenticateWithBiometrics: true,
    });
  },

  async removePrivateKey(address: string): Promise<void> {
    await secureStorage.remove(`pk_${address}`);
  },

  async saveMnemonic(id: string, encryptedMnemonic: string): Promise<void> {
    await secureStorage.set(`mnemonic_${id}`, encryptedMnemonic, {
      authenticateWithBiometrics: true,
    });
  },

  async getMnemonic(id: string): Promise<string | null> {
    return secureStorage.get(`mnemonic_${id}`, {
      authenticateWithBiometrics: true,
    });
  },

  async removeMnemonic(id: string): Promise<void> {
    await secureStorage.remove(`mnemonic_${id}`);
  },
};
