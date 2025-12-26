/**
 * Key Backup Manager - encrypts/exports key material using PBKDF2 + AES-GCM.
 *
 * This is for backing up private keys or secret material with password-based encryption.
 * Different from BackupCodesManager which handles MFA recovery codes.
 */

import { isProductionEnv } from '@jejunetwork/config'
import { type Hex, toBytes, toHex } from 'viem'
import { z } from 'zod'

/**
 * DID format validation
 */
const DIDSchema = z.custom<`did:jeju:${string}:${string}`>(
  (val): val is `did:jeju:${string}:${string}` =>
    typeof val === 'string' && /^did:jeju:[a-z]+:0x[a-fA-F0-9]+$/.test(val),
  { message: 'Invalid DID format - expected did:jeju:network:0x...' },
)

/**
 * Hex string validation
 */
const HexSchema = z.custom<Hex>(
  (val): val is Hex => typeof val === 'string' && /^0x[a-fA-F0-9]*$/.test(val),
  { message: 'Invalid hex string format' },
)

/**
 * Key backup format for recovery
 */
export const KeyBackupSchema = z.object({
  version: z.number().int().positive(),
  userId: DIDSchema,
  encryptedKey: HexSchema,
  salt: HexSchema,
  iv: HexSchema,
  iterations: z.number().int().min(1),
  createdAt: z.number().int().positive(),
})

export type KeyBackup = z.infer<typeof KeyBackupSchema>

export interface BackupOptions {
  iterations?: number
  saltLength?: number
  ivLength?: number
}

/** Minimum PBKDF2 iterations for production security (OWASP recommendation) */
const MIN_PRODUCTION_ITERATIONS = 100000

const DEFAULT_OPTIONS: Required<BackupOptions> = {
  iterations: MIN_PRODUCTION_ITERATIONS,
  saltLength: 32,
  ivLength: 12,
}

export class KeyBackupManager {
  private options: Required<BackupOptions>

  constructor(options?: BackupOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options }

    // Production security check
    if (isProductionEnv() && this.options.iterations < MIN_PRODUCTION_ITERATIONS) {
      throw new Error(
        `PBKDF2 iterations too low for production: ${this.options.iterations}. ` +
          `Minimum required: ${MIN_PRODUCTION_ITERATIONS}`,
      )
    }

    // Warn about low iterations in any environment
    if (this.options.iterations < 10000) {
      console.warn(
        '[KeyBackupManager] PBKDF2 iterations below 10000 - only use for testing',
      )
    }
  }

  async createBackup(
    userId: `did:jeju:${string}:${string}`,
    password: string,
  ): Promise<KeyBackup> {
    const salt = crypto.getRandomValues(new Uint8Array(this.options.saltLength))
    const iv = crypto.getRandomValues(new Uint8Array(this.options.ivLength))
    const key = await this.deriveKey(password, salt)
    const keyMaterial = await this.getKeyMaterial(userId)
    const encryptedKey = await this.encrypt(keyMaterial, key, iv)

    return {
      version: 1,
      userId,
      encryptedKey: toHex(new Uint8Array(encryptedKey)),
      salt: toHex(salt),
      iv: toHex(iv),
      iterations: this.options.iterations,
      createdAt: Date.now(),
    }
  }

  async verifyBackup(backup: KeyBackup, password: string): Promise<boolean> {
    const key = await this.deriveKey(
      password,
      toBytes(backup.salt),
      backup.iterations,
    )
    const decrypted = await this.decrypt(
      toBytes(backup.encryptedKey),
      key,
      toBytes(backup.iv),
    )
    return decrypted.length > 0
  }

  async restoreFromBackup(
    backup: KeyBackup,
    password: string,
  ): Promise<Uint8Array> {
    const key = await this.deriveKey(
      password,
      toBytes(backup.salt),
      backup.iterations,
    )
    return this.decrypt(toBytes(backup.encryptedKey), key, toBytes(backup.iv))
  }

  private async deriveKey(
    password: string,
    salt: Uint8Array,
    iterations = this.options.iterations,
  ): Promise<CryptoKey> {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      this.toArrayBuffer(new TextEncoder().encode(password)),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey'],
    )

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: this.toArrayBuffer(salt),
        iterations,
        hash: 'SHA-256',
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }

  private toArrayBuffer(arr: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(arr.length)
    new Uint8Array(buffer).set(arr)
    return buffer
  }

  private async encrypt(
    data: Uint8Array,
    key: CryptoKey,
    iv: Uint8Array,
  ): Promise<ArrayBuffer> {
    return crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: this.toArrayBuffer(iv) },
      key,
      this.toArrayBuffer(data),
    )
  }

  private async decrypt(
    data: Uint8Array,
    key: CryptoKey,
    iv: Uint8Array,
  ): Promise<Uint8Array> {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.toArrayBuffer(iv) },
      key,
      this.toArrayBuffer(data),
    )
    return new Uint8Array(decrypted)
  }

  private async getKeyMaterial(
    userId: `did:jeju:${string}:${string}`,
  ): Promise<Uint8Array> {
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(userId),
    )
    return new Uint8Array(hash)
  }

  static exportToJSON(backup: KeyBackup): string {
    return JSON.stringify(backup, null, 2)
  }

  static importFromJSON(json: string): KeyBackup {
    const parsed = JSON.parse(json)
    const result = KeyBackupSchema.safeParse(parsed)
    if (!result.success) {
      throw new Error('Invalid backup format')
    }
    return result.data
  }

  static exportToBase64(backup: KeyBackup): string {
    return btoa(JSON.stringify(backup))
  }

  static importFromBase64(base64: string): KeyBackup {
    return KeyBackupManager.importFromJSON(atob(base64))
  }
}

export function createKeyBackupManager(
  options?: BackupOptions,
): KeyBackupManager {
  return new KeyBackupManager(options)
}
