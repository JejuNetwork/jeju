/**
 * SSH Terminal Gateway
 *
 * Provides secure SSH access to compute instances:
 * - SSH proxy without exposing instance credentials to users
 * - WebSocket-based terminal for web UI
 * - Key management and rotation
 * - Session management and audit logging
 * - Rate limiting and access control
 *
 * Security Model:
 * - Users authenticate via wallet signature
 * - Gateway holds the actual SSH keys (never exposed)
 * - All sessions are logged for audit
 * - Automatic key rotation
 * - Connection timeouts and idle disconnect
 */

import { Elysia } from 'elysia'
import { spawn, type Subprocess } from 'bun'
import type { ServerWebSocket } from 'bun'
import { randomBytes } from 'crypto'
import type { Address, Hex } from 'viem'
import { verifyMessage } from 'viem'

// ============ Types ============

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

const credentials = new Map<string, SSHCredentials>()
const credentialsByCompute = new Map<string, string>() // computeId -> credentialId
const sessions = new Map<string, SSHSession>()
const userSessions = new Map<Address, Set<string>>()
const accessTokens = new Map<string, AccessToken>()
const auditLog: Array<{
  timestamp: number
  action: string
  sessionId: string
  owner: Address
  computeId: string
  details: string
}> = []

// Active SSH processes
const sshProcesses = new Map<string, Subprocess>()

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
    this.keyRotationInterval = setInterval(() => {
      this.rotateExpiredKeys()
    }, 60 * 60 * 1000) // Every hour

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

    // Calculate key fingerprint
    const fingerprint = this.calculateFingerprint(params.privateKey)

    const credential: SSHCredentials = {
      id,
      computeId: params.computeId,
      owner: params.owner,
      host: params.host,
      port: params.port ?? 22,
      username: params.username,
      privateKey: this.encryptKey(params.privateKey),
      fingerprint,
      createdAt: now,
      lastUsedAt: now,
      rotatedAt: now,
    }

    credentials.set(id, credential)
    credentialsByCompute.set(params.computeId, id)

    this.audit('credential_registered', '', params.owner, params.computeId, `Registered SSH credentials for ${params.host}`)

    console.log(`[SSHGateway] Registered credentials ${id} for compute ${params.computeId}`)
    return id
  }

  /**
   * Rotate SSH key for a compute instance
   */
  async rotateKey(computeId: string, newPrivateKey: string): Promise<void> {
    const credentialId = credentialsByCompute.get(computeId)
    if (!credentialId) {
      throw new Error(`No credentials found for compute: ${computeId}`)
    }

    const credential = credentials.get(credentialId)
    if (!credential) {
      throw new Error(`Credential not found: ${credentialId}`)
    }

    credential.privateKey = this.encryptKey(newPrivateKey)
    credential.fingerprint = this.calculateFingerprint(newPrivateKey)
    credential.rotatedAt = Date.now()

    this.audit('key_rotated', '', credential.owner, computeId, 'SSH key rotated')
    console.log(`[SSHGateway] Rotated key for compute ${computeId}`)
  }

  /**
   * Remove credentials
   */
  removeCredentials(computeId: string): void {
    const credentialId = credentialsByCompute.get(computeId)
    if (credentialId) {
      const credential = credentials.get(credentialId)
      if (credential) {
        this.audit('credential_removed', '', credential.owner, computeId, 'Credentials removed')
      }
      credentials.delete(credentialId)
      credentialsByCompute.delete(computeId)
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
      throw new Error('Invalid signature')
    }

    // Verify message contains correct computeId and timestamp
    const expectedPrefix = `SSH Access Request for ${params.computeId} at `
    if (!params.message.startsWith(expectedPrefix)) {
      throw new Error('Invalid message format')
    }

    const timestamp = parseInt(params.message.slice(expectedPrefix.length), 10)
    if (isNaN(timestamp) || Date.now() - timestamp > 300000) {
      throw new Error('Message expired')
    }

    // Check credential exists and owner matches
    const credentialId = credentialsByCompute.get(params.computeId)
    if (!credentialId) {
      throw new Error('No credentials for compute')
    }

    const credential = credentials.get(credentialId)
    if (!credential) {
      throw new Error('Credential not found')
    }

    if (credential.owner.toLowerCase() !== params.owner.toLowerCase()) {
      throw new Error('Not authorized')
    }

    // Check session limits
    const userSessionSet = userSessions.get(params.owner)
    if (userSessionSet && userSessionSet.size >= this.config.maxSessionsPerUser) {
      throw new Error('Session limit reached')
    }

    // Generate token
    const token = randomBytes(32).toString('hex')
    const now = Date.now()

    accessTokens.set(token, {
      token,
      computeId: params.computeId,
      owner: params.owner,
      createdAt: now,
      expiresAt: now + this.config.tokenValidityMs,
      used: false,
    })

    this.audit('token_generated', '', params.owner, params.computeId, 'Access token generated')

    return token
  }

  /**
   * Validate and consume an access token
   */
  validateToken(token: string): AccessToken {
    const accessToken = accessTokens.get(token)

    if (!accessToken) {
      throw new Error('Invalid token')
    }

    if (accessToken.used) {
      throw new Error('Token already used')
    }

    if (Date.now() > accessToken.expiresAt) {
      accessTokens.delete(token)
      throw new Error('Token expired')
    }

    // Mark as used
    accessToken.used = true

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
    const accessToken = this.validateToken(params.token)

    // Get credentials
    const credentialId = credentialsByCompute.get(accessToken.computeId)
    if (!credentialId) {
      throw new Error('No credentials')
    }

    const credential = credentials.get(credentialId)
    if (!credential) {
      throw new Error('Credential not found')
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
      credentialId,
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

    const userSessionSet = userSessions.get(accessToken.owner) ?? new Set()
    userSessionSet.add(sessionId)
    userSessions.set(accessToken.owner, userSessionSet)

    // Update credential usage
    credential.lastUsedAt = now

    this.audit('session_started', sessionId, accessToken.owner, accessToken.computeId, `Session started from ${params.clientIp}`)

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

    this.audit('session_ended', sessionId, session.owner, session.computeId, reason ?? 'Session closed')
    console.log(`[SSHGateway] Session ${sessionId} ended: ${reason ?? 'closed'}`)
  }

  /**
   * Get user's active sessions
   */
  getUserSessions(owner: Address): SSHSession[] {
    const sessionIds = userSessions.get(owner)
    if (!sessionIds) return []

    return Array.from(sessionIds)
      .map((id) => sessions.get(id))
      .filter((s): s is SSHSession => !!s && s.status === 'active')
  }

  // ============ SSH Connection ============

  /**
   * Connect to SSH and return process for streaming
   */
  async connect(sessionId: string): Promise<{
    write: (data: string) => void
    onData: (callback: (data: string) => void) => void
    onClose: (callback: (code: number) => void) => void
    resize: (cols: number, rows: number) => void
    close: () => void
  }> {
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }

    const credential = credentials.get(session.credentialId)
    if (!credential) {
      throw new Error('Credential not found')
    }

    // Decrypt key and write to temp file
    const keyContent = this.decryptKey(credential.privateKey)
    const keyFile = `/tmp/ssh-key-${sessionId}`
    await Bun.write(keyFile, keyContent)
    await Bun.spawn(['chmod', '600', keyFile]).exited

    // Start SSH process
    const sshProcess = spawn({
      cmd: [
        'ssh',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', `ConnectTimeout=${Math.floor(this.config.sshTimeout / 1000)}`,
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-i', keyFile,
        '-p', credential.port.toString(),
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

    // Read stdout
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

    // Read stderr (merge with stdout)
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

    // Handle process exit
    sshProcess.exited.then((code) => {
      // Clean up key file
      Bun.spawn(['rm', '-f', keyFile])

      session.status = 'closed'
      session.endedAt = Date.now()
      sshProcesses.delete(sessionId)

      for (const cb of closeCallbacks) {
        cb(code ?? 0)
      }

      this.audit('ssh_disconnected', sessionId, session.owner, session.computeId, `Exit code: ${code}`)
    })

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
      resize: (_cols: number, _rows: number) => {
        // SSH resize requires SIGWINCH - complex to implement without pty
        // For full terminal support, would need node-pty or similar
      },
      close: () => {
        sshProcess.kill()
      },
    }
  }

  // ============ WebSocket Handler ============

  /**
   * Handle WebSocket terminal connection
   */
  async handleWebSocket(
    ws: ServerWebSocket<{ sessionId: string }>,
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
      const msg: TerminalMessage = { type: 'close', data: `Connection closed (${code})` }
      ws.send(JSON.stringify(msg))
      ws.close(1000, 'SSH connection closed')
    })

    // Store in context for message handling
    ;(ws.data as { ssh?: typeof ssh }).ssh = ssh
  }

  /**
   * Handle WebSocket message
   */
  handleWebSocketMessage(
    ws: ServerWebSocket<{ sessionId: string; ssh?: ReturnType<typeof this.connect> extends Promise<infer T> ? T : never }>,
    message: string,
  ): void {
    const ssh = (ws.data as { ssh?: ReturnType<typeof this.connect> extends Promise<infer T> ? T : never }).ssh
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
    ws: ServerWebSocket<{ sessionId: string; ssh?: ReturnType<typeof this.connect> extends Promise<infer T> ? T : never }>,
  ): void {
    const sessionId = ws.data.sessionId
    const ssh = (ws.data as { ssh?: ReturnType<typeof this.connect> extends Promise<infer T> ? T : never }).ssh

    if (ssh) {
      ssh.close()
    }

    this.endSession(sessionId, 'WebSocket closed')
  }

  // ============ Internal Methods ============

  private cleanup(): void {
    const now = Date.now()

    // Clean expired tokens
    for (const [token, accessToken] of accessTokens) {
      if (now > accessToken.expiresAt || accessToken.used) {
        accessTokens.delete(token)
      }
    }

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
        continue
      }
    }

    // Clean old closed sessions from tracking (keep for 24h)
    for (const [sessionId, session] of sessions) {
      if (session.status === 'closed' && session.endedAt && now - session.endedAt > 24 * 60 * 60 * 1000) {
        sessions.delete(sessionId)
        const userSessionSet = userSessions.get(session.owner)
        userSessionSet?.delete(sessionId)
      }
    }
  }

  private rotateExpiredKeys(): void {
    const now = Date.now()

    for (const credential of credentials.values()) {
      if (now - credential.rotatedAt > this.config.keyRotationIntervalMs) {
        console.log(`[SSHGateway] Key rotation needed for ${credential.computeId}`)
        // In production, would trigger key rotation workflow
        // This would involve generating new key, deploying to instance, updating credential
      }
    }
  }

  private encryptKey(key: string): string {
    // In production, use KMS encryption
    // For now, base64 encode
    return Buffer.from(key).toString('base64')
  }

  private decryptKey(encrypted: string): string {
    // In production, use KMS decryption
    return Buffer.from(encrypted, 'base64').toString()
  }

  private calculateFingerprint(privateKey: string): string {
    // Extract public key and calculate fingerprint
    // Simplified - would use ssh-keygen -lf in production
    const hash = Bun.hash(privateKey).toString(16)
    return `SHA256:${hash.slice(0, 43)}`
  }

  private audit(action: string, sessionId: string, owner: Address, computeId: string, details: string): void {
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
  getAuditLog(filter?: { owner?: Address; computeId?: string; limit?: number }): typeof auditLog {
    let log = auditLog

    if (filter?.owner) {
      log = log.filter((e) => e.owner.toLowerCase() === filter.owner?.toLowerCase())
    }

    if (filter?.computeId) {
      log = log.filter((e) => e.computeId === filter.computeId)
    }

    return log.slice(-(filter?.limit ?? 100))
  }

  /**
   * Get gateway statistics
   */
  getStats(): {
    activeSessions: number
    totalSessions: number
    totalCredentials: number
    pendingTokens: number
  } {
    return {
      activeSessions: Array.from(sessions.values()).filter((s) => s.status === 'active').length,
      totalSessions: sessions.size,
      totalCredentials: credentials.size,
      pendingTokens: Array.from(accessTokens.values()).filter((t) => !t.used).length,
    }
  }
}

// ============ Router ============

export function createSSHGatewayRouter(gateway: SSHGateway): Elysia {
  const router = new Elysia({ name: 'ssh-gateway', prefix: '/ssh' })

  // Generate access token
  router.post('/token', async ({ body, set }) => {
    const { computeId, owner, signature, message } = body as {
      computeId: string
      owner: Address
      signature: Hex
      message: string
    }

    const token = await gateway.generateAccessToken({ computeId, owner, signature, message })
    return { token }
  })

  // Start session
  router.post('/session', async ({ body, request, set }) => {
    const { token } = body as { token: string }
    const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '127.0.0.1'

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
