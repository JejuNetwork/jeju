/**
 * Database Encryption at Rest
 *
 * Production-grade encryption for SQLite database files.
 * Uses AES-256-GCM for authenticated encryption.
 *
 * Features:
 * - Transparent encryption/decryption
 * - Key derivation from master key
 * - Integrity verification via GCM auth tag
 * - Automatic key rotation support
 * - Secure memory handling
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
} from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Simple logger since @jejunetwork/shared may not be available
const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`[db-encryption] ${msg}`, data ?? ''),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`[db-encryption] ${msg}`, data ?? ''),
  debug: (msg: string, data?: Record<string, unknown>) =>
    console.debug(`[db-encryption] ${msg}`, data ?? ''),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(`[db-encryption] ${msg}`, data ?? ''),
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Environment variable for the database encryption key */
const DB_ENCRYPTION_KEY_ENV = 'FACTORY_DB_ENCRYPTION_KEY'

/** Salt for key derivation */
const KEY_DERIVATION_SALT_ENV = 'FACTORY_DB_KEY_SALT'

/** Encryption algorithm */
const ALGORITHM = 'aes-256-gcm'

/** IV length in bytes */
const IV_LENGTH = 12

/** Auth tag length in bytes */
const AUTH_TAG_LENGTH = 16

/** Key length in bytes */
const KEY_LENGTH = 32

/** Scrypt parameters for key derivation */
const SCRYPT_PARAMS = {
  N: 2 ** 17, // CPU/memory cost (131072)
  r: 8, // Block size
  p: 1, // Parallelization
  maxmem: 256 * 1024 * 1024, // 256 MB
}

/** File header to identify encrypted databases */
const ENCRYPTED_HEADER = Buffer.from('JEJU_ENC_DB_V1')

// ============================================================================
// KEY MANAGEMENT
// ============================================================================

let derivedKey: Buffer | null = null
let keySalt: Buffer | null = null

/**
 * Get or derive the encryption key
 * Uses scrypt for secure key derivation from master key
 */
async function getEncryptionKey(): Promise<Buffer> {
  if (derivedKey) {
    return derivedKey
  }

  const masterKey = process.env[DB_ENCRYPTION_KEY_ENV]
  const isProduction = process.env.NODE_ENV === 'production'

  if (!masterKey) {
    if (isProduction) {
      throw new Error(
        `CRITICAL: ${DB_ENCRYPTION_KEY_ENV} must be set in production. ` +
          'Generate with: openssl rand -hex 32',
      )
    }
    log.warn(
      `${DB_ENCRYPTION_KEY_ENV} not set - database will not be encrypted. ` +
        'THIS IS INSECURE FOR PRODUCTION',
    )
    return Buffer.alloc(0)
  }

  // Get or generate salt
  const saltHex = process.env[KEY_DERIVATION_SALT_ENV]
  if (saltHex) {
    keySalt = Buffer.from(saltHex, 'hex')
  } else {
    keySalt = randomBytes(32)
    log.warn(
      `${KEY_DERIVATION_SALT_ENV} not set - using random salt. ` +
        'Set this in production for consistent key derivation.',
    )
  }

  // Derive key using scrypt
  return new Promise((resolve, reject) => {
    const masterKeyBuffer = Buffer.from(masterKey, 'hex')

    scrypt(
      masterKeyBuffer,
      keySalt as Buffer,
      KEY_LENGTH,
      SCRYPT_PARAMS,
      (err, key) => {
        if (err) {
          reject(new Error(`Key derivation failed: ${err.message}`))
          return
        }
        derivedKey = key
        log.info('Database encryption key derived successfully')
        resolve(key)
      },
    )
  })
}

/**
 * Clear the cached encryption key from memory
 * Call this when shutting down or rotating keys
 */
export function clearEncryptionKey(): void {
  if (derivedKey) {
    derivedKey.fill(0) // Securely zero out the key
    derivedKey = null
  }
  if (keySalt) {
    keySalt.fill(0)
    keySalt = null
  }
  log.info('Encryption key cleared from memory')
}

// ============================================================================
// ENCRYPTION/DECRYPTION
// ============================================================================

/**
 * Encrypt a buffer using AES-256-GCM
 */
function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Format: header(14) + version(1) + iv(12) + authTag(16) + salt(32) + ciphertext
  const result = Buffer.concat([
    ENCRYPTED_HEADER,
    Buffer.from([1]), // Version 1
    iv,
    authTag,
    keySalt ?? randomBytes(32),
    ciphertext,
  ])

  return result
}

/**
 * Decrypt a buffer using AES-256-GCM
 */
function decryptBuffer(encrypted: Buffer, key: Buffer): Buffer {
  // Parse the encrypted format
  const headerEnd = ENCRYPTED_HEADER.length
  const header = encrypted.subarray(0, headerEnd)

  if (!header.equals(ENCRYPTED_HEADER)) {
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

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return plaintext
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Check if a file is encrypted
 */
export function isFileEncrypted(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false
  }

  const header = Buffer.alloc(ENCRYPTED_HEADER.length)
  const fd = require('node:fs').openSync(filePath, 'r')
  require('node:fs').readSync(fd, header, 0, header.length, 0)
  require('node:fs').closeSync(fd)

  return header.equals(ENCRYPTED_HEADER)
}

/**
 * Encrypt a database file
 */
export async function encryptDatabaseFile(
  sourcePath: string,
  destPath?: string,
): Promise<void> {
  const key = await getEncryptionKey()
  if (key.length === 0) {
    log.warn('Skipping encryption - no key configured')
    return
  }

  if (!existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`)
  }

  if (isFileEncrypted(sourcePath)) {
    log.info('Database is already encrypted', { path: sourcePath })
    return
  }

  const plaintext = readFileSync(sourcePath)
  const encrypted = encryptBuffer(plaintext, key)

  const outputPath = destPath ?? sourcePath
  writeFileSync(outputPath, encrypted)

  log.info('Database encrypted successfully', {
    source: sourcePath,
    dest: outputPath,
    originalSize: plaintext.length,
    encryptedSize: encrypted.length,
  })
}

/**
 * Decrypt a database file
 */
export async function decryptDatabaseFile(
  sourcePath: string,
  destPath?: string,
): Promise<void> {
  const key = await getEncryptionKey()
  if (key.length === 0) {
    log.warn('Skipping decryption - no key configured')
    return
  }

  if (!existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`)
  }

  if (!isFileEncrypted(sourcePath)) {
    log.info('Database is not encrypted', { path: sourcePath })
    return
  }

  const encrypted = readFileSync(sourcePath)
  const plaintext = decryptBuffer(encrypted, key)

  const outputPath = destPath ?? sourcePath
  writeFileSync(outputPath, plaintext)

  log.info('Database decrypted successfully', {
    source: sourcePath,
    dest: outputPath,
    encryptedSize: encrypted.length,
    decryptedSize: plaintext.length,
  })
}

/**
 * Load an encrypted database file into memory (for SQLite)
 * Returns the decrypted content as a Buffer
 */
export async function loadEncryptedDatabase(
  filePath: string,
): Promise<Buffer | null> {
  const key = await getEncryptionKey()

  if (!existsSync(filePath)) {
    return null
  }

  // If no encryption key, return file as-is
  if (key.length === 0) {
    return readFileSync(filePath)
  }

  // Check if file is encrypted
  if (!isFileEncrypted(filePath)) {
    log.warn('Database file is not encrypted - consider encrypting it', {
      path: filePath,
    })
    return readFileSync(filePath)
  }

  const encrypted = readFileSync(filePath)
  return decryptBuffer(encrypted, key)
}

/**
 * Save an in-memory database to an encrypted file
 */
export async function saveEncryptedDatabase(
  data: Buffer,
  filePath: string,
): Promise<void> {
  const key = await getEncryptionKey()

  // If no encryption key, save as-is
  if (key.length === 0) {
    writeFileSync(filePath, data)
    return
  }

  const encrypted = encryptBuffer(data, key)
  writeFileSync(filePath, encrypted)

  log.debug('Database saved with encryption', {
    path: filePath,
    size: encrypted.length,
  })
}

// ============================================================================
// SECURE FIELD ENCRYPTION
// ============================================================================

/**
 * Encrypt a single field value (for sensitive columns)
 */
export async function encryptField(plaintext: string): Promise<string> {
  const key = await getEncryptionKey()
  if (key.length === 0) {
    return plaintext
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Format: iv + authTag + ciphertext, base64 encoded
  const result = Buffer.concat([iv, authTag, ciphertext])
  return `enc:${result.toString('base64')}`
}

/**
 * Decrypt a single field value
 */
export async function decryptField(encrypted: string): Promise<string> {
  const key = await getEncryptionKey()
  if (key.length === 0) {
    return encrypted
  }

  // Check for encryption prefix
  if (!encrypted.startsWith('enc:')) {
    return encrypted // Not encrypted
  }

  const data = Buffer.from(encrypted.slice(4), 'base64')

  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return plaintext.toString('utf8')
}

/**
 * Check if a field value is encrypted
 */
export function isFieldEncrypted(value: string): boolean {
  return value.startsWith('enc:')
}

// ============================================================================
// DATABASE CHECKSUM
// ============================================================================

/**
 * Calculate a checksum for database integrity verification
 */
export function calculateChecksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Verify database integrity
 */
export async function verifyDatabaseIntegrity(
  filePath: string,
  expectedChecksum?: string,
): Promise<{ valid: boolean; checksum: string }> {
  const data = await loadEncryptedDatabase(filePath)
  if (!data) {
    return { valid: false, checksum: '' }
  }

  const checksum = calculateChecksum(data)
  const valid = expectedChecksum ? checksum === expectedChecksum : true

  return { valid, checksum }
}

// ============================================================================
// KEY ROTATION
// ============================================================================

/**
 * Re-encrypt database with a new key
 * Used for key rotation
 */
export async function rotateEncryptionKey(
  filePath: string,
  newKeyHex: string,
): Promise<void> {
  // Load with current key
  const data = await loadEncryptedDatabase(filePath)
  if (!data) {
    throw new Error(`Database not found: ${filePath}`)
  }

  // Create backup
  const backupPath = `${filePath}.backup.${Date.now()}`
  writeFileSync(backupPath, readFileSync(filePath))
  log.info('Created backup before key rotation', { backup: backupPath })

  // Clear current key
  clearEncryptionKey()

  // Set new key
  process.env[DB_ENCRYPTION_KEY_ENV] = newKeyHex

  // Re-encrypt with new key
  await saveEncryptedDatabase(data, filePath)

  log.info('Database re-encrypted with new key', { path: filePath })

  // Securely delete backup after successful rotation
  // (In production, keep backups for a period)
  // unlinkSync(backupPath)
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize database encryption
 * Call this at application startup
 */
export async function initializeEncryption(): Promise<boolean> {
  const key = await getEncryptionKey()
  return key.length > 0
}

/**
 * Check if encryption is enabled
 */
export function isEncryptionEnabled(): boolean {
  return !!process.env[DB_ENCRYPTION_KEY_ENV]
}
