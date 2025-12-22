/**
 * Secure Storage Adapter
 */

import { z } from 'zod'
import { getPlatformInfo } from './detection'
import type { SecureStorageAdapter, SecureStorageOptions } from './types'

/** Schema for encrypted storage entries */
const EncryptedStorageSchema = z.object({
  iv: z.string(),
  data: z.string(),
})

class WebSecureStorage implements SecureStorageAdapter {
  private encryptionKey: CryptoKey | null = null
  private prefix = 'jeju_secure_'
  private static readonly INSTALLATION_KEY = 'jeju_installation_key'
  private static readonly INSTALLATION_SALT = 'jeju_installation_salt'

  // Get or generate a per-installation random key material
  private getInstallationKeyData(): { keyData: Uint8Array; salt: Uint8Array } {
    let keyDataB64 = localStorage.getItem(WebSecureStorage.INSTALLATION_KEY)
    let saltB64 = localStorage.getItem(WebSecureStorage.INSTALLATION_SALT)

    if (!keyDataB64 || !saltB64) {
      // Generate new random key material (32 bytes) and salt (16 bytes) for this installation
      const keyData = crypto.getRandomValues(new Uint8Array(32))
      const salt = crypto.getRandomValues(new Uint8Array(16))

      keyDataB64 = btoa(String.fromCharCode(...keyData))
      saltB64 = btoa(String.fromCharCode(...salt))

      localStorage.setItem(WebSecureStorage.INSTALLATION_KEY, keyDataB64)
      localStorage.setItem(WebSecureStorage.INSTALLATION_SALT, saltB64)
    }

    return {
      keyData: new Uint8Array(
        atob(keyDataB64)
          .split('')
          .map((c) => c.charCodeAt(0)),
      ),
      salt: new Uint8Array(
        atob(saltB64)
          .split('')
          .map((c) => c.charCodeAt(0)),
      ),
    }
  }

  private async getKey(): Promise<CryptoKey> {
    if (this.encryptionKey) return this.encryptionKey

    const { keyData, salt } = this.getInstallationKeyData()

    // Create ArrayBuffer copies for TypeScript compatibility with crypto.subtle
    const keyDataBuffer = new Uint8Array(keyData).buffer as ArrayBuffer
    const saltBuffer = new Uint8Array(salt).buffer as ArrayBuffer

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(keyDataBuffer),
      'PBKDF2',
      false,
      ['deriveKey'],
    )

    this.encryptionKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(saltBuffer),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )

    return this.encryptionKey
  }

  async get(key: string): Promise<string | null> {
    const stored = localStorage.getItem(this.prefix + key)
    if (!stored) return null

    // Validate JSON structure before using
    let parsed: z.infer<typeof EncryptedStorageSchema>
    try {
      const rawParsed: unknown = JSON.parse(stored)
      const result = EncryptedStorageSchema.safeParse(rawParsed)
      if (!result.success) {
        throw new Error(`Invalid secure storage format for key: ${key}`)
      }
      parsed = result.data
    } catch {
      throw new Error(`Corrupted secure storage for key: ${key}`)
    }

    const cryptoKey = await this.getKey()

    // Validate base64 encoding before decoding
    let ivBytes: Uint8Array
    let dataBytes: Uint8Array
    try {
      ivBytes = Uint8Array.from(atob(parsed.iv), (c) => c.charCodeAt(0))
      dataBytes = Uint8Array.from(atob(parsed.data), (c) => c.charCodeAt(0))
    } catch {
      throw new Error(
        `Invalid base64 encoding in secure storage for key: ${key}`,
      )
    }

    // Create new ArrayBuffer views to ensure proper typing for SubtleCrypto
    const ivBuffer = new ArrayBuffer(ivBytes.length)
    new Uint8Array(ivBuffer).set(ivBytes)
    const dataBuffer = new ArrayBuffer(dataBytes.length)
    new Uint8Array(dataBuffer).set(dataBytes)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(ivBuffer) },
      cryptoKey,
      new Uint8Array(dataBuffer),
    )

    return new TextDecoder().decode(decrypted)
  }

  async set(key: string, value: string): Promise<void> {
    const cryptoKey = await this.getKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoder = new TextEncoder()

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoder.encode(value),
    )

    const stored = {
      iv: btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    }

    localStorage.setItem(this.prefix + key, JSON.stringify(stored))
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key)
  }

  async hasKey(key: string): Promise<boolean> {
    return localStorage.getItem(this.prefix + key) !== null
  }
}

class ExtensionSecureStorage implements SecureStorageAdapter {
  private getStorage() {
    return typeof chrome !== 'undefined' ? chrome.storage?.local : null
  }

  async get(key: string): Promise<string | null> {
    const storage = this.getStorage()
    if (!storage) return null
    return new Promise((resolve) => {
      storage.get(
        `secure_${key}`,
        (result: Record<string, string | undefined>) => {
          resolve(result[`secure_${key}`] ?? null)
        },
      )
    })
  }

  async set(key: string, value: string): Promise<void> {
    const storage = this.getStorage()
    if (!storage) return
    return new Promise((resolve) => {
      storage.set({ [`secure_${key}`]: value }, resolve)
    })
  }

  async remove(key: string): Promise<void> {
    const storage = this.getStorage()
    if (!storage) return
    return new Promise((resolve) => {
      storage.remove(`secure_${key}`, resolve)
    })
  }

  async hasKey(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }
}

class TauriSecureStorage implements SecureStorageAdapter {
  private webFallback = new WebSecureStorage()

  private isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window
  }

  async get(
    key: string,
    _options?: SecureStorageOptions,
  ): Promise<string | null> {
    if (this.isTauri()) {
      // Dynamic import: Conditional - only loaded on Tauri desktop platform
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke('keyring_get', { key })
    }
    return this.webFallback.get(key)
  }

  async set(
    key: string,
    value: string,
    _options?: SecureStorageOptions,
  ): Promise<void> {
    if (this.isTauri()) {
      // Dynamic import: Conditional - only loaded on Tauri desktop platform
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('keyring_set', { key, value })
      return
    }
    await this.webFallback.set(key, value)
  }

  async remove(key: string): Promise<void> {
    if (this.isTauri()) {
      // Dynamic import: Conditional - only loaded on Tauri desktop platform
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('keyring_delete', { key })
      return
    }
    await this.webFallback.remove(key)
  }

  async hasKey(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }
}

class CapacitorSecureStorage implements SecureStorageAdapter {
  async get(
    key: string,
    _options?: SecureStorageOptions,
  ): Promise<string | null> {
    // Dynamic import: Conditional - only loaded on mobile platforms
    const { Preferences } = await import('@capacitor/preferences')
    const result = await Preferences.get({ key: `secure_${key}` })
    return result.value
  }

  async set(
    key: string,
    value: string,
    _options?: SecureStorageOptions,
  ): Promise<void> {
    // Dynamic import: Conditional - only loaded on mobile platforms
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({ key: `secure_${key}`, value })
  }

  async remove(key: string): Promise<void> {
    // Dynamic import: Conditional - only loaded on mobile platforms
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.remove({ key: `secure_${key}` })
  }

  async hasKey(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }
}

let secureStorageInstance: SecureStorageAdapter | null = null

export function getSecureStorage(): SecureStorageAdapter {
  if (secureStorageInstance) return secureStorageInstance

  const platform = getPlatformInfo()

  switch (platform.category) {
    case 'extension':
      secureStorageInstance = new ExtensionSecureStorage()
      break
    case 'desktop':
      secureStorageInstance = new TauriSecureStorage()
      break
    case 'mobile':
      secureStorageInstance = new CapacitorSecureStorage()
      break
    default:
      secureStorageInstance = new WebSecureStorage()
  }

  return secureStorageInstance
}

export const secureStorage = {
  get: (key: string, options?: SecureStorageOptions) =>
    getSecureStorage().get(key, options),
  set: (key: string, value: string, options?: SecureStorageOptions) =>
    getSecureStorage().set(key, value, options),
  remove: (key: string) => getSecureStorage().remove(key),
  hasKey: (key: string) => getSecureStorage().hasKey(key),
}

export const keyStorage = {
  async savePrivateKey(address: string, encryptedKey: string): Promise<void> {
    await secureStorage.set(`pk_${address}`, encryptedKey, {
      authenticateWithBiometrics: true,
    })
  },

  async getPrivateKey(address: string): Promise<string | null> {
    return secureStorage.get(`pk_${address}`, {
      authenticateWithBiometrics: true,
    })
  },

  async removePrivateKey(address: string): Promise<void> {
    await secureStorage.remove(`pk_${address}`)
  },

  async saveMnemonic(id: string, encryptedMnemonic: string): Promise<void> {
    await secureStorage.set(`mnemonic_${id}`, encryptedMnemonic, {
      authenticateWithBiometrics: true,
    })
  },

  async getMnemonic(id: string): Promise<string | null> {
    return secureStorage.get(`mnemonic_${id}`, {
      authenticateWithBiometrics: true,
    })
  },

  async removeMnemonic(id: string): Promise<void> {
    await secureStorage.remove(`mnemonic_${id}`)
  },
}
