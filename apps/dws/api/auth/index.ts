/**
 * DWS Auth Service
 *
 * Integrated authentication for DWS that supports:
 * - Wallet-based authentication (SIWE)
 * - Session management
 * - KMS vault integration for user secrets
 */

import { Database } from 'bun:sqlite'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { type Address, type Hex, isAddress, verifyMessage } from 'viem'

// SQLite row types for type-safe queries
interface SessionRow {
  session_id: string
  address: string
  created_at: number
  expires_at: number
  last_activity_at: number
  metadata: string
}

interface VaultRow {
  address: string
  created_at: number
  updated_at: number
}

interface SecretRow {
  id: string
  name: string
  encrypted_value: string
  created_at: number
  updated_at: number
}

function toAddressFromDb(value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Invalid address in database: ${value}`)
  }
  return value
}

// Types

export interface Session {
  sessionId: string
  address: Address
  createdAt: number
  expiresAt: number
  lastActivityAt: number
  metadata: Record<string, string>
}

export interface AuthChallenge {
  challenge: string
  expiresAt: number
  address: Address
}

export interface UserVault {
  address: Address
  secrets: Map<string, EncryptedSecret>
  createdAt: number
  updatedAt: number
}

export interface EncryptedSecret {
  id: string
  name: string
  encryptedValue: string
  createdAt: number
  updatedAt: number
}

// Auth Service

export class AuthService {
  private db: Database
  private sessions = new Map<string, Session>()
  private challenges = new Map<string, AuthChallenge>()
  private userVaults = new Map<string, UserVault>()
  private sessionDuration = 24 * 60 * 60 * 1000 // 24 hours
  private challengeCleanupInterval: ReturnType<typeof setInterval> | null = null
  private readonly MAX_CHALLENGES = 10000 // Prevent unbounded memory growth

  constructor() {
    this.db = new Database(':memory:')
    this.initDatabase()
    this.loadFromDatabase()
    this.startChallengeCleanup()
  }

  /**
   * Periodically clean up expired challenges to prevent memory leaks
   */
  private startChallengeCleanup(): void {
    // Clean up every minute
    this.challengeCleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [address, challenge] of this.challenges) {
        if (now > challenge.expiresAt) {
          this.challenges.delete(address)
        }
      }
    }, 60_000)
  }

  /**
   * Stop cleanup interval (for testing/shutdown)
   */
  shutdown(): void {
    if (this.challengeCleanupInterval) {
      clearInterval(this.challengeCleanupInterval)
      this.challengeCleanupInterval = null
    }
  }

  private initDatabase() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        metadata TEXT DEFAULT '{}'
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_vaults (
        address TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS vault_secrets (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        name TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (address) REFERENCES user_vaults(address)
      )
    `)

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_sessions_address ON sessions(address)`,
    )
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_vault_secrets_address ON vault_secrets(address)`,
    )
  }

  private loadFromDatabase() {
    // Load sessions - use typed query with generic
    const sessionsQuery = this.db.query<SessionRow, [number]>(
      'SELECT * FROM sessions WHERE expires_at > ?',
    )
    const sessions = sessionsQuery.all(Date.now())

    for (const row of sessions) {
      this.sessions.set(row.session_id, {
        sessionId: row.session_id,
        address: toAddressFromDb(row.address),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastActivityAt: row.last_activity_at,
        metadata: JSON.parse(row.metadata || '{}'),
      })
    }

    // Load user vaults
    const vaultsQuery = this.db.query<VaultRow, []>('SELECT * FROM user_vaults')
    const vaults = vaultsQuery.all()

    for (const vault of vaults) {
      const secretsQuery = this.db.query<SecretRow, [string]>(
        'SELECT * FROM vault_secrets WHERE address = ?',
      )
      const secrets = secretsQuery.all(vault.address)

      const secretsMap = new Map<string, EncryptedSecret>()
      for (const secret of secrets) {
        secretsMap.set(secret.name, {
          id: secret.id,
          name: secret.name,
          encryptedValue: secret.encrypted_value,
          createdAt: secret.created_at,
          updatedAt: secret.updated_at,
        })
      }

      this.userVaults.set(vault.address, {
        address: toAddressFromDb(vault.address),
        secrets: secretsMap,
        createdAt: vault.created_at,
        updatedAt: vault.updated_at,
      })
    }
  }

  // Challenge/Response Authentication

  generateChallenge(address: Address): {
    challenge: string
    expiresAt: number
  } {
    // Prevent memory exhaustion by limiting challenges
    if (this.challenges.size >= this.MAX_CHALLENGES) {
      // Evict oldest expired challenges first
      const now = Date.now()
      for (const [addr, challenge] of this.challenges) {
        if (now > challenge.expiresAt) {
          this.challenges.delete(addr)
        }
        if (this.challenges.size < this.MAX_CHALLENGES) break
      }
      // If still at limit, reject new challenges
      if (this.challenges.size >= this.MAX_CHALLENGES) {
        throw new Error(
          'Too many pending authentication challenges. Try again later.',
        )
      }
    }

    const challenge = `Sign this message to authenticate with DWS:\n\nAddress: ${address}\nNonce: ${randomBytes(16).toString('hex')}\nTimestamp: ${Date.now()}`
    const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes

    this.challenges.set(address.toLowerCase(), {
      challenge,
      expiresAt,
      address,
    })

    return { challenge, expiresAt }
  }

  async verifySignature(
    address: Address,
    signature: Hex,
    message: string,
  ): Promise<boolean> {
    const challenge = this.challenges.get(address.toLowerCase())

    if (!challenge) {
      return false
    }

    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(address.toLowerCase())
      return false
    }

    if (message !== challenge.challenge) {
      return false
    }

    const valid = await verifyMessage({
      address,
      message,
      signature,
    })

    if (valid) {
      this.challenges.delete(address.toLowerCase())
    }

    return valid
  }

  // Session Management

  createSession(
    address: Address,
    metadata: Record<string, string> = {},
  ): Session {
    const sessionId = randomBytes(32).toString('hex')
    const now = Date.now()

    const session: Session = {
      sessionId,
      address,
      createdAt: now,
      expiresAt: now + this.sessionDuration,
      lastActivityAt: now,
      metadata,
    }

    this.sessions.set(sessionId, session)

    this.db.run(
      `INSERT INTO sessions (session_id, address, created_at, expires_at, last_activity_at, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        address,
        now,
        session.expiresAt,
        now,
        JSON.stringify(metadata),
      ],
    )

    // Ensure user vault exists
    this.getOrCreateVault(address)

    return session
  }

  getSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId)

    if (!session) {
      return null
    }

    if (Date.now() > session.expiresAt) {
      this.deleteSession(sessionId)
      return null
    }

    // Update last activity
    session.lastActivityAt = Date.now()
    this.db.run(
      'UPDATE sessions SET last_activity_at = ? WHERE session_id = ?',
      [session.lastActivityAt, sessionId],
    )

    return session
  }

  refreshSession(sessionId: string): Session | null {
    const session = this.getSession(sessionId)
    if (!session) return null

    session.expiresAt = Date.now() + this.sessionDuration
    session.lastActivityAt = Date.now()

    this.db.run(
      'UPDATE sessions SET expires_at = ?, last_activity_at = ? WHERE session_id = ?',
      [session.expiresAt, session.lastActivityAt, sessionId],
    )

    return session
  }

  deleteSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId)
    this.db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId])
    return existed
  }

  getSessionsByAddress(address: Address): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) =>
        s.address.toLowerCase() === address.toLowerCase() &&
        Date.now() < s.expiresAt,
    )
  }

  // User Vault Management

  private getOrCreateVault(address: Address): UserVault {
    const existing = this.userVaults.get(address.toLowerCase())
    if (existing) return existing

    const now = Date.now()
    const vault: UserVault = {
      address,
      secrets: new Map(),
      createdAt: now,
      updatedAt: now,
    }

    this.userVaults.set(address.toLowerCase(), vault)
    this.db.run(
      'INSERT OR IGNORE INTO user_vaults (address, created_at, updated_at) VALUES (?, ?, ?)',
      [address.toLowerCase(), now, now],
    )

    return vault
  }

  storeSecret(address: Address, name: string, value: string): EncryptedSecret {
    const vault = this.getOrCreateVault(address)
    const now = Date.now()

    // Derive encryption key from server secret + address
    // The server secret ensures only this server can decrypt user secrets
    const key = this.deriveEncryptionKey(address)
    const encrypted = this.encrypt(value, key)

    const existing = vault.secrets.get(name)
    const id = existing?.id || randomBytes(16).toString('hex')

    const secret: EncryptedSecret = {
      id,
      name,
      encryptedValue: encrypted,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }

    vault.secrets.set(name, secret)
    vault.updatedAt = now

    if (existing) {
      this.db.run(
        'UPDATE vault_secrets SET encrypted_value = ?, updated_at = ? WHERE id = ?',
        [encrypted, now, id],
      )
    } else {
      this.db.run(
        'INSERT INTO vault_secrets (id, address, name, encrypted_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, address.toLowerCase(), name, encrypted, now, now],
      )
    }

    this.db.run('UPDATE user_vaults SET updated_at = ? WHERE address = ?', [
      now,
      address.toLowerCase(),
    ])

    return secret
  }

  getSecret(address: Address, name: string): string | null {
    const vault = this.userVaults.get(address.toLowerCase())
    if (!vault) return null

    const secret = vault.secrets.get(name)
    if (!secret) return null

    const key = this.deriveEncryptionKey(address)
    return this.decrypt(secret.encryptedValue, key)
  }

  listSecrets(
    address: Address,
  ): Array<{ id: string; name: string; createdAt: number; updatedAt: number }> {
    const vault = this.userVaults.get(address.toLowerCase())
    if (!vault) return []

    return Array.from(vault.secrets.values()).map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
  }

  deleteSecret(address: Address, name: string): boolean {
    const vault = this.userVaults.get(address.toLowerCase())
    if (!vault) return false

    const secret = vault.secrets.get(name)
    if (!secret) return false

    vault.secrets.delete(name)
    vault.updatedAt = Date.now()

    this.db.run('DELETE FROM vault_secrets WHERE id = ?', [secret.id])
    this.db.run('UPDATE user_vaults SET updated_at = ? WHERE address = ?', [
      vault.updatedAt,
      address.toLowerCase(),
    ])

    return true
  }

  // Encryption Helpers (AES-256-GCM)

  /**
   * Derive encryption key from server secret + user address
   * SECURITY: The server secret (DWS_ENCRYPTION_SECRET) MUST be set in production.
   * Without it, only the address is used which provides no security since addresses are public.
   */
  private deriveEncryptionKey(address: Address): Buffer {
    const serverSecret = process.env.DWS_ENCRYPTION_SECRET
    const isProduction = process.env.NODE_ENV === 'production'

    if (!serverSecret) {
      if (isProduction) {
        throw new Error(
          'CRITICAL: DWS_ENCRYPTION_SECRET must be set in production. User secrets cannot be secured without it.',
        )
      }
      console.warn(
        '[AuthService] WARNING: DWS_ENCRYPTION_SECRET not set. User secrets are NOT properly secured. Set this environment variable in production.',
      )
    }
    // Combine server secret with address to create unique key per user
    // Server secret ensures only this server can decrypt; address ensures unique key per user
    const material = `${serverSecret ?? 'INSECURE_DEFAULT_SECRET'}:${address.toLowerCase()}`
    return createHash('sha256').update(material).digest()
  }

  private encrypt(plaintext: string, key: Buffer): string {
    // Use first 32 bytes as key, generate random IV
    const aesKey = Buffer.alloc(32)
    key.copy(aesKey, 0, 0, Math.min(key.length, 32))
    const iv = randomBytes(12)

    const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    // Format: iv (12) + authTag (16) + ciphertext
    return Buffer.concat([iv, authTag, encrypted]).toString('base64')
  }

  private decrypt(ciphertext: string, key: Buffer): string {
    const data = Buffer.from(ciphertext, 'base64')

    // Extract components
    const iv = data.subarray(0, 12)
    const authTag = data.subarray(12, 28)
    const encrypted = data.subarray(28)

    const aesKey = Buffer.alloc(32)
    key.copy(aesKey, 0, 0, Math.min(key.length, 32))

    const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8')
  }

  // Stats

  getStats() {
    const now = Date.now()
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.expiresAt > now,
    )

    return {
      totalSessions: activeSessions.length,
      totalUsers: new Set(activeSessions.map((s) => s.address.toLowerCase()))
        .size,
      totalVaults: this.userVaults.size,
      totalSecrets: Array.from(this.userVaults.values()).reduce(
        (sum, v) => sum + v.secrets.size,
        0,
      ),
    }
  }
}

// Singleton instance
let authService: AuthService | null = null

export function getAuthService(): AuthService {
  if (!authService) {
    authService = new AuthService()
  }
  return authService
}

export function resetAuthService(): void {
  authService = null
}
