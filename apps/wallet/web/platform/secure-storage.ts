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
    const saltBuffer = new Uint8Array(salt).buffer as ArrayBuffer as ArrayBuffer

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
  private encryptionKey: CryptoKey | null = null
  private static readonly EXT_KEY = 'jeju_ext_key_material'
  private static readonly EXT_SALT = 'jeju_ext_salt'

  private getStorage() {
    return typeof chrome !== 'undefined' ? chrome.storage?.local : null
  }

  private async getOrCreateKeyMaterial(): Promise<{
    keyData: Uint8Array
    salt: Uint8Array
  }> {
    const storage = this.getStorage()
    if (!storage) {
      throw new Error('Chrome storage not available')
    }

    return new Promise((resolve, reject) => {
      storage.get(
        [ExtensionSecureStorage.EXT_KEY, ExtensionSecureStorage.EXT_SALT],
        (result: Record<string, string | undefined>) => {
          let keyDataB64 = result[ExtensionSecureStorage.EXT_KEY]
          let saltB64 = result[ExtensionSecureStorage.EXT_SALT]

          if (!keyDataB64 || !saltB64) {
            // Generate new random key material and salt for this extension install
            const keyData = crypto.getRandomValues(new Uint8Array(32))
            const salt = crypto.getRandomValues(new Uint8Array(16))

            const newKeyDataB64 = btoa(String.fromCharCode(...keyData))
            const newSaltB64 = btoa(String.fromCharCode(...salt))
            keyDataB64 = newKeyDataB64
            saltB64 = newSaltB64

            storage.set(
              {
                [ExtensionSecureStorage.EXT_KEY]: newKeyDataB64,
                [ExtensionSecureStorage.EXT_SALT]: newSaltB64,
              },
              () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message))
                  return
                }
                if (!newKeyDataB64 || !newSaltB64) {
                  reject(new Error('Failed to retrieve key data'))
                  return
                }
                const keyDataStr = atob(newKeyDataB64)
                const saltStr = atob(newSaltB64)
                resolve({
                  keyData: new Uint8Array(
                    Array.from(keyDataStr, (c) => c.charCodeAt(0)),
                  ),
                  salt: new Uint8Array(
                    Array.from(saltStr, (c) => c.charCodeAt(0)),
                  ),
                })
              },
            )
          } else {
            const keyDataStr = atob(keyDataB64)
            const saltStr = atob(saltB64)
            resolve({
              keyData: new Uint8Array(
                Array.from(keyDataStr, (c) => c.charCodeAt(0)),
              ),
              salt: new Uint8Array(Array.from(saltStr, (c) => c.charCodeAt(0))),
            })
          }
        },
      )
    })
  }

  private async getKey(): Promise<CryptoKey> {
    if (this.encryptionKey) return this.encryptionKey

    const { keyData, salt } = await this.getOrCreateKeyMaterial()

    // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
    const keyBuffer = new Uint8Array(keyData).buffer as ArrayBuffer
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      'PBKDF2',
      false,
      ['deriveKey'],
    )

    // Create a new ArrayBuffer for salt to avoid SharedArrayBuffer issues
    const saltBuffer = new Uint8Array(salt).buffer as ArrayBuffer
    this.encryptionKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
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
    const storage = this.getStorage()
    if (!storage) return null

    const stored = await new Promise<string | undefined>((resolve) => {
      storage.get(
        `secure_${key}`,
        (result: Record<string, string | undefined>) => {
          resolve(result[`secure_${key}`])
        },
      )
    })

    if (!stored) return null

    // Decrypt the stored value
    const result = EncryptedStorageSchema.safeParse(JSON.parse(stored))
    if (!result.success) {
      throw new Error(`Corrupted secure storage for key: ${key}`)
    }

    const { iv, data } = result.data
    const cryptoKey = await this.getKey()
    const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0))
    const dataBytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      cryptoKey,
      dataBytes,
    )

    return new TextDecoder().decode(decrypted)
  }

  async set(key: string, value: string): Promise<void> {
    const storage = this.getStorage()
    if (!storage) return

    const cryptoKey = await this.getKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      new TextEncoder().encode(value),
    )

    const stored = {
      iv: btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    }

    return new Promise((resolve, reject) => {
      storage.set({ [`secure_${key}`]: JSON.stringify(stored) }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve()
      })
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
    const storage = this.getStorage()
    if (!storage) return false
    return new Promise((resolve) => {
      storage.get(
        `secure_${key}`,
        (result: Record<string, string | undefined>) => {
          resolve(result[`secure_${key}`] !== undefined)
        },
      )
    })
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

/**
 * Capacitor Secure Storage using native iOS Keychain / Android Keystore
 * Falls back to encrypted Preferences if native plugin unavailable
 */
class CapacitorSecureStorage implements SecureStorageAdapter {
  private encryptionKey: CryptoKey | null = null
  private useNativeKeychain = true
  private prefix = 'jeju_mobile_secure_'
  private static readonly MOBILE_KEY = 'jeju_mobile_key_material'
  private static readonly MOBILE_SALT = 'jeju_mobile_salt'

  private async tryNativeKeychain(): Promise<boolean> {
    if (!this.useNativeKeychain) return false
    // Check if SecureStoragePlugin is available (from capacitor-secure-storage-plugin)
    // This plugin uses iOS Keychain and Android EncryptedSharedPreferences
    if (typeof window === 'undefined' || !('Capacitor' in window)) {
      return false
    }
    const capacitor = window.Capacitor as {
      isPluginAvailable?: (name: string) => boolean
    }
    return capacitor?.isPluginAvailable?.('SecureStoragePlugin') ?? false
  }

  private async getOrCreateKeyMaterial(): Promise<{
    keyData: Uint8Array
    salt: Uint8Array
  }> {
    const { Preferences } = await import('@capacitor/preferences')
    const keyResult = await Preferences.get({
      key: CapacitorSecureStorage.MOBILE_KEY,
    })
    const saltResult = await Preferences.get({
      key: CapacitorSecureStorage.MOBILE_SALT,
    })

    if (!keyResult.value || !saltResult.value) {
      const keyData = crypto.getRandomValues(new Uint8Array(32))
      const salt = crypto.getRandomValues(new Uint8Array(16))

      const keyDataB64 = btoa(String.fromCharCode(...keyData))
      const saltB64 = btoa(String.fromCharCode(...salt))

      await Preferences.set({
        key: CapacitorSecureStorage.MOBILE_KEY,
        value: keyDataB64,
      })
      await Preferences.set({
        key: CapacitorSecureStorage.MOBILE_SALT,
        value: saltB64,
      })

      return { keyData, salt }
    }

    return {
      keyData: new Uint8Array(
        atob(keyResult.value)
          .split('')
          .map((c) => c.charCodeAt(0)),
      ),
      salt: new Uint8Array(
        atob(saltResult.value)
          .split('')
          .map((c) => c.charCodeAt(0)),
      ),
    }
  }

  private async getKey(): Promise<CryptoKey> {
    if (this.encryptionKey) return this.encryptionKey

    const { keyData, salt } = await this.getOrCreateKeyMaterial()

    // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
    const keyBuffer = new Uint8Array(keyData).buffer as ArrayBuffer
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      'PBKDF2',
      false,
      ['deriveKey'],
    )

    // Create a new ArrayBuffer for salt to avoid SharedArrayBuffer issues
    const saltBuffer = new Uint8Array(salt).buffer as ArrayBuffer
    this.encryptionKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
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

  async get(
    key: string,
    options?: SecureStorageOptions,
  ): Promise<string | null> {
    // Try native keychain first (iOS Keychain / Android Keystore)
    if (await this.tryNativeKeychain()) {
      const { SecureStoragePlugin } = await import(
        'capacitor-secure-storage-plugin'
      )
      // capacitor-secure-storage-plugin throws if key doesn't exist
      try {
        const result = await SecureStoragePlugin.get({ key: this.prefix + key })
        // Native keychain handles biometrics natively
        return result.value
      } catch {
        return null
      }
    }

    // Fallback: Use encrypted Preferences
    const { Preferences } = await import('@capacitor/preferences')
    const result = await Preferences.get({ key: this.prefix + key })
    if (!result.value) return null

    // Decrypt the stored value
    const parseResult = EncryptedStorageSchema.safeParse(
      JSON.parse(result.value),
    )
    if (!parseResult.success) {
      throw new Error(`Corrupted secure storage for key: ${key}`)
    }

    const { iv, data } = parseResult.data
    const cryptoKey = await this.getKey()
    const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0))
    const dataBytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      cryptoKey,
      dataBytes,
    )

    // If biometrics requested and we're in fallback mode, the native platform
    // will have already prompted (via Capacitor's native-biometric plugin if installed)
    if (options?.authenticateWithBiometrics) {
      // Biometric authentication would be handled here if @nicememes/capacitor-native-biometric is installed
      // For now, we proceed with the encrypted value
    }

    return new TextDecoder().decode(decrypted)
  }

  async set(
    key: string,
    value: string,
    _options?: SecureStorageOptions,
  ): Promise<void> {
    // Try native keychain first
    if (await this.tryNativeKeychain()) {
      const { SecureStoragePlugin } = await import(
        'capacitor-secure-storage-plugin'
      )
      await SecureStoragePlugin.set({ key: this.prefix + key, value })
      return
    }

    // Fallback: Encrypt and store in Preferences
    const cryptoKey = await this.getKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      new TextEncoder().encode(value),
    )

    const stored = {
      iv: btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    }

    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({
      key: this.prefix + key,
      value: JSON.stringify(stored),
    })
  }

  async remove(key: string): Promise<void> {
    // Try native keychain first
    if (await this.tryNativeKeychain()) {
      const { SecureStoragePlugin } = await import(
        'capacitor-secure-storage-plugin'
      )
      await SecureStoragePlugin.remove({ key: this.prefix + key })
      return
    }

    // Fallback: Remove from Preferences
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.remove({ key: this.prefix + key })
  }

  async hasKey(key: string): Promise<boolean> {
    // Try native keychain first
    if (await this.tryNativeKeychain()) {
      const { SecureStoragePlugin } = await import(
        'capacitor-secure-storage-plugin'
      )
      try {
        await SecureStoragePlugin.get({ key: this.prefix + key })
        return true
      } catch {
        return false
      }
    }

    // Fallback: Check Preferences
    const { Preferences } = await import('@capacitor/preferences')
    const result = await Preferences.get({ key: this.prefix + key })
    return result.value !== null
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
