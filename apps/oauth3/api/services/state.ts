/**
 * OAuth3 State Service - Database-backed storage for sessions, clients, and auth codes
 * REQUIRES CQL - no in-memory fallback
 */

import { type CQLClient, getCQL } from '@jejunetwork/db'
import type { Address, Hex } from 'viem'
import type {
  AuthProvider,
  AuthSession,
  RegisteredClient,
} from '../../lib/types'

const CQL_DATABASE_ID = process.env.CQL_DATABASE_ID ?? 'oauth3'

// Simple in-memory cache for performance (not for persistence)
interface SimpleCacheClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  delete(key: string): Promise<void>
}

const memoryCache = new Map<string, { value: string; expiresAt: number }>()

function createSimpleCacheClient(): SimpleCacheClient {
  return {
    async get(key: string): Promise<string | null> {
      const entry = memoryCache.get(key)
      if (!entry) return null
      if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
        memoryCache.delete(key)
        return null
      }
      return entry.value
    },
    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0
      memoryCache.set(key, { value, expiresAt })
    },
    async delete(key: string): Promise<void> {
      memoryCache.delete(key)
    },
  }
}

let cqlClient: CQLClient | null = null
let cacheClient: SimpleCacheClient | null = null
let initialized = false

export async function getCQLClient(): Promise<CQLClient> {
  if (!cqlClient) {
    cqlClient = getCQL({
      databaseId: CQL_DATABASE_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })

    const healthy = await cqlClient.isHealthy()
    if (!healthy) {
      throw new Error(
        'OAuth3 requires CovenantSQL for state persistence.\n' +
          'Start CQL with: docker compose up -d cql\n' +
          'Or run: bun run start (which starts all dependencies)',
      )
    }

    await ensureTablesExist()
  }

  return cqlClient
}

function getCache(): SimpleCacheClient {
  if (!cacheClient) {
    cacheClient = createSimpleCacheClient()
  }
  return cacheClient
}

async function ensureTablesExist(): Promise<void> {
  if (initialized) return

  const client = await getCQLClient()
  if (!client) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      address TEXT,
      fid INTEGER,
      email TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      encrypted_pii TEXT,
      ephemeral_key_id TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      client_secret_hash TEXT,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      allowed_providers TEXT NOT NULL,
      owner TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      stake TEXT,
      reputation TEXT,
      moderation TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS client_reports (
      report_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      reporter_address TEXT NOT NULL,
      category TEXT NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolution TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      code_challenge TEXT,
      code_challenge_method TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      token TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    )`,

    `CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      provider TEXT NOT NULL,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_verifier TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,

    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id)`,
  ]

  for (const sql of tables) {
    await client.exec(sql, [], CQL_DATABASE_ID)
  }

  initialized = true
  console.log('[OAuth3] Database initialized')
}

// Session State with encrypted PII
export const sessionState = {
  async save(session: AuthSession): Promise<void> {
    const client = await getCQLClient()
    const cache = getCache()

    // Encrypt PII (address, email, fid) before storage
    let encryptedPII: string | null = null
    if (session.address || session.email || session.fid) {
      const { encryptSessionData } = await import('./kms')
      const encrypted = await encryptSessionData({
        address: session.address,
        email: session.email,
        fid: session.fid,
      })
      encryptedPII = JSON.stringify(encrypted)
    }

    await client.exec(
      `INSERT INTO sessions (session_id, user_id, provider, address, fid, email, created_at, expires_at, metadata, encrypted_pii)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
       expires_at = excluded.expires_at, metadata = excluded.metadata, encrypted_pii = excluded.encrypted_pii`,
      [
        session.sessionId,
        session.userId,
        session.provider,
        null, // Don't store plaintext address
        null, // Don't store plaintext fid
        null, // Don't store plaintext email
        session.createdAt,
        session.expiresAt,
        JSON.stringify(session.metadata),
        encryptedPII,
      ],
      CQL_DATABASE_ID,
    )

    // Cache with encrypted data only
    const cachedSession = {
      ...session,
      address: undefined,
      email: undefined,
      fid: undefined,
    }
    await cache.set(
      `session:${session.sessionId}`,
      JSON.stringify(cachedSession),
      Math.floor((session.expiresAt - Date.now()) / 1000),
    )
  },

  async get(
    sessionId: string,
    options?: { decryptPII?: boolean },
  ): Promise<AuthSession | null> {
    const cache = getCache()

    // For cached sessions, we don't have PII (it's encrypted in DB)
    if (!options?.decryptPII) {
      const cached = await cache.get(`session:${sessionId}`)
      if (cached) {
        return JSON.parse(cached) as AuthSession
      }
    }

    const client = await getCQLClient()
    const result = await client.query<SessionRow>(
      'SELECT * FROM sessions WHERE session_id = ? AND expires_at > ?',
      [sessionId, Date.now()],
      CQL_DATABASE_ID,
    )

    if (!result.rows[0]) return null

    const row = result.rows[0]
    let session = rowToSession(row)

    // Decrypt PII if requested and available
    if (options?.decryptPII && row.encrypted_pii) {
      try {
        const { decryptSessionData } = await import('./kms')
        const encrypted = JSON.parse(row.encrypted_pii) as {
          ciphertext: string
          iv: string
          keyId: string
          encryptedAt: number
        }
        const decrypted = await decryptSessionData(encrypted)
        session = {
          ...session,
          address: decrypted.address as `0x${string}` | undefined,
          email: decrypted.email as string | undefined,
          fid: decrypted.fid as number | undefined,
        }
      } catch (err) {
        console.error('[SessionState] Failed to decrypt PII:', err)
        // Continue without PII rather than failing
      }
    }

    // Cache without PII
    const cachedSession = {
      ...session,
      address: undefined,
      email: undefined,
      fid: undefined,
    }
    await cache.set(
      `session:${sessionId}`,
      JSON.stringify(cachedSession),
      Math.floor((session.expiresAt - Date.now()) / 1000),
    )

    return session
  },

  async delete(sessionId: string): Promise<void> {
    const client = await getCQLClient()
    const cache = getCache()

    await client.exec(
      'DELETE FROM sessions WHERE session_id = ?',
      [sessionId],
      CQL_DATABASE_ID,
    )

    await cache.delete(`session:${sessionId}`)
  },

  async findByUserId(userId: string): Promise<AuthSession[]> {
    const client = await getCQLClient()
    const result = await client.query<SessionRow>(
      'SELECT * FROM sessions WHERE user_id = ? AND expires_at > ?',
      [userId, Date.now()],
      CQL_DATABASE_ID,
    )

    return result.rows.map(rowToSession)
  },

  async updateExpiry(sessionId: string, newExpiry: number): Promise<void> {
    const client = await getCQLClient()
    const cache = getCache()

    await client.exec(
      'UPDATE sessions SET expires_at = ? WHERE session_id = ?',
      [newExpiry, sessionId],
      CQL_DATABASE_ID,
    )

    await cache.delete(`session:${sessionId}`)
  },
}

// Client State
export const clientState = {
  async save(client: RegisteredClient): Promise<void> {
    const db = await getCQLClient()
    const cache = getCache()

    await db.exec(
      `INSERT INTO clients (client_id, client_secret, client_secret_hash, name, redirect_uris, allowed_providers, owner, created_at, active, stake, reputation, moderation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
       name = excluded.name, redirect_uris = excluded.redirect_uris,
       allowed_providers = excluded.allowed_providers, active = excluded.active,
       stake = excluded.stake, reputation = excluded.reputation, moderation = excluded.moderation,
       client_secret_hash = excluded.client_secret_hash`,
      [
        client.clientId,
        client.clientSecret ?? null, // Legacy support
        client.clientSecretHash ? JSON.stringify(client.clientSecretHash) : null,
        client.name,
        JSON.stringify(client.redirectUris),
        JSON.stringify(client.allowedProviders),
        client.owner,
        client.createdAt,
        client.active ? 1 : 0,
        client.stake ? JSON.stringify(client.stake) : null,
        client.reputation ? JSON.stringify(client.reputation) : null,
        client.moderation ? JSON.stringify(client.moderation) : null,
      ],
      CQL_DATABASE_ID,
    )

    // Don't cache the secret hash
    const cachedClient = {
      ...client,
      clientSecret: undefined,
      clientSecretHash: undefined,
    }
    await cache.set(
      `client:${client.clientId}`,
      JSON.stringify(cachedClient),
      3600,
    )
  },

  async get(clientId: string): Promise<RegisteredClient | null> {
    const cache = getCache()
    const cached = await cache.get(`client:${clientId}`)
    if (cached) {
      return JSON.parse(cached) as RegisteredClient
    }

    const db = await getCQLClient()
    const result = await db.query<ClientRow>(
      'SELECT * FROM clients WHERE client_id = ?',
      [clientId],
      CQL_DATABASE_ID,
    )

    if (!result.rows[0]) return null

    const client = rowToClient(result.rows[0])
    await cache.set(`client:${clientId}`, JSON.stringify(client), 3600)

    return client
  },

  async delete(clientId: string): Promise<void> {
    const db = await getCQLClient()
    const cache = getCache()

    await db.exec(
      'DELETE FROM clients WHERE client_id = ?',
      [clientId],
      CQL_DATABASE_ID,
    )

    await cache.delete(`client:${clientId}`)
  },
}

// Authorization Code State
export const authCodeState = {
  async save(
    code: string,
    data: {
      clientId: string
      redirectUri: string
      userId: string
      scope: string[]
      expiresAt: number
      codeChallenge?: string
      codeChallengeMethod?: string
    },
  ): Promise<void> {
    const client = await getCQLClient()

    await client.exec(
      `INSERT INTO auth_codes (code, client_id, redirect_uri, user_id, scope, expires_at, code_challenge, code_challenge_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        data.clientId,
        data.redirectUri,
        data.userId,
        JSON.stringify(data.scope),
        data.expiresAt,
        data.codeChallenge ?? null,
        data.codeChallengeMethod ?? null,
      ],
      CQL_DATABASE_ID,
    )
  },

  async get(code: string): Promise<{
    clientId: string
    redirectUri: string
    userId: string
    scope: string[]
    expiresAt: number
    codeChallenge?: string
    codeChallengeMethod?: string
  } | null> {
    const client = await getCQLClient()
    const result = await client.query<AuthCodeRow>(
      'SELECT * FROM auth_codes WHERE code = ? AND expires_at > ?',
      [code, Date.now()],
      CQL_DATABASE_ID,
    )

    if (!result.rows[0]) return null

    const row = result.rows[0]
    return {
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      userId: row.user_id,
      scope: JSON.parse(row.scope) as string[],
      expiresAt: row.expires_at,
      codeChallenge: row.code_challenge ?? undefined,
      codeChallengeMethod: row.code_challenge_method ?? undefined,
    }
  },

  async delete(code: string): Promise<void> {
    const client = await getCQLClient()
    await client.exec(
      'DELETE FROM auth_codes WHERE code = ?',
      [code],
      CQL_DATABASE_ID,
    )
  },
}

// Refresh Token State
export const refreshTokenState = {
  async save(
    token: string,
    data: {
      sessionId: string
      clientId: string
      userId: string
      expiresAt: number
    },
  ): Promise<void> {
    const client = await getCQLClient()

    await client.exec(
      `INSERT INTO refresh_tokens (token, session_id, client_id, user_id, created_at, expires_at, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [
        token,
        data.sessionId,
        data.clientId,
        data.userId,
        Date.now(),
        data.expiresAt,
      ],
      CQL_DATABASE_ID,
    )
  },

  async get(token: string): Promise<{
    sessionId: string
    clientId: string
    userId: string
    expiresAt: number
    revoked: boolean
  } | null> {
    const client = await getCQLClient()
    const result = await client.query<RefreshTokenRow>(
      'SELECT * FROM refresh_tokens WHERE token = ?',
      [token],
      CQL_DATABASE_ID,
    )

    if (!result.rows[0]) return null

    const row = result.rows[0]
    return {
      sessionId: row.session_id,
      clientId: row.client_id,
      userId: row.user_id,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
    }
  },

  async revoke(token: string): Promise<void> {
    const client = await getCQLClient()
    await client.exec(
      'UPDATE refresh_tokens SET revoked = 1 WHERE token = ?',
      [token],
      CQL_DATABASE_ID,
    )
  },

  async revokeAllForSession(sessionId: string): Promise<void> {
    const client = await getCQLClient()
    await client.exec(
      'UPDATE refresh_tokens SET revoked = 1 WHERE session_id = ?',
      [sessionId],
      CQL_DATABASE_ID,
    )
  },
}

// OAuth State (for social providers)
export const oauthStateStore = {
  async save(
    state: string,
    data: {
      nonce: string
      provider: string
      clientId: string
      redirectUri: string
      codeVerifier?: string
      expiresAt: number
    },
  ): Promise<void> {
    const client = await getCQLClient()

    await client.exec(
      `INSERT INTO oauth_states (state, nonce, provider, client_id, redirect_uri, code_verifier, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state,
        data.nonce,
        data.provider,
        data.clientId,
        data.redirectUri,
        data.codeVerifier ?? null,
        Date.now(),
        data.expiresAt,
      ],
      CQL_DATABASE_ID,
    )
  },

  async get(state: string): Promise<{
    nonce: string
    provider: string
    clientId: string
    redirectUri: string
    codeVerifier?: string
  } | null> {
    const client = await getCQLClient()
    const result = await client.query<OAuthStateRow>(
      'SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?',
      [state, Date.now()],
      CQL_DATABASE_ID,
    )

    if (!result.rows[0]) return null

    const row = result.rows[0]
    return {
      nonce: row.nonce,
      provider: row.provider,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeVerifier: row.code_verifier ?? undefined,
    }
  },

  async delete(state: string): Promise<void> {
    const client = await getCQLClient()
    await client.exec(
      'DELETE FROM oauth_states WHERE state = ?',
      [state],
      CQL_DATABASE_ID,
    )
  },
}

// Initialize database and default client
export async function initializeState(): Promise<void> {
  await ensureTablesExist()

  // Ensure default client exists
  const defaultClient = await clientState.get('jeju-default')
  if (!defaultClient) {
    await clientState.save({
      clientId: 'jeju-default',
      name: 'Jeju Network Apps',
      redirectUris: [
        'https://*.jejunetwork.org/callback',
        'http://localhost:*/callback',
      ],
      allowedProviders: [
        'wallet',
        'farcaster',
        'github',
        'google',
        'twitter',
        'discord',
      ] as AuthProvider[],
      owner: '0x0000000000000000000000000000000000000000' as Address,
      createdAt: Date.now(),
      active: true,
    })
    console.log('[OAuth3] Default client created')
  }
}

// Row types
interface SessionRow {
  session_id: string
  user_id: string
  provider: string
  address: string | null
  fid: number | null
  email: string | null
  created_at: number
  expires_at: number
  metadata: string
  encrypted_pii: string | null
}

interface ClientRow {
  client_id: string
  client_secret: string | null
  client_secret_hash: string | null
  name: string
  redirect_uris: string
  allowed_providers: string
  owner: string
  created_at: number
  active: number
  stake: string | null
  reputation: string | null
  moderation: string | null
}

interface AuthCodeRow {
  code: string
  client_id: string
  redirect_uri: string
  user_id: string
  scope: string
  expires_at: number
  code_challenge: string | null
  code_challenge_method: string | null
}

interface RefreshTokenRow {
  token: string
  session_id: string
  client_id: string
  user_id: string
  created_at: number
  expires_at: number
  revoked: number
}

interface OAuthStateRow {
  state: string
  nonce: string
  provider: string
  client_id: string
  redirect_uri: string
  code_verifier: string | null
  created_at: number
  expires_at: number
}

// Row converters
function rowToSession(row: SessionRow): AuthSession {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    provider: row.provider as AuthProvider,
    address: row.address as Address | undefined,
    fid: row.fid ?? undefined,
    email: row.email ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    metadata: JSON.parse(row.metadata) as Record<string, string>,
  }
}

function rowToClient(row: ClientRow): RegisteredClient {
  return {
    clientId: row.client_id,
    clientSecret: row.client_secret as Hex | undefined, // Legacy
    clientSecretHash: row.client_secret_hash
      ? (JSON.parse(row.client_secret_hash) as RegisteredClient['clientSecretHash'])
      : undefined,
    name: row.name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    allowedProviders: JSON.parse(row.allowed_providers) as AuthProvider[],
    owner: row.owner as Address,
    createdAt: row.created_at,
    active: row.active === 1,
    stake: row.stake
      ? (JSON.parse(row.stake) as RegisteredClient['stake'])
      : undefined,
    reputation: row.reputation
      ? (JSON.parse(row.reputation) as RegisteredClient['reputation'])
      : undefined,
    moderation: row.moderation
      ? (JSON.parse(row.moderation) as RegisteredClient['moderation'])
      : undefined,
  }
}

// Client Report State
interface ClientReport {
  reportId: string
  clientId: string
  reporterAddress: string
  category: string
  evidence: string
  status: 'pending' | 'resolved' | 'dismissed'
  createdAt: number
  resolvedAt?: number
  resolution?: string
}

export const clientReportState = {
  async save(report: ClientReport): Promise<void> {
    const db = await getCQLClient()

    await db.exec(
      `INSERT INTO client_reports (report_id, client_id, reporter_address, category, evidence, status, created_at, resolved_at, resolution)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_id) DO UPDATE SET
       status = excluded.status, resolved_at = excluded.resolved_at, resolution = excluded.resolution`,
      [
        report.reportId,
        report.clientId,
        report.reporterAddress,
        report.category,
        report.evidence,
        report.status,
        report.createdAt,
        report.resolvedAt ?? null,
        report.resolution ?? null,
      ],
      CQL_DATABASE_ID,
    )
  },

  async get(reportId: string): Promise<ClientReport | null> {
    const db = await getCQLClient()
    const result = await db.query<{
      report_id: string
      client_id: string
      reporter_address: string
      category: string
      evidence: string
      status: string
      created_at: number
      resolved_at: number | null
      resolution: string | null
    }>(
      'SELECT * FROM client_reports WHERE report_id = ?',
      [reportId],
      CQL_DATABASE_ID,
    )

    if (!result.rows[0]) return null
    const row = result.rows[0]

    return {
      reportId: row.report_id,
      clientId: row.client_id,
      reporterAddress: row.reporter_address,
      category: row.category,
      evidence: row.evidence,
      status: row.status as ClientReport['status'],
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
      resolution: row.resolution ?? undefined,
    }
  },

  async getByClient(clientId: string): Promise<ClientReport[]> {
    const db = await getCQLClient()
    const result = await db.query<{
      report_id: string
      client_id: string
      reporter_address: string
      category: string
      evidence: string
      status: string
      created_at: number
      resolved_at: number | null
      resolution: string | null
    }>(
      'SELECT * FROM client_reports WHERE client_id = ? ORDER BY created_at DESC',
      [clientId],
      CQL_DATABASE_ID,
    )

    return result.rows.map((row) => ({
      reportId: row.report_id,
      clientId: row.client_id,
      reporterAddress: row.reporter_address,
      category: row.category,
      evidence: row.evidence,
      status: row.status as ClientReport['status'],
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
      resolution: row.resolution ?? undefined,
    }))
  },

  async hasReportedRecently(
    clientId: string,
    reporterAddress: string,
    withinMs: number = 24 * 60 * 60 * 1000,
  ): Promise<boolean> {
    const db = await getCQLClient()
    const cutoff = Date.now() - withinMs

    const result = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM client_reports WHERE client_id = ? AND reporter_address = ? AND created_at > ?',
      [clientId, reporterAddress.toLowerCase(), cutoff],
      CQL_DATABASE_ID,
    )

    return (result.rows[0]?.count ?? 0) > 0
  },
}

/**
 * Verify client secret using hash comparison.
 * Supports both new hashed secrets and legacy plaintext (for migration).
 *
 * SECURITY: Uses constant-time comparison via KMS service.
 */
export async function verifyClientSecret(
  clientId: string,
  clientSecret: string | undefined,
): Promise<{ valid: boolean; error?: string }> {
  const client = await clientState.get(clientId)

  if (!client) {
    return { valid: false, error: 'invalid_client' }
  }

  if (!client.active) {
    return { valid: false, error: 'client_disabled' }
  }

  // Public clients (no secret) - allow for PKCE flows
  if (!client.clientSecretHash && !client.clientSecret) {
    return { valid: true }
  }

  // Confidential clients must provide valid secret
  if (!clientSecret) {
    return { valid: false, error: 'client_secret_required' }
  }

  // Prefer hashed secret verification
  if (client.clientSecretHash) {
    // Use KMS for secure hash verification
    const { verifyClientSecretHash } = await import('./kms')
    const isValid = await verifyClientSecretHash(
      clientSecret,
      client.clientSecretHash,
    )
    if (!isValid) {
      return { valid: false, error: 'invalid_client_secret' }
    }
    return { valid: true }
  }

  // Legacy plaintext comparison (for migration only)
  // TODO: Remove after all clients migrated
  if (client.clientSecret) {
    console.warn(
      `[State] Client ${clientId} using legacy plaintext secret. Run migration.`,
    )
    const storedSecret = client.clientSecret
    if (storedSecret.length !== clientSecret.length) {
      return { valid: false, error: 'invalid_client_secret' }
    }

    let result = 0
    for (let i = 0; i < storedSecret.length; i++) {
      result |= storedSecret.charCodeAt(i) ^ clientSecret.charCodeAt(i)
    }

    if (result !== 0) {
      return { valid: false, error: 'invalid_client_secret' }
    }

    return { valid: true }
  }

  return { valid: false, error: 'invalid_client_secret' }
}

export { getCache }
