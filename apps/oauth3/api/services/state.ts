/**
 * OAuth3 State Service - Database-backed storage for sessions, clients, and auth codes
 * Set USE_MEMORY_STATE=true to use in-memory storage for development/testing
 */

import { getLocalhostHost, isProductionEnv } from '@jejunetwork/config'
import type { SQLitClient } from '@jejunetwork/db'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import type { Address } from 'viem'
import type {
  AuthProvider,
  AuthSession,
  HashedClientSecret,
  RegisteredClient,
} from '../../lib/types'

const SQLIT_DATABASE_ID = process.env.SQLIT_DATABASE_ID ?? 'oauth3'

let sqlitClient: SQLitClient | null = null
let cacheClient: CacheClient | null = null
let initialized = false

async function getSQLitClient(): Promise<SQLitClient> {
  if (!sqlitClient) {
    const { getSQLit } = await import('@jejunetwork/db')
    sqlitClient = getSQLit({
      databaseId: SQLIT_DATABASE_ID,
      timeoutMs: 30000,
      debug: true,
    })
  }

  if (!sqlitClient) {
    throw new Error('SQLit client not available')
  }

  const healthy = await sqlitClient.isHealthy()
  if (!healthy) {
    throw new Error('SQLit client not available')
  }

  return sqlitClient
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('oauth3')
  }
  return cacheClient
}


async function ensureTablesExist(): Promise<void> {
  if (initialized) return

  const client = await getSQLitClient()

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
      metadata TEXT NOT NULL DEFAULT '{}'
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

    `CREATE TABLE IF NOT EXISTS passkeys (
      credential_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL,
      device_name TEXT NOT NULL,
      transports TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS passkey_challenges (
      challenge_id TEXT PRIMARY KEY,
      user_id TEXT,
      challenge TEXT NOT NULL,
      origin TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,

    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON passkey_challenges(expires_at)`,
  ]

  for (const sql of tables) {
    await client.exec(sql, [], SQLIT_DATABASE_ID)
  }

  initialized = true
  console.log('[OAuth3] Database initialized')
}

// Session State
export const sessionState = {
  async save(session: AuthSession): Promise<void> {
    const client = await getSQLitClient()
    const cache = getCache()

    await client.exec(
      `INSERT INTO sessions (session_id, user_id, provider, address, fid, email, created_at, expires_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
        expires_at = excluded.expires_at, metadata = excluded.metadata`,
      [
        session.sessionId,
        session.userId,
        session.provider,
        session.address ?? null,
        session.fid ?? null,
        session.email ?? null,
        session.createdAt,
        session.expiresAt,
        JSON.stringify(session.metadata),
      ],
      SQLIT_DATABASE_ID,
    )

    await cache.set(
      `session:${session.sessionId}`,
      JSON.stringify(session),
      Math.floor((session.expiresAt - Date.now()) / 1000),
    )
  },

  async get(sessionId: string): Promise<AuthSession | null> {
    const cache = getCache()
    const cached = await cache.get(`session:${sessionId}`)
    if (cached) {
      return JSON.parse(cached) as AuthSession
    }

    const client = await getSQLitClient()

    const result = await client.query<SessionRow>(
      'SELECT * FROM sessions WHERE session_id = ? AND expires_at > ?',
      [sessionId, Date.now()],
      SQLIT_DATABASE_ID,
    )

    if (!result.rows[0]) return null

    const session = rowToSession(result.rows[0])
    await cache.set(
      `session:${sessionId}`,
      JSON.stringify(session),
      Math.floor((session.expiresAt - Date.now()) / 1000),
    )

    return session
  },

  async delete(sessionId: string): Promise<void> {
    const db = await getSQLitClient()
    const cache = getCache()

    await db.exec(
      'DELETE FROM sessions WHERE session_id = ?',
      [sessionId],
      SQLIT_DATABASE_ID,
    )

    await cache.delete(`session:${sessionId}`)
  },

  async findByUserId(userId: string): Promise<AuthSession[]> {
    const client = await getSQLitClient()

    const result = await client.query<SessionRow>(
      'SELECT * FROM sessions WHERE user_id = ? AND expires_at > ?',
      [userId, Date.now()],
      SQLIT_DATABASE_ID,
    )

    return result.rows.map(rowToSession)
  },

  async updateExpiry(sessionId: string, newExpiry: number): Promise<void> {
    const client = await getSQLitClient()
    const cache = getCache()

    await client.exec(
      'UPDATE sessions SET expires_at = ? WHERE session_id = ?',
      [newExpiry, sessionId],
      SQLIT_DATABASE_ID,
    )

    await cache.delete(`session:${sessionId}`)
  },
}

// Client State
export const clientState = {
  async save(client: RegisteredClient): Promise<void> {
    const db = await getSQLitClient()
    const cache = getCache()

    await db.exec(
      `INSERT INTO clients (client_id, client_secret_hash, name, redirect_uris, allowed_providers, owner, created_at, active, stake, reputation, moderation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET
        client_secret_hash = excluded.client_secret_hash,
        name = excluded.name, redirect_uris = excluded.redirect_uris,
        allowed_providers = excluded.allowed_providers, active = excluded.active,
        stake = excluded.stake, reputation = excluded.reputation, moderation = excluded.moderation`,
      [
        client.clientId,
        JSON.stringify(client.clientSecretHash),
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
      SQLIT_DATABASE_ID,
    )

    await cache.set(`client:${client.clientId}`, JSON.stringify(client), 3600)
  },

  async get(clientId: string): Promise<RegisteredClient | null> {
    const cache = getCache()
    const cached = await cache.get(`client:${clientId}`)
    if (cached) {
      return JSON.parse(cached) as RegisteredClient
    }

    const db = await getSQLitClient()

    const result = await db.query<ClientRow>(
      'SELECT * FROM clients WHERE client_id = ?',
      [clientId],
      SQLIT_DATABASE_ID,
    )

    if (!result.rows[0]) return null

    const client = rowToClient(result.rows[0])
    await cache.set(`client:${clientId}`, JSON.stringify(client), 3600)

    return client
  },

  async delete(clientId: string): Promise<void> {
    const db = await getSQLitClient()
    const cache = getCache()

    await db.exec(
      'DELETE FROM clients WHERE client_id = ?',
      [clientId],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()

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
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()

    const result = await client.query<AuthCodeRow>(
      'SELECT * FROM auth_codes WHERE code = ? AND expires_at > ?',
      [code, Date.now()],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()
    await client.exec(
      'DELETE FROM auth_codes WHERE code = ?',
      [code],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()

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
      SQLIT_DATABASE_ID,
    )
  },

  async get(token: string): Promise<{
    sessionId: string
    clientId: string
    userId: string
    expiresAt: number
    revoked: boolean
  } | null> {
    const client = await getSQLitClient()

    const result = await client.query<RefreshTokenRow>(
      'SELECT * FROM refresh_tokens WHERE token = ?',
      [token],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()
    await client.exec(
      'UPDATE refresh_tokens SET revoked = 1 WHERE token = ?',
      [token],
      SQLIT_DATABASE_ID,
    )
  },

  async revokeAllForSession(sessionId: string): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      'UPDATE refresh_tokens SET revoked = 1 WHERE session_id = ?',
      [sessionId],
      SQLIT_DATABASE_ID,
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
    const client = await getSQLitClient()

    // SECURITY: Encrypt PKCE code verifier before storing
    let encryptedVerifier: string | null = null
    if (data.codeVerifier) {
      const { encryptCodeVerifier } = await import('./kms')
      encryptedVerifier = await encryptCodeVerifier(data.codeVerifier, state)
    }

    await client.exec(
      `INSERT INTO oauth_states (state, nonce, provider, client_id, redirect_uri, code_verifier, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        state,
        data.nonce,
        data.provider,
        data.clientId,
        data.redirectUri,
        encryptedVerifier,
        Date.now(),
        data.expiresAt,
      ],
      SQLIT_DATABASE_ID,
    )
  },

  async get(state: string): Promise<{
    nonce: string
    provider: string
    clientId: string
    redirectUri: string
    codeVerifier?: string
  } | null> {
    const client = await getSQLitClient()

    const result = await client.query<OAuthStateRow>(
      'SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?',
      [state, Date.now()],
      SQLIT_DATABASE_ID,
    )

    if (!result.rows[0]) return null

    const row = result.rows[0]

    // SECURITY: Decrypt PKCE code verifier
    let codeVerifier: string | undefined
    if (row.code_verifier) {
      const { decryptCodeVerifier } = await import('./kms')
      codeVerifier = await decryptCodeVerifier(row.code_verifier, state)
    }

    return {
      nonce: row.nonce,
      provider: row.provider,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeVerifier,
    }
  },

  async delete(state: string): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      'DELETE FROM oauth_states WHERE state = ?',
      [state],
      SQLIT_DATABASE_ID,
    )
  },
}

export type PasskeyChallengeType = 'registration' | 'authentication'

export interface PasskeyCredentialRecord {
  credentialId: string
  userId: string
  rpId: string
  publicKey: string
  counter: number
  deviceName: string
  transports: string[]
  createdAt: number
  lastUsedAt: number
}

export interface PasskeyChallengeRecord {
  challengeId: string
  userId: string | null
  challenge: string
  origin: string
  type: PasskeyChallengeType
  createdAt: number
  expiresAt: number
}

export const passkeyState = {
  async saveChallenge(challenge: PasskeyChallengeRecord): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      `INSERT INTO passkey_challenges (challenge_id, user_id, challenge, origin, type, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        challenge.challengeId,
        challenge.userId,
        challenge.challenge,
        challenge.origin,
        challenge.type,
        challenge.createdAt,
        challenge.expiresAt,
      ],
      SQLIT_DATABASE_ID,
    )
  },

  async getChallenge(challengeId: string): Promise<PasskeyChallengeRecord | null> {
    const client = await getSQLitClient()
    const result = await client.query<{
      challenge_id: string
      user_id: string | null
      challenge: string
      origin: string
      type: string
      created_at: number
      expires_at: number
    }>(
      'SELECT * FROM passkey_challenges WHERE challenge_id = ?',
      [challengeId],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    if (!row) return null
    if (row.expires_at < Date.now()) {
      await this.deleteChallenge(challengeId)
      return null
    }
    const type =
      row.type === 'registration' || row.type === 'authentication'
        ? row.type
        : null
    if (!type) {
      throw new Error('Invalid passkey challenge type')
    }
    return {
      challengeId: row.challenge_id,
      userId: row.user_id,
      challenge: row.challenge,
      origin: row.origin,
      type,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  },

  async deleteChallenge(challengeId: string): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      'DELETE FROM passkey_challenges WHERE challenge_id = ?',
      [challengeId],
      SQLIT_DATABASE_ID,
    )
  },

  async saveCredential(credential: PasskeyCredentialRecord): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      `INSERT INTO passkeys (credential_id, user_id, rp_id, public_key, counter, device_name, transports, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(credential_id) DO UPDATE SET
        counter = excluded.counter, last_used_at = excluded.last_used_at`,
      [
        credential.credentialId,
        credential.userId,
        credential.rpId,
        credential.publicKey,
        credential.counter,
        credential.deviceName,
        JSON.stringify(credential.transports),
        credential.createdAt,
        credential.lastUsedAt,
      ],
      SQLIT_DATABASE_ID,
    )
  },

  async getCredential(
    credentialId: string,
  ): Promise<PasskeyCredentialRecord | null> {
    const client = await getSQLitClient()
    const result = await client.query<{
      credential_id: string
      user_id: string
      rp_id: string
      public_key: string
      counter: number
      device_name: string
      transports: string | null
      created_at: number
      last_used_at: number
    }>(
      'SELECT * FROM passkeys WHERE credential_id = ?',
      [credentialId],
      SQLIT_DATABASE_ID,
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      credentialId: row.credential_id,
      userId: row.user_id,
      rpId: row.rp_id,
      publicKey: row.public_key,
      counter: row.counter,
      deviceName: row.device_name,
      transports: row.transports ? (JSON.parse(row.transports) as string[]) : [],
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }
  },

  async listCredentialsByRpId(rpId: string): Promise<PasskeyCredentialRecord[]> {
    const client = await getSQLitClient()
    const result = await client.query<{
      credential_id: string
      user_id: string
      rp_id: string
      public_key: string
      counter: number
      device_name: string
      transports: string | null
      created_at: number
      last_used_at: number
    }>(
      'SELECT * FROM passkeys WHERE rp_id = ?',
      [rpId],
      SQLIT_DATABASE_ID,
    )
    return result.rows.map((row) => ({
      credentialId: row.credential_id,
      userId: row.user_id,
      rpId: row.rp_id,
      publicKey: row.public_key,
      counter: row.counter,
      deviceName: row.device_name,
      transports: row.transports ? (JSON.parse(row.transports) as string[]) : [],
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }))
  },

  async updateCredentialCounter(
    credentialId: string,
    counter: number,
  ): Promise<void> {
    const client = await getSQLitClient()
    await client.exec(
      'UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?',
      [counter, Date.now(), credentialId],
      SQLIT_DATABASE_ID,
    )
  },
}

// Initialize database and default clients
export async function initializeState(): Promise<void> {
  await ensureTablesExist()

  // Empty hash for public clients (no secret required, supports PKCE flows)
  const publicClientSecretHash: HashedClientSecret = {
    hash: '',
    salt: '',
    algorithm: 'pbkdf2',
    version: 1,
  }

  // SECURITY: Default clients have restricted redirect URIs
  // Production should use explicit redirect URIs per client registration
  const isDevMode = !isProductionEnv()

  // Ensure default client exists
  const defaultClient = await clientState.get('jeju-default')
  if (!defaultClient) {
    // All Jeju domains for mainnet, testnet, and localhost
    const defaultRedirectUris = [
      // Mainnet
      'https://auth.jejunetwork.org/callback',
      'https://auth.jejunetwork.org/auth/callback',
      'https://crucible.jejunetwork.org/callback',
      'https://crucible.jejunetwork.org/auth/callback',
      'https://autocrat.jejunetwork.org/callback',
      'https://autocrat.jejunetwork.org/auth/callback',
      'https://factory.jejunetwork.org/callback',
      'https://factory.jejunetwork.org/auth/callback',
      'https://gateway.jejunetwork.org/callback',
      'https://gateway.jejunetwork.org/auth/callback',
      'https://bazaar.jejunetwork.org/callback',
      'https://bazaar.jejunetwork.org/auth/callback',
      'https://dws.jejunetwork.org/callback',
      'https://dws.jejunetwork.org/auth/callback',
      'https://cloud.jejunetwork.org/callback',
      'https://cloud.jejunetwork.org/auth/callback',
      'https://wallet.jejunetwork.org/callback',
      'https://wallet.jejunetwork.org/auth/callback',
      // Testnet
      'https://auth.testnet.jejunetwork.org/callback',
      'https://auth.testnet.jejunetwork.org/auth/callback',
      'https://crucible.testnet.jejunetwork.org/callback',
      'https://crucible.testnet.jejunetwork.org/auth/callback',
      'https://autocrat.testnet.jejunetwork.org/callback',
      'https://autocrat.testnet.jejunetwork.org/auth/callback',
      'https://factory.testnet.jejunetwork.org/callback',
      'https://factory.testnet.jejunetwork.org/auth/callback',
      'https://gateway.testnet.jejunetwork.org/callback',
      'https://gateway.testnet.jejunetwork.org/auth/callback',
      'https://bazaar.testnet.jejunetwork.org/callback',
      'https://bazaar.testnet.jejunetwork.org/auth/callback',
      'https://dws.testnet.jejunetwork.org/callback',
      'https://dws.testnet.jejunetwork.org/auth/callback',
      'https://cloud.testnet.jejunetwork.org/callback',
      'https://cloud.testnet.jejunetwork.org/auth/callback',
      'https://wallet.testnet.jejunetwork.org/callback',
      'https://wallet.testnet.jejunetwork.org/auth/callback',
      // Localhost for development
      `http://localhost:3000/callback`,
      `http://localhost:3001/callback`,
      `http://localhost:4200/callback`,
      `http://localhost:3000/auth/callback`,
      `http://localhost:3001/auth/callback`,
      `http://localhost:4200/auth/callback`,
      `http://${getLocalhostHost()}:3000/callback`,
      `http://${getLocalhostHost()}:3001/callback`,
      `http://${getLocalhostHost()}:4200/callback`,
      `http://${getLocalhostHost()}:3000/auth/callback`,
      `http://${getLocalhostHost()}:3001/auth/callback`,
      `http://${getLocalhostHost()}:4200/auth/callback`,
    ]

    await clientState.save({
      clientId: 'jeju-default',
      clientSecretHash: publicClientSecretHash,
      name: 'Jeju Network Apps',
      redirectUris: defaultRedirectUris,
      allowedProviders: [
        'wallet',
        'passkey',
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

  // Create app-specific clients for each Jeju app
  const jejuApps = [
    { id: 'crucible.apps.jeju', name: 'Crucible', host: 'crucible' },
    { id: 'autocrat.apps.jeju', name: 'Autocrat', host: 'autocrat' },
    { id: 'factory.apps.jeju', name: 'Factory', host: 'factory' },
    { id: 'gateway.apps.jeju', name: 'Gateway', host: 'gateway' },
    { id: 'bazaar.apps.jeju', name: 'Bazaar', host: 'bazaar' },
    { id: 'dws.apps.jeju', name: 'DWS', host: 'dws' },
    { id: 'wallet.apps.jeju', name: 'Wallet', host: 'wallet' },
    { id: 'cloud.apps.jeju', name: 'Cloud', host: 'cloud' },
    { id: 'crucible', name: 'Crucible (Legacy)', host: 'crucible' },
    { id: 'autocrat', name: 'Autocrat (Legacy)', host: 'autocrat' },
    { id: 'factory', name: 'Factory (Legacy)', host: 'factory' },
    { id: 'gateway', name: 'Gateway (Legacy)', host: 'gateway' },
    { id: 'bazaar', name: 'Bazaar (Legacy)', host: 'bazaar' },
    { id: 'dws', name: 'DWS (Legacy)', host: 'dws' },
    { id: 'wallet', name: 'Wallet (Legacy)', host: 'wallet' },
    { id: 'cloud', name: 'Cloud (Legacy)', host: 'cloud' },
  ]

  for (const app of jejuApps) {
    // Each app gets its own client with appropriate redirect URIs
    const appRedirectUris = [
      `https://${app.host}.jejunetwork.org/callback`,
      `https://${app.host}.testnet.jejunetwork.org/callback`,
      `http://localhost:3000/callback`,
      `http://localhost:3001/callback`,
      `http://localhost:4200/callback`,
      `https://${app.host}.jejunetwork.org/auth/callback`,
      `https://${app.host}.testnet.jejunetwork.org/auth/callback`,
      `http://localhost:3000/auth/callback`,
      `http://localhost:3001/auth/callback`,
      `http://localhost:4200/auth/callback`,
      `http://${getLocalhostHost()}:3000/callback`,
      `http://${getLocalhostHost()}:3001/callback`,
      `http://${getLocalhostHost()}:4200/callback`,
      `http://${getLocalhostHost()}:3000/auth/callback`,
      `http://${getLocalhostHost()}:3001/auth/callback`,
      `http://${getLocalhostHost()}:4200/auth/callback`,
    ]

    const existingClient = await clientState.get(app.id)
    if (!existingClient) {
      await clientState.save({
        clientId: app.id,
        clientSecretHash: publicClientSecretHash,
        name: app.name,
        redirectUris: appRedirectUris,
        allowedProviders: [
          'wallet',
          'passkey',
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
      console.log(`[OAuth3] ${app.name} client created`)
    } else {
      // Update existing client to ensure all redirect URIs are present
      const existingUris = new Set(existingClient.redirectUris)
      const missingUris = appRedirectUris.filter((uri) => !existingUris.has(uri))
      if (missingUris.length > 0) {
        await clientState.save({
          ...existingClient,
          redirectUris: [...existingClient.redirectUris, ...missingUris],
        })
        console.log(`[OAuth3] ${app.name} client updated with ${missingUris.length} new redirect URIs`)
      }
    }
  }

  // Ensure eliza-cloud client exists (for Eliza Cloud app)
  const elizaCloudClient = await clientState.get('eliza-cloud')
  if (!elizaCloudClient) {
    // SECURITY: Explicit redirect URIs, no wildcards
    const elizaRedirectUris = isDevMode
      ? [
          'https://cloud.elizaos.com/callback',
          'https://cloud.elizaos.com/auth/callback',
          'https://eliza.cloud/callback',
          'https://eliza.cloud/auth/callback',
          `http://${getLocalhostHost()}:3000/callback`,
          `http://${getLocalhostHost()}:3001/callback`,
        ]
      : [
          'https://cloud.elizaos.com/callback',
          'https://cloud.elizaos.com/auth/callback',
          'https://eliza.cloud/callback',
          'https://eliza.cloud/auth/callback',
        ]

    await clientState.save({
      clientId: 'eliza-cloud',
      clientSecretHash: publicClientSecretHash,
      name: 'Eliza Cloud',
      redirectUris: elizaRedirectUris,
      allowedProviders: [
        'wallet',
        'passkey',
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
    console.log('[OAuth3] Eliza Cloud client created')
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
}

interface ClientRow {
  client_id: string
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
  const clientSecretHash = row.client_secret_hash
    ? (JSON.parse(row.client_secret_hash) as HashedClientSecret)
    : { hash: '', salt: '', algorithm: 'pbkdf2' as const, version: 1 }

  return {
    clientId: row.client_id,
    clientSecretHash,
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
    const db = await getSQLitClient()

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
      SQLIT_DATABASE_ID,
    )
  },

  async get(reportId: string): Promise<ClientReport | null> {
    const db = await getSQLitClient()

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
      SQLIT_DATABASE_ID,
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
    const db = await getSQLitClient()

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
      SQLIT_DATABASE_ID,
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
    const db = await getSQLitClient()
    const cutoff = Date.now() - withinMs

    const result = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM client_reports WHERE client_id = ? AND reporter_address = ? AND created_at > ?',
      [clientId, reporterAddress.toLowerCase(), cutoff],
      SQLIT_DATABASE_ID,
    )

    return (result.rows[0]?.count ?? 0) > 0
  },
}

/**
 * Verify client secret using PBKDF2 hash comparison to prevent timing attacks.
 * Returns true if the client exists, is active, and the secret matches.
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

  // Public clients (empty hash) - allow for PKCE flows
  if (!client.clientSecretHash.hash) {
    return { valid: true }
  }

  // Confidential clients must provide valid secret
  if (!clientSecret) {
    return { valid: false, error: 'client_secret_required' }
  }

  // Verify using PBKDF2 hash comparison (constant-time via the hash algorithm)
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

export { getSQLitClient, getCache }
