/**
 * SSH Terminal Gateway - WebSocket-based SSH proxy with wallet auth
 *
 * Storage: Credentials persisted to SQLit; sessions/tokens are in-memory (ephemeral by design).
 * @environment DWS_VAULT_KEY - Required in production (32+ chars)
 */

import { randomBytes } from 'node:crypto'
import {
  getCurrentNetwork,
  getLocalhostHost,
  getSQLitUrl,
  isProductionEnv,
  isTestMode,
} from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import type { ServerWebSocket } from 'bun'
import { type Subprocess, spawn } from 'bun'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { verifyMessage } from 'viem'

// ============ Types ============

export interface SSHConnection {
  write: (data: string) => void
  onData: (callback: (data: string) => void) => void
  onClose: (callback: (code: number) => void) => void
  resize: (cols: number, rows: number) => void
  close: () => void
  getTerminalSize: () => { cols: number; rows: number }
}

export interface SSHCredentials {
  id: string
  computeId: string
  owner: Address
  host: string
  port: number
  username: string
  privateKey: string // Encrypted in storage
  fingerprint: string
  createdAt: number
  lastUsedAt: number
  rotatedAt: number
}

export interface SSHSession {
  id: string
  computeId: string
  owner: Address
  credentialId: string
  startedAt: number
  endedAt: number | null
  clientIp: string
  status: 'connecting' | 'active' | 'closed' | 'error'
  bytesIn: number
  bytesOut: number
  commandCount: number
  lastActivityAt: number
}

export interface TerminalMessage {
  type: 'data' | 'resize' | 'ping' | 'pong' | 'error' | 'close'
  data?: string
  cols?: number
  rows?: number
  error?: string
}

export interface AccessToken {
  token: string
  computeId: string
  owner: Address
  createdAt: number
  expiresAt: number
  used: boolean
}

// ============ Configuration ============

interface SSHGatewayConfig {
  maxSessionDurationMs: number
  idleTimeoutMs: number
  maxSessionsPerUser: number
  maxConcurrentSessions: number
  tokenValidityMs: number
  keyRotationIntervalMs: number
  sshTimeout: number
}

const DEFAULT_CONFIG: SSHGatewayConfig = {
  maxSessionDurationMs: 4 * 60 * 60 * 1000, // 4 hours
  idleTimeoutMs: 30 * 60 * 1000, // 30 minutes idle
  maxSessionsPerUser: 5,
  maxConcurrentSessions: 100,
  tokenValidityMs: 5 * 60 * 1000, // 5 minute token validity
  keyRotationIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
  sshTimeout: 30000, // 30 second connection timeout
}

// ============ State ============

// SQLit persistence for credentials
const SQLIT_DATABASE_ID = 'dws-ssh-gateway'
let sqlitClient: SQLitClient | null = null
let tablesInitialized = false
let useSQLit = false

// In-memory storage for credentials (fallback for tests)
const memoryCredentials = new Map<string, SSHCredentials>()

// Session state - tied to local SSH processes (cannot be distributed)
const sessions = new Map<string, SSHSession>()
const userSessions = new Map<string, Set<string>>() // lowercase owner -> session ids
const sshProcesses = new Map<string, Subprocess>()
const auditLog: AuditEntry[] = []

// Distributed cache for access tokens (enables multi-server deployments)
let tokenCache: CacheClient | null = null

function getTokenCache(): CacheClient {
  if (!tokenCache) {
    tokenCache = getCacheClient('ssh-access-tokens')
  }
  return tokenCache
}

interface AuditEntry {
  timestamp: number
  action: string
  sessionId: string
  owner: Address
  computeId: string
  details: string
}

interface CredentialRow {
  id: string
  compute_id: string
  owner: string
  host: string
  port: number
  username: string
  private_key: string
  fingerprint: string
  created_at: number
  last_used_at: number
  rotated_at: number
}

async function initSQLit(): Promise<boolean> {
  if (isTestMode()) {
    return false
  }

  const sqlitUrl = getSQLitUrl()
  if (!sqlitUrl) {
    return false
  }

  sqlitClient = getSQLit({ databaseId: SQLIT_DATABASE_ID, timeout: 30000 })
  const healthy = await sqlitClient.isHealthy().catch(() => false)

  if (!healthy) {
    console.warn('[SSHGateway] SQLit not available, using in-memory storage')
    sqlitClient = null
    return false
  }

  await ensureTablesExist()
  useSQLit = true
  console.log('[SSHGateway] Using SQLit for credential persistence')
  return true
}

async function ensureTablesExist(): Promise<void> {
  if (tablesInitialized || !sqlitClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS ssh_credentials (
      id TEXT PRIMARY KEY,
      compute_id TEXT NOT NULL UNIQUE,
      owner TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      private_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      rotated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ssh_cred_owner ON ssh_credentials(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_ssh_cred_compute ON ssh_credentials(compute_id)`,
  ]

  for (const ddl of tables) {
    await sqlitClient.exec(ddl, [], SQLIT_DATABASE_ID)
  }

  tablesInitialized = true
}

function rowToCredential(row: CredentialRow): SSHCredentials {
  return {
    id: row.id,
    computeId: row.compute_id,
    owner: row.owner as Address,
    host: row.host,
    port: row.port,
    username: row.username,
    privateKey: row.private_key,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    rotatedAt: row.rotated_at,
  }
}

// Storage operations for credentials
const credentialStorage = {
  async get(id: string): Promise<SSHCredentials | null> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.query<CredentialRow>(
        'SELECT * FROM ssh_credentials WHERE id = ?',
        [id],
        SQLIT_DATABASE_ID,
      )
      return result.rows[0] ? rowToCredential(result.rows[0]) : null
    }
    return memoryCredentials.get(id) ?? null
  },

  async getByComputeId(computeId: string): Promise<SSHCredentials | null> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.query<CredentialRow>(
        'SELECT * FROM ssh_credentials WHERE compute_id = ?',
        [computeId],
        SQLIT_DATABASE_ID,
      )
      return result.rows[0] ? rowToCredential(result.rows[0]) : null
    }
    for (const cred of memoryCredentials.values()) {
      if (cred.computeId === computeId) return cred
    }
    return null
  },

  async set(credential: SSHCredentials): Promise<void> {
    if (useSQLit && sqlitClient) {
      await sqlitClient.exec(
        `INSERT OR REPLACE INTO ssh_credentials 
         (id, compute_id, owner, host, port, username, private_key, fingerprint, created_at, last_used_at, rotated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          credential.id,
          credential.computeId,
          credential.owner,
          credential.host,
          credential.port,
          credential.username,
          credential.privateKey,
          credential.fingerprint,
          credential.createdAt,
          credential.lastUsedAt,
          credential.rotatedAt,
        ],
        SQLIT_DATABASE_ID,
      )
    } else {
      memoryCredentials.set(credential.id, credential)
    }
  },

  async delete(id: string): Promise<boolean> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.exec(
        'DELETE FROM ssh_credentials WHERE id = ?',
        [id],
        SQLIT_DATABASE_ID,
      )
      return result.rowsAffected > 0
    }
    return memoryCredentials.delete(id)
  },

  async count(): Promise<number> {
    if (useSQLit && sqlitClient) {
      const result = await sqlitClient.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM ssh_credentials',
        [],
        SQLIT_DATABASE_ID,
      )
      return result.rows[0]?.count ?? 0
    }
    return memoryCredentials.size
  },
}

// Initialize storage on module load
initSQLit().catch((error) => {
  console.error(
    '[SSHGateway] SQLit initialization failed:',
    error instanceof Error ? error.message : String(error),
  )
})

// Metrics for Prometheus
const gatewayMetrics = {
  sessionsStarted: 0,
  sessionsEnded: 0,
  authFailures: 0,
  connectionErrors: 0,
  totalBytesIn: 0,
  totalBytesOut: 0,
}

export async function getSSHGatewayMetrics() {
  return {
    ...gatewayMetrics,
    activeSessions: Array.from(sessions.values()).filter(
      (s) => s.status === 'active',
    ).length,
    registeredCredentials: await credentialStorage.count(),
    pendingTokens: 0, // Token count not available from distributed cache
    storageBackend: useSQLit ? 'sqlit' : 'memory',
    tokenStorage: 'distributed',
  }
}

// ============ Main Gateway ============

export class SSHGateway {
  private config: SSHGatewayConfig
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private keyRotationInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<SSHGatewayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start the gateway
   */
  start(): void {
    // Cleanup expired sessions and tokens
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60000) // Every minute

    // Key rotation check
    this.keyRotationInterval = setInterval(
      () => {
        this.rotateExpiredKeys()
      },
      60 * 60 * 1000,
    ) // Every hour

    console.log('[SSHGateway] Started')
  }

  /**
   * Stop the gateway
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    if (this.keyRotationInterval) {
      clearInterval(this.keyRotationInterval)
      this.keyRotationInterval = null
    }

    // Close all active sessions
    for (const [sessionId, process] of sshProcesses) {
      process.kill()
      sshProcesses.delete(sessionId)
    }

    console.log('[SSHGateway] Stopped')
  }

  // ============ Credential Management ============

  /**
   * Register SSH credentials for a compute instance
   */
  async registerCredentials(params: {
    computeId: string
    owner: Address
    host: string
    port?: number
    username: string
    privateKey: string
  }): Promise<string> {
    const id = `ssh-cred-${Date.now()}-${randomBytes(4).toString('hex')}`
    const now = Date.now()

    // Encrypt key and calculate fingerprint
    const encryptedKey = await this.encryptKey(params.privateKey)
    const fingerprint = await this.calculateFingerprint(params.privateKey)

    const credential: SSHCredentials = {
      id,
      computeId: params.computeId,
      owner: params.owner,
      host: params.host,
      port: params.port ?? 22,
      username: params.username,
      privateKey: encryptedKey,
      fingerprint,
      createdAt: now,
      lastUsedAt: now,
      rotatedAt: now,
    }

    await credentialStorage.set(credential)

    this.audit(
      'credential_registered',
      '',
      params.owner,
      params.computeId,
      `Registered SSH credentials for ${params.host}`,
    )

    console.log(
      `[SSHGateway] Registered credentials ${id} for compute ${params.computeId}`,
    )
    return id
  }

  /**
   * Rotate SSH key for a compute instance
   */
  async rotateKey(computeId: string, newPrivateKey: string): Promise<void> {
    const credential = await credentialStorage.getByComputeId(computeId)
    if (!credential) {
      throw new Error(`No credentials found for compute: ${computeId}`)
    }

    credential.privateKey = await this.encryptKey(newPrivateKey)
    credential.fingerprint = await this.calculateFingerprint(newPrivateKey)
    credential.rotatedAt = Date.now()
    await credentialStorage.set(credential)

    this.audit(
      'key_rotated',
      '',
      credential.owner,
      computeId,
      'SSH key rotated',
    )
    console.log(`[SSHGateway] Rotated key for compute ${computeId}`)
  }

  /**
   * Remove credentials
   */
  async removeCredentials(computeId: string): Promise<void> {
    const credential = await credentialStorage.getByComputeId(computeId)
    if (credential) {
      this.audit(
        'credential_removed',
        '',
        credential.owner,
        computeId,
        'Credentials removed',
      )
      await credentialStorage.delete(credential.id)
    }
  }

  // ============ Access Control ============

  /**
   * Generate a one-time access token for SSH connection
   * User must sign a message to get a token
   */
  async generateAccessToken(params: {
    computeId: string
    owner: Address
    signature: Hex
    message: string
  }): Promise<string> {
    // Verify ownership signature
    const isValid = await verifyMessage({
      address: params.owner,
      message: params.message,
      signature: params.signature,
    })

    if (!isValid) {
      gatewayMetrics.authFailures++
      throw new Error('Invalid signature')
    }

    // Verify message contains correct computeId and timestamp
    const expectedPrefix = `SSH Access Request for ${params.computeId} at `
    if (!params.message.startsWith(expectedPrefix)) {
      throw new Error('Invalid message format')
    }

    const timestamp = parseInt(params.message.slice(expectedPrefix.length), 10)
    if (Number.isNaN(timestamp) || Date.now() - timestamp > 300000) {
      throw new Error('Message expired')
    }

    // Check credential exists and owner matches
    const credential = await credentialStorage.getByComputeId(params.computeId)
    if (!credential) {
      throw new Error('No credentials for compute')
    }

    if (credential.owner.toLowerCase() !== params.owner.toLowerCase()) {
      gatewayMetrics.authFailures++
      throw new Error('Not authorized')
    }

    // Check session limits
    const ownerKey = params.owner.toLowerCase()
    const userSessionSet = userSessions.get(ownerKey)
    if (
      userSessionSet &&
      userSessionSet.size >= this.config.maxSessionsPerUser
    ) {
      throw new Error('Session limit reached')
    }

    // Generate token
    const token = randomBytes(32).toString('hex')
    const now = Date.now()

    const accessToken: AccessToken = {
      token,
      computeId: params.computeId,
      owner: params.owner,
      createdAt: now,
      expiresAt: now + this.config.tokenValidityMs,
      used: false,
    }

    // Store in distributed cache with TTL
    const cache = getTokenCache()
    const ttlSeconds = Math.ceil(this.config.tokenValidityMs / 1000)
    await cache.set(`token:${token}`, JSON.stringify(accessToken), ttlSeconds)

    this.audit(
      'token_generated',
      '',
      params.owner,
      params.computeId,
      'Access token generated',
    )

    return token
  }

  /**
   * Validate and consume an access token
   */
  async validateToken(token: string): Promise<AccessToken> {
    const cache = getTokenCache()
    const cached = await cache.get(`token:${token}`)

    if (!cached) {
      gatewayMetrics.authFailures++
      throw new Error('Invalid token')
    }

    const accessToken = JSON.parse(cached) as AccessToken

    if (accessToken.used) {
      gatewayMetrics.authFailures++
      throw new Error('Token already used')
    }

    if (Date.now() > accessToken.expiresAt) {
      await cache.delete(`token:${token}`)
      gatewayMetrics.authFailures++
      throw new Error('Token expired')
    }

    // Mark as used and update in cache
    accessToken.used = true
    await cache.set(`token:${token}`, JSON.stringify(accessToken), 60) // Keep for 60s after use

    return accessToken
  }

  // ============ Session Management ============

  /**
   * Start an SSH session
   */
  async startSession(params: {
    token: string
    clientIp: string
  }): Promise<SSHSession> {
    // Validate token
    const accessToken = await this.validateToken(params.token)

    // Get credentials
    const credential = await credentialStorage.getByComputeId(
      accessToken.computeId,
    )
    if (!credential) {
      throw new Error('No credentials')
    }

    // Check concurrent session limit
    if (sessions.size >= this.config.maxConcurrentSessions) {
      throw new Error('Server at capacity')
    }

    const sessionId = `ssh-session-${Date.now()}-${randomBytes(4).toString('hex')}`
    const now = Date.now()

    const session: SSHSession = {
      id: sessionId,
      computeId: accessToken.computeId,
      owner: accessToken.owner,
      credentialId: credential.id,
      startedAt: now,
      endedAt: null,
      clientIp: params.clientIp,
      status: 'connecting',
      bytesIn: 0,
      bytesOut: 0,
      commandCount: 0,
      lastActivityAt: now,
    }

    sessions.set(sessionId, session)

    const ownerKey = accessToken.owner.toLowerCase()
    const userSessionSet = userSessions.get(ownerKey) ?? new Set()
    userSessionSet.add(sessionId)
    userSessions.set(ownerKey, userSessionSet)

    // Update credential usage
    credential.lastUsedAt = now
    await credentialStorage.set(credential)

    this.audit(
      'session_started',
      sessionId,
      accessToken.owner,
      accessToken.computeId,
      `Session started from ${params.clientIp}`,
    )
    gatewayMetrics.sessionsStarted++

    return session
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SSHSession | null {
    return sessions.get(sessionId) ?? null
  }

  /**
   * End an SSH session
   */
  endSession(sessionId: string, reason?: string): void {
    const session = sessions.get(sessionId)
    if (!session) return

    session.status = 'closed'
    session.endedAt = Date.now()

    // Kill SSH process if running
    const process = sshProcesses.get(sessionId)
    if (process) {
      process.kill()
      sshProcesses.delete(sessionId)
    }

    this.audit(
      'session_ended',
      sessionId,
      session.owner,
      session.computeId,
      reason ?? 'Session closed',
    )
    gatewayMetrics.sessionsEnded++
    gatewayMetrics.totalBytesIn += session.bytesIn
    gatewayMetrics.totalBytesOut += session.bytesOut
    console.log(
      `[SSHGateway] Session ${sessionId} ended: ${reason ?? 'closed'}`,
    )
  }

  /**
   * Get user's active sessions
   */
  getUserSessions(owner: Address): SSHSession[] {
    const ownerKey = owner.toLowerCase()
    const sessionIds = userSessions.get(ownerKey)
    if (!sessionIds) return []

    return Array.from(sessionIds)
      .map((id) => sessions.get(id))
      .filter((s): s is SSHSession => !!s && s.status === 'active')
  }

  // ============ SSH Connection ============

  /**
   * Connect to SSH and return process for streaming
   */
  async connect(sessionId: string): Promise<SSHConnection> {
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }

    const credential = await credentialStorage.get(session.credentialId)
    if (!credential) {
      throw new Error('Credential not found')
    }

    // Decrypt key and write to secure temp file
    const keyContent = await this.decryptKey(credential.privateKey)

    // Use a more secure temp directory with random suffix
    const randomSuffix = randomBytes(16).toString('hex')
    const keyFile = `/tmp/.ssh-key-${sessionId}-${randomSuffix}`
    await Bun.write(keyFile, keyContent, { mode: 0o600 })

    // Double-ensure permissions (Bun.write mode may not always work)
    await Bun.spawn(['chmod', '600', keyFile]).exited

    // Start SSH process
    const sshProcess = spawn({
      cmd: [
        'ssh',
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'UserKnownHostsFile=/dev/null',
        '-o',
        `ConnectTimeout=${Math.floor(this.config.sshTimeout / 1000)}`,
        '-o',
        'ServerAliveInterval=30',
        '-o',
        'ServerAliveCountMax=3',
        '-i',
        keyFile,
        '-p',
        credential.port.toString(),
        '-tt', // Force pseudo-terminal
        `${credential.username}@${credential.host}`,
      ],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    sshProcesses.set(sessionId, sshProcess)
    session.status = 'active'

    const dataCallbacks: Array<(data: string) => void> = []
    const closeCallbacks: Array<(code: number) => void> = []

    const readOutput = async () => {
      const reader = sshProcess.stdout.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        session.bytesOut += value.length
        session.lastActivityAt = Date.now()

        for (const cb of dataCallbacks) {
          cb(text)
        }
      }
    }

    const readStderr = async () => {
      const reader = sshProcess.stderr.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        session.bytesOut += value.length

        for (const cb of dataCallbacks) {
          cb(text)
        }
      }
    }

    // Start reading
    readOutput().catch(() => {})
    readStderr().catch(() => {})

    // Store keyFile path for cleanup
    const keyFilePath = keyFile

    // Handle process exit
    sshProcess.exited.then((code) => {
      // Securely clean up key file
      Bun.spawn(['shred', '-u', keyFilePath]).exited.catch(() => {
        // Fallback to rm if shred not available
        Bun.spawn(['rm', '-f', keyFilePath])
      })

      session.status = 'closed'
      session.endedAt = Date.now()
      sshProcesses.delete(sessionId)

      // Track connection errors (non-zero exit that isn't user-initiated)
      if (code && code !== 0 && code !== 130) {
        // 130 = SIGINT (Ctrl+C)
        gatewayMetrics.connectionErrors++
      }

      for (const cb of closeCallbacks) {
        cb(code ?? 0)
      }

      this.audit(
        'ssh_disconnected',
        sessionId,
        session.owner,
        session.computeId,
        `Exit code: ${code}`,
      )
    })

    // Store current terminal size for the session
    let terminalCols = 80
    let terminalRows = 24

    return {
      write: (data: string) => {
        session.bytesIn += data.length
        session.commandCount++
        session.lastActivityAt = Date.now()
        sshProcess.stdin.write(data)
      },
      onData: (callback) => {
        dataCallbacks.push(callback)
      },
      onClose: (callback) => {
        closeCallbacks.push(callback)
      },
      resize: (cols: number, rows: number) => {
        terminalCols = cols
        terminalRows = rows
        // Send SIGWINCH to SSH process if it supports it
        // Note: Without a proper PTY, SSH may not respond to resize
        // For full terminal support, consider using node-pty
        try {
          // SSH OpenSSH client supports ~. escape sequences for some operations
          // but resize requires actual SIGWINCH or pty
          // Log the resize request for debugging
          console.log(
            `[SSHGateway] Resize requested: ${cols}x${rows} (requires PTY for full support)`,
          )
        } catch {
          // Resize not supported without PTY
        }
      },
      close: () => {
        sshProcess.kill()
      },
      getTerminalSize: () => ({ cols: terminalCols, rows: terminalRows }),
    }
  }

  // ============ WebSocket Handler ============

  /**
   * Handle WebSocket terminal connection
   */
  async handleWebSocket(
    ws: ServerWebSocket<{ sessionId: string; ssh?: SSHConnection }>,
    sessionId: string,
  ): Promise<void> {
    const session = sessions.get(sessionId)
    if (!session) {
      ws.close(1008, 'Session not found')
      return
    }

    const ssh = await this.connect(sessionId)

    // Forward SSH output to WebSocket
    ssh.onData((data) => {
      const msg: TerminalMessage = { type: 'data', data }
      ws.send(JSON.stringify(msg))
    })

    // Handle SSH close
    ssh.onClose((code) => {
      const msg: TerminalMessage = {
        type: 'close',
        data: `Connection closed (${code})`,
      }
      ws.send(JSON.stringify(msg))
      ws.close(1000, 'SSH connection closed')
    })

    // Store in context for message handling
    ws.data.ssh = ssh
  }

  /**
   * Handle WebSocket message
   */
  handleWebSocketMessage(
    ws: ServerWebSocket<{ sessionId: string; ssh?: SSHConnection }>,
    message: string,
  ): void {
    const ssh = ws.data.ssh
    if (!ssh) {
      ws.close(1011, 'SSH not connected')
      return
    }

    const msg = JSON.parse(message) as TerminalMessage

    switch (msg.type) {
      case 'data':
        if (msg.data) {
          ssh.write(msg.data)
        }
        break

      case 'resize':
        if (msg.cols && msg.rows) {
          ssh.resize(msg.cols, msg.rows)
        }
        break

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break

      case 'close':
        ssh.close()
        break
    }
  }

  /**
   * Handle WebSocket close
   */
  handleWebSocketClose(
    ws: ServerWebSocket<{ sessionId: string; ssh?: SSHConnection }>,
  ): void {
    const sessionId = ws.data.sessionId
    const ssh = ws.data.ssh

    if (ssh) {
      ssh.close()
    }

    this.endSession(sessionId, 'WebSocket closed')
  }

  // ============ Internal Methods ============

  private cleanup(): void {
    const now = Date.now()

    // Tokens are now managed by distributed cache with TTL - no cleanup needed

    // Clean expired/idle sessions
    for (const [sessionId, session] of sessions) {
      if (session.status !== 'active') continue

      // Max duration exceeded
      if (now - session.startedAt > this.config.maxSessionDurationMs) {
        this.endSession(sessionId, 'Maximum session duration exceeded')
        continue
      }

      // Idle timeout
      if (now - session.lastActivityAt > this.config.idleTimeoutMs) {
        this.endSession(sessionId, 'Idle timeout')
      }
    }

    // Clean old closed sessions from tracking (keep for 24h)
    for (const [sessionId, session] of sessions) {
      if (
        session.status === 'closed' &&
        session.endedAt &&
        now - session.endedAt > 24 * 60 * 60 * 1000
      ) {
        sessions.delete(sessionId)
        const ownerKey = session.owner.toLowerCase()
        const userSessionSet = userSessions.get(ownerKey)
        userSessionSet?.delete(sessionId)
      }
    }
  }

  private rotateExpiredKeys(): void {
    const now = Date.now()

    for (const credential of memoryCredentials.values()) {
      if (now - credential.rotatedAt > this.config.keyRotationIntervalMs) {
        // Queue automatic key rotation (don't await in the cleanup loop)
        this.autoRotateKey(credential.computeId).catch((err) => {
          console.error(
            `[SSHGateway] Key rotation failed for ${credential.computeId}:`,
            err,
          )
        })
      }
    }
  }

  /**
   * Execute SSH command on remote host
   */
  private async execSSH(
    keyPath: string,
    host: string,
    port: number,
    username: string,
    command: string,
  ): Promise<number> {
    const proc = Bun.spawn([
      'ssh',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'ConnectTimeout=30',
      '-i',
      keyPath,
      '-p',
      port.toString(),
      `${username}@${host}`,
      command,
    ])
    return proc.exited
  }

  /**
   * Securely delete temp file
   */
  private async secureDelete(path: string): Promise<void> {
    await Bun.spawn(['shred', '-u', path]).exited
  }

  /**
   * Write SSH key to temp file with secure permissions
   */
  private async writeTempKey(
    computeId: string,
    key: string,
    suffix: string,
  ): Promise<string> {
    const path = `/tmp/ssh-${suffix}-${computeId}-${randomBytes(4).toString('hex')}`
    await Bun.write(path, key)
    await Bun.spawn(['chmod', '600', path]).exited
    return path
  }

  /**
   * Auto-rotate SSH key for a compute instance
   */
  private async autoRotateKey(computeId: string): Promise<void> {
    const credential = await credentialStorage.getByComputeId(computeId)
    if (!credential) {
      console.warn(
        `[SSHGateway] Cannot rotate key - credential not found for ${computeId}`,
      )
      return
    }

    const now = Date.now()
    if (now - credential.rotatedAt < this.config.keyRotationIntervalMs / 2) {
      return // Recently rotated, skip
    }

    console.log(`[SSHGateway] Starting key rotation for ${computeId}`)

    // Generate new ed25519 keypair
    const keyPath = `/tmp/ssh-keygen-${computeId}-${randomBytes(4).toString('hex')}`
    const keygen = await Bun.spawn([
      'ssh-keygen',
      '-t',
      'ed25519',
      '-f',
      keyPath,
      '-N',
      '',
      '-C',
      `jeju-${computeId}@${new Date().toISOString()}`,
    ]).exited

    if (keygen !== 0) {
      throw new Error(`ssh-keygen failed: ${keygen}`)
    }

    const newPrivateKey = await Bun.file(keyPath).text()
    const newPublicKey = await Bun.file(`${keyPath}.pub`).text()
    await this.secureDelete(keyPath)
    await Bun.spawn(['rm', '-f', `${keyPath}.pub`]).exited

    // Write keys to temp files
    const currentKeyPath = await this.writeTempKey(
      computeId,
      await this.decryptKey(credential.privateKey),
      'current',
    )
    const newKeyPath = await this.writeTempKey(computeId, newPrivateKey, 'new')
    const { host, port, username } = credential

    // Add new key to authorized_keys
    const addKeyExit = await this.execSSH(
      currentKeyPath,
      host,
      port,
      username,
      `echo '${newPublicKey.trim()}' >> ~/.ssh/authorized_keys`,
    )
    if (addKeyExit !== 0) {
      await this.secureDelete(currentKeyPath)
      await this.secureDelete(newKeyPath)
      throw new Error(`Failed to add new key: ${addKeyExit}`)
    }

    // Verify new key works
    const verifyExit = await this.execSSH(
      newKeyPath,
      host,
      port,
      username,
      'echo ok',
    )
    if (verifyExit !== 0) {
      // Rollback: remove new key
      const keyPrefix = newPublicKey.trim().split(' ').slice(0, 2).join(' ')
      await this.execSSH(
        currentKeyPath,
        host,
        port,
        username,
        `grep -v '${keyPrefix}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys`,
      )
      await this.secureDelete(currentKeyPath)
      await this.secureDelete(newKeyPath)
      throw new Error('New key verification failed')
    }

    // Update credential
    credential.privateKey = await this.encryptKey(newPrivateKey)
    credential.rotatedAt = now
    credential.fingerprint = await this.calculateFingerprint(newPublicKey)
    await credentialStorage.set(credential)

    // Remove old keys from authorized_keys (keep only new)
    const keyPrefix = newPublicKey.trim().split(' ').slice(0, 2).join(' ')
    await this.execSSH(
      newKeyPath,
      host,
      port,
      username,
      `grep '${keyPrefix}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys`,
    )

    await this.secureDelete(currentKeyPath)
    await this.secureDelete(newKeyPath)
    console.log(`[SSHGateway] Key rotation complete for ${computeId}`)
  }

  // Development fallback key constant
  private static readonly DEV_VAULT_KEY = 'dev-ssh-key-do-not-use-in-prod-32ch'
  private static vaultKeyWarned = false

  /**
   * Get vault key with dev fallback
   */
  private getVaultKey(): string {
    const key = process.env.DWS_VAULT_KEY

    if (key && key.length >= 32) {
      return key
    }

    // In production, fail hard
    const isProduction = isProductionEnv() || getCurrentNetwork() === 'mainnet'
    if (isProduction) {
      throw new Error(
        'CRITICAL: DWS_VAULT_KEY must be set for SSH key encryption in production',
      )
    }

    // In development, use fallback but warn
    if (!SSHGateway.vaultKeyWarned) {
      console.warn(
        '⚠️  WARNING: DWS_VAULT_KEY not set - SSH keys using insecure dev encryption',
      )
      SSHGateway.vaultKeyWarned = true
    }

    return SSHGateway.DEV_VAULT_KEY
  }

  /**
   * Encrypt SSH private key using AES-256-GCM
   */
  private async encryptKey(key: string): Promise<string> {
    const vaultKey = this.getVaultKey()

    // Derive encryption key
    const keyMaterial = new TextEncoder().encode(`${vaultKey}:ssh-key-vault`)
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial)
    const derivedKey = new Uint8Array(hashBuffer)

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12))

    // Import key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      derivedKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    )

    // Encrypt
    const plaintextBytes = new TextEncoder().encode(key)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      plaintextBytes,
    )

    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(ciphertext), iv.length)

    return Buffer.from(combined).toString('base64')
  }

  /**
   * Decrypt SSH private key
   */
  private async decryptKey(encrypted: string): Promise<string> {
    const vaultKey = this.getVaultKey()

    // Derive encryption key
    const keyMaterial = new TextEncoder().encode(`${vaultKey}:ssh-key-vault`)
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial)
    const derivedKey = new Uint8Array(hashBuffer)

    // Split IV and ciphertext
    const combined = Buffer.from(encrypted, 'base64')
    if (combined.length < 13) {
      throw new Error('Invalid encrypted key: too short')
    }

    const iv = combined.subarray(0, 12)
    const ciphertext = combined.subarray(12)

    // Import key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      derivedKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )

    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext,
    )

    return new TextDecoder().decode(plaintext)
  }

  /**
   * Calculate SSH key fingerprint using SHA-256
   *
   * Supported key formats:
   * - OpenSSH format (-----BEGIN OPENSSH PRIVATE KEY-----) - full support
   * - PEM format (-----BEGIN RSA PRIVATE KEY-----) - requires ssh-keygen
   *
   * @requires ssh-keygen must be installed for PEM format keys
   */
  private async calculateFingerprint(privateKey: string): Promise<string> {
    // Write private key to temp file for ssh-keygen
    const tempKeyFile = `/tmp/.ssh-key-fp-${Date.now()}-${randomBytes(8).toString('hex')}`

    try {
      await Bun.write(tempKeyFile, privateKey, { mode: 0o600 })

      // Use ssh-keygen to calculate fingerprint (works for both OpenSSH and PEM formats)
      const result = Bun.spawn(['ssh-keygen', '-l', '-f', tempKeyFile], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const output = await new Response(result.stdout).text()
      const exitCode = await result.exited

      if (exitCode === 0 && output.includes('SHA256:')) {
        // ssh-keygen output format: "256 SHA256:xxx comment (type)"
        const match = output.match(/SHA256:([A-Za-z0-9+/=_-]+)/)
        if (match) {
          return `SHA256:${match[1]}`
        }
      }
    } catch {
      // ssh-keygen not available
    } finally {
      // Securely delete temp file - try shred first, fall back to unlink
      await this.secureDeleteFile(tempKeyFile)
    }

    // Fallback for OpenSSH format only: extract embedded public key
    // Note: PEM format keys do NOT contain the public key, so this fallback won't work for them
    const publicKeyMatch = privateKey.match(/ssh-(rsa|ed25519|ecdsa)[^\n]+/)
    if (publicKeyMatch) {
      const publicKeyData = publicKeyMatch[0].split(/\s+/)[1]
      if (publicKeyData) {
        const keyBytes = Buffer.from(publicKeyData, 'base64')
        const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes)
        const hashArray = new Uint8Array(hashBuffer)
        const base64 = Buffer.from(hashArray)
          .toString('base64')
          .replace(/=+$/, '')
        return `SHA256:${base64}`
      }
    }

    // PEM format without ssh-keygen: cannot extract public key
    if (
      privateKey.includes('BEGIN RSA PRIVATE KEY') ||
      privateKey.includes('BEGIN EC PRIVATE KEY') ||
      privateKey.includes('BEGIN DSA PRIVATE KEY')
    ) {
      console.error(
        '[SSHGateway] PEM format key requires ssh-keygen for fingerprint calculation',
      )
      throw new Error('ssh-keygen required for PEM format keys')
    }

    // Unknown format
    console.warn(
      '[SSHGateway] Unknown key format, using key hash as fingerprint',
    )
    const keyBytes = new TextEncoder().encode(privateKey)
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes)
    const hashArray = new Uint8Array(hashBuffer)
    const base64 = Buffer.from(hashArray).toString('base64').replace(/=+$/, '')
    return `SHA256:${base64}`
  }

  /**
   * Securely delete a file - try shred first, fall back to unlink
   */
  private async secureDeleteFile(path: string): Promise<void> {
    const { unlink } = await import('node:fs/promises')

    try {
      // Try shred -u (secure overwrite and delete)
      const result = Bun.spawn(['shred', '-u', path], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const exitCode = await result.exited
      if (exitCode === 0) return
    } catch {
      // shred not available
    }

    // Fall back to regular unlink
    await unlink(path).catch(() => {})
  }

  private audit(
    action: string,
    sessionId: string,
    owner: Address,
    computeId: string,
    details: string,
  ): void {
    auditLog.push({
      timestamp: Date.now(),
      action,
      sessionId,
      owner,
      computeId,
      details,
    })

    // Keep bounded
    if (auditLog.length > 10000) {
      auditLog.splice(0, auditLog.length - 10000)
    }
  }

  /**
   * Get audit log
   */
  getAuditLog(filter?: {
    owner?: Address
    computeId?: string
    limit?: number
  }): typeof auditLog {
    let log = auditLog

    if (filter?.owner) {
      log = log.filter(
        (e) => e.owner.toLowerCase() === filter.owner?.toLowerCase(),
      )
    }

    if (filter?.computeId) {
      log = log.filter((e) => e.computeId === filter.computeId)
    }

    return log.slice(-(filter?.limit ?? 100))
  }

  /**
   * Get gateway statistics
   */
  async getStats(): Promise<{
    activeSessions: number
    totalSessions: number
    totalCredentials: number
  }> {
    return {
      activeSessions: Array.from(sessions.values()).filter(
        (s) => s.status === 'active',
      ).length,
      totalSessions: sessions.size,
      totalCredentials: await credentialStorage.count(),
    }
  }
}

// ============ Router ============

export function createSSHGatewayRouter(gateway: SSHGateway) {
  const router = new Elysia({ name: 'ssh-gateway', prefix: '/ssh' })

  // Generate access token
  router.post('/token', async ({ body }) => {
    const { computeId, owner, signature, message } = body as {
      computeId: string
      owner: Address
      signature: Hex
      message: string
    }

    const token = await gateway.generateAccessToken({
      computeId,
      owner,
      signature,
      message,
    })
    return { token }
  })

  // Start session
  router.post('/session', async ({ body, request }) => {
    const { token } = body as { token: string }
    const clientIp =
      request.headers.get('x-forwarded-for') ??
      request.headers.get('x-real-ip') ??
      getLocalhostHost()

    const session = await gateway.startSession({ token, clientIp })
    return { sessionId: session.id }
  })

  // Get session info
  router.get('/session/:sessionId', async ({ params }) => {
    const session = gateway.getSession(params.sessionId)
    if (!session) {
      return { error: 'Session not found' }
    }
    return session
  })

  // End session
  router.delete('/session/:sessionId', async ({ params }) => {
    gateway.endSession(params.sessionId, 'User requested')
    return { success: true }
  })

  // Get user sessions
  router.get('/sessions/:owner', async ({ params }) => {
    const sessions = gateway.getUserSessions(params.owner as Address)
    return { sessions }
  })

  // Get stats
  router.get('/stats', () => {
    return gateway.getStats()
  })

  // WebSocket endpoint handled separately via Bun.serve websocket option

  return router
}

// ============ Singleton ============

let sshGateway: SSHGateway | null = null

export function getSSHGateway(): SSHGateway {
  if (!sshGateway) {
    sshGateway = new SSHGateway()
  }
  return sshGateway
}

export function startSSHGateway(): void {
  getSSHGateway().start()
}

export function stopSSHGateway(): void {
  if (sshGateway) {
    sshGateway.stop()
  }
}
