/**
 * Database Encryption at Rest
 *
 * Production-grade encryption for SQLite database files.
 * Uses AES-256-GCM for authenticated encryption.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Configuration
const DB_ENCRYPTION_KEY_ENV = 'FACTORY_DB_ENCRYPTION_KEY'
const KEY_DERIVATION_SALT_ENV = 'FACTORY_DB_KEY_SALT'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32
const ENCRYPTED_HEADER = Buffer.from('JEJU_ENC_DB_V1')

// Cached derived key
let derivedKey: Buffer | null = null
let keySalt: Buffer | null = null

function getEncryptionKey(): Buffer {
  if (derivedKey) return derivedKey

  const masterKey = process.env[DB_ENCRYPTION_KEY_ENV]
  if (!masterKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${DB_ENCRYPTION_KEY_ENV} must be set in production`)
    }
    return Buffer.alloc(0)
  }

  const saltHex = process.env[KEY_DERIVATION_SALT_ENV]
  keySalt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(32)

  derivedKey = scryptSync(Buffer.from(masterKey, 'hex'), keySalt, KEY_LENGTH)
  return derivedKey
}

export function clearEncryptionKey(): void {
  if (derivedKey) {
    derivedKey.fill(0)
    derivedKey = null
  }
  if (keySalt) {
    keySalt.fill(0)
    keySalt = null
  }
}

function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([
    ENCRYPTED_HEADER,
    Buffer.from([1]), // Version
    iv,
    authTag,
    keySalt ?? randomBytes(32),
    ciphertext,
  ])
}

function decryptBuffer(encrypted: Buffer, key: Buffer): Buffer {
  const headerEnd = ENCRYPTED_HEADER.length
  if (!encrypted.subarray(0, headerEnd).equals(ENCRYPTED_HEADER)) {
    throw new Error('Invalid encrypted database format')
  }

  const version = encrypted[headerEnd]
  if (version !== 1) {
    throw new Error(`Unsupported encryption version: ${version}`)
  }

  const ivStart = headerEnd + 1
  const authTagStart = ivStart + IV_LENGTH
  const saltStart = authTagStart + AUTH_TAG_LENGTH
  const ciphertextStart = saltStart + 32

  const iv = encrypted.subarray(ivStart, authTagStart)
  const authTag = encrypted.subarray(authTagStart, saltStart)
  const ciphertext = encrypted.subarray(ciphertextStart)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function isEncryptionEnabled(): boolean {
  return !!process.env[DB_ENCRYPTION_KEY_ENV]
}

export function isFileEncrypted(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  const fd = require('node:fs').openSync(filePath, 'r')
  const header = Buffer.alloc(ENCRYPTED_HEADER.length)
  require('node:fs').readSync(fd, header, 0, header.length, 0)
  require('node:fs').closeSync(fd)

  return header.equals(ENCRYPTED_HEADER)
}

export async function loadEncryptedDatabase(
  filePath: string,
): Promise<Buffer | null> {
  const key = getEncryptionKey()
  if (!existsSync(filePath)) return null
  if (key.length === 0) return readFileSync(filePath)
  if (!isFileEncrypted(filePath)) return readFileSync(filePath)

  const encrypted = readFileSync(filePath)
  return decryptBuffer(encrypted, key)
}

export async function saveEncryptedDatabase(
  data: Buffer,
  filePath: string,
): Promise<void> {
  const key = getEncryptionKey()
  if (key.length === 0) {
    writeFileSync(filePath, data)
    return
  }

  const encrypted = encryptBuffer(data, key)
  writeFileSync(filePath, encrypted)
}

export function calculateChecksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function encryptField(plaintext: string): Promise<string> {
  const key = getEncryptionKey()
  if (key.length === 0) return plaintext

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return `enc:${Buffer.concat([iv, authTag, ciphertext]).toString('base64')}`
}

export async function decryptField(encrypted: string): Promise<string> {
  const key = getEncryptionKey()
  if (key.length === 0) return encrypted
  if (!encrypted.startsWith('enc:')) return encrypted

  const data = Buffer.from(encrypted.slice(4), 'base64')
  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

export async function initializeEncryption(): Promise<boolean> {
  return getEncryptionKey().length > 0
}
