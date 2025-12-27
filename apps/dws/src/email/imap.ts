/**
 * IMAP Server Integration
 *
 * Provides IMAP4rev1 compliance via Dovecot passthrough:
 * - OAuth3 authentication via Dovecot OAuth2 plugin
 * - Encrypted storage backend via DWS
 * - Full compatibility with Thunderbird, Apple Mail, etc.
 *
 * Architecture:
 * - Dovecot handles IMAP protocol parsing
 * - This service handles authentication and storage backend
 * - All data stored encrypted in IPFS/Arweave
 *
 * Workerd-compatible: All file operations via DWS exec API.
 */

import type { Address } from 'viem'
import { activeSessions, authAttemptsTotal } from './metrics'
import { getMailboxStorage } from './storage'
import type { IMAPMessageData, IMAPSession } from './types'

// DWS Exec API for spawning processes and file operations
interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  pid?: number
}

let execUrl = 'http://localhost:4020/exec'

export function configureIMAPServer(config: { execUrl?: string }): void {
  if (config.execUrl) execUrl = config.execUrl
}

async function exec(
  command: string[],
  options?: {
    env?: Record<string, string>
    stdin?: string
    background?: boolean
  },
): Promise<ExecResult> {
  const response = await fetch(execUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, ...options }),
  })
  if (!response.ok) {
    throw new Error(`Exec API error: ${response.status}`)
  }
  return response.json() as Promise<ExecResult>
}

// File operation helpers via exec API
async function writeFile(path: string, content: string): Promise<void> {
  await exec(['sh', '-c', `cat > "${path}"`], { stdin: content })
}

async function mkdir(path: string): Promise<void> {
  await exec(['mkdir', '-p', path])
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

// ============ Configuration ============

interface IMAPServerConfig {
  host: string
  port: number
  tlsCert: string
  tlsKey: string
  oauth3Endpoint: string
  dwsEndpoint: string
  dovecotPath?: string
  configDir?: string
}

// ============ IMAP Server ============

export class IMAPServer {
  private config: IMAPServerConfig
  private sessions: Map<string, IMAPSession> = new Map()
  private dovecotProcessId: string | null = null

  constructor(config: IMAPServerConfig) {
    this.config = config
  }

  /**
   * Start IMAP server using Dovecot
   * Generates configuration and spawns Dovecot process
   */
  async start(): Promise<void> {
    console.log(
      `[IMAP] Starting IMAP server on ${this.config.host}:${this.config.port}`,
    )

    // Generate Dovecot configuration
    const configDir = this.config.configDir ?? '/tmp/jeju-dovecot'
    await this.generateDovecotConfig(configDir)

    // Start Dovecot process via DWS exec API (workerd-compatible)
    const dovecotPath = this.config.dovecotPath ?? 'dovecot'

    try {
      const result = await exec(
        [dovecotPath, '-c', joinPath(configDir, 'dovecot.conf'), '-F'],
        { background: true },
      )

      if (result.exitCode === 0 && result.pid) {
        this.dovecotProcessId = String(result.pid)
        console.log(
          `[IMAP] Dovecot IMAP server started (PID: ${this.dovecotProcessId})`,
        )
      } else {
        console.warn('[IMAP] Failed to start Dovecot:', result.stderr)
        console.log('[IMAP] Falling back to built-in IMAP handler')
        this.dovecotProcessId = null
      }
    } catch (error) {
      console.error(
        '[IMAP] Failed to start Dovecot:',
        error instanceof Error ? error.message : String(error),
      )
      console.log('[IMAP] Falling back to built-in IMAP handler')
      this.dovecotProcessId = null
    }

    // Wait for Dovecot to start
    await new Promise((resolve) => setTimeout(resolve, 1000))

    if (this.dovecotProcessId) {
      console.log('[IMAP] Dovecot IMAP server started')
    } else {
      console.log('[IMAP] Using built-in IMAP handler (development mode)')
    }
  }

  /**
   * Stop IMAP server
   */
  async stop(): Promise<void> {
    console.log('[IMAP] Stopping IMAP server')

    if (this.dovecotProcessId) {
      // Kill process via DWS exec API
      try {
        await exec(['kill', '-TERM', this.dovecotProcessId])
      } catch (error) {
        console.warn(
          '[IMAP] Failed to stop Dovecot:',
          error instanceof Error ? error.message : String(error),
        )
      }

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          // Force kill if still running
          if (this.dovecotProcessId) {
            exec(['kill', '-KILL', this.dovecotProcessId]).catch(() => {
              // Ignore errors
            })
          }
          resolve()
        }, 5000)
      })

      this.dovecotProcessId = null
    }

    // Clear all sessions
    this.sessions.clear()
    console.log('[IMAP] IMAP server stopped')
  }

  /**
   * Generate Dovecot configuration files
   * Uses DWS exec API for all file operations
   */
  private async generateDovecotConfig(configDir: string): Promise<void> {
    await mkdir(configDir)

    // Main dovecot.conf
    const mainConfig = `
# Jeju Mail - Dovecot Configuration
# Auto-generated by jeju-email service

protocols = imap

# SSL/TLS
ssl = required
ssl_cert = <${this.config.tlsCert}
ssl_key = <${this.config.tlsKey}

# Listening
listen = ${this.config.host}
service imap-login {
  inet_listener imaps {
    port = ${this.config.port}
    ssl = yes
  }
}

# Authentication
auth_mechanisms = xoauth2 oauthbearer plain

passdb {
  driver = oauth2
  args = ${joinPath(configDir, 'dovecot-oauth2.conf.ext')}
}

userdb {
  driver = static
  args = uid=1000 gid=1000 home=/var/mail/%u
}

# Mail storage - proxy to DWS
mail_location = proxy:${this.config.dwsEndpoint}/email/mailbox/%u

# Logging
log_path = /dev/stderr
info_log_path = /dev/stderr
debug_log_path = /dev/stderr

# Plugins
mail_plugins = $mail_plugins quota

plugin {
  quota = maildir:User quota
  quota_rule = *:storage=1G
  quota_rule2 = Trash:storage=+100M
}

# Include extra configs
!include ${joinPath(configDir, 'conf.d')}/*.conf
`

    await writeFile(joinPath(configDir, 'dovecot.conf'), mainConfig)

    // OAuth2 configuration
    const oauth2Config = `
# Jeju Mail OAuth2 Configuration

tokeninfo_url = ${this.config.oauth3Endpoint}/validate
introspection_url = ${this.config.oauth3Endpoint}/introspect
introspection_mode = post

username_attribute = email
tls_ca_cert_file = /etc/ssl/certs/ca-certificates.crt

# Token validation
active_attribute = valid
active_value = true
`

    await writeFile(
      joinPath(configDir, 'dovecot-oauth2.conf.ext'),
      oauth2Config,
    )

    // Create conf.d directory
    const confdDir = joinPath(configDir, 'conf.d')
    await mkdir(confdDir)

    // IMAP specific config
    const imapConfig = `
# IMAP protocol configuration
protocol imap {
  mail_max_userip_connections = 50
  imap_client_workarounds = delay-newmail tb-extra-mailbox-sep
}
`

    await writeFile(joinPath(confdDir, '20-imap.conf'), imapConfig)

    console.log(`[IMAP] Dovecot configuration generated in ${configDir}`)
  }

  /**
   * Check if IMAP server is running
   */
  isRunning(): boolean {
    return this.dovecotProcessId !== null
  }

  /**
   * Create new IMAP session
   */
  async createSession(_clientIp: string): Promise<string> {
    const sessionId = `imap-${Date.now()}-${Math.random().toString(36).slice(2)}`

    this.sessions.set(sessionId, {
      id: sessionId,
      user: '0x0000000000000000000000000000000000000000' as Address,
      email: '',
      authenticated: false,
      selectedMailbox: undefined,
      capabilities: ['IMAP4rev1', 'AUTH=XOAUTH2', 'SASL-IR', 'IDLE'],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    })

    activeSessions.inc({ protocol: 'imap' })
    return sessionId
  }

  async destroySession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId)
      activeSessions.dec({ protocol: 'imap' })
    }
  }

  /**
   * Get session
   */
  getSession(sessionId: string): IMAPSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Authenticate IMAP session via OAuth3
   */
  async authenticateOAuth3(
    sessionId: string,
    token: string,
  ): Promise<{ success: boolean; user?: Address; email?: string }> {
    const response = await fetch(`${this.config.oauth3Endpoint}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })

    if (!response.ok) {
      authAttemptsTotal.inc({
        protocol: 'imap',
        mechanism: 'oauth3',
        status: 'failure',
      })
      return { success: false }
    }

    const data = (await response.json()) as {
      valid: boolean
      address?: Address
      email?: string
    }

    if (!data.valid || !data.address) {
      authAttemptsTotal.inc({
        protocol: 'imap',
        mechanism: 'oauth3',
        status: 'failure',
      })
      return { success: false }
    }

    // Create session
    this.sessions.set(sessionId, {
      id: sessionId,
      user: data.address,
      email: data.email ?? '',
      authenticated: true,
      capabilities: [
        'IMAP4rev1',
        'IDLE',
        'NAMESPACE',
        'QUOTA',
        'UIDPLUS',
        'MOVE',
        'CONDSTORE',
        'QRESYNC',
        'ENABLE',
        'LIST-EXTENDED',
        'LIST-STATUS',
        'LITERAL+',
        'SASL-IR',
        'SPECIAL-USE',
        'AUTH=OAUTHBEARER',
        'AUTH=XOAUTH2',
      ],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    })

    authAttemptsTotal.inc({
      protocol: 'imap',
      mechanism: 'oauth3',
      status: 'success',
    })
    return { success: true, user: data.address, email: data.email }
  }

  /**
   * Handle IMAP LIST command (list mailboxes)
   */
  async listMailboxes(sessionId: string): Promise<string[]> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.authenticated) {
      throw new Error('Not authenticated')
    }

    const storage = getMailboxStorage()
    const mailbox = await storage.getMailbox(session.user)

    if (!mailbox) {
      return ['INBOX']
    }

    return [
      'INBOX',
      'Sent',
      'Drafts',
      'Trash',
      'Spam',
      'Archive',
      ...mailbox.folders.filter(
        (f) =>
          !['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive'].includes(
            f.toLowerCase(),
          ),
      ),
    ]
  }

  /**
   * Handle IMAP SELECT command (select mailbox)
   */
  async selectMailbox(
    sessionId: string,
    mailbox: string,
  ): Promise<{
    exists: number
    recent: number
    unseen: number
    uidValidity: number
    uidNext: number
  }> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.authenticated) {
      throw new Error('Not authenticated')
    }

    session.selectedMailbox = mailbox
    session.lastActivityAt = Date.now()

    const storage = getMailboxStorage()
    const index = await storage.getIndex(session.user)

    if (!index) {
      return { exists: 0, recent: 0, unseen: 0, uidValidity: 1, uidNext: 1 }
    }

    // Map IMAP folder names to our folder names
    const folderMap: Record<string, string> = {
      INBOX: 'inbox',
      Sent: 'sent',
      Drafts: 'drafts',
      Trash: 'trash',
      Spam: 'spam',
      Archive: 'archive',
    }

    const folderKey = folderMap[mailbox] ?? mailbox.toLowerCase()
    let emails: typeof index.inbox

    if (folderKey in index) {
      emails = index[folderKey as keyof typeof index] as typeof index.inbox
    } else if (index.folders[folderKey]) {
      emails = index.folders[folderKey]
    } else {
      emails = []
    }

    const unseen = emails.filter((e) => !e.flags.read).length

    return {
      exists: emails.length,
      recent: 0, // We don't track this separately
      unseen,
      uidValidity: 1, // Would be stored with mailbox
      uidNext: emails.length + 1,
    }
  }

  /**
   * Handle IMAP FETCH command
   * @param sequence - IMAP sequence set (e.g., "1:*", "1,2,3") - used for Dovecot integration
   * @param items - IMAP fetch items (e.g., ["BODY", "FLAGS"]) - used for Dovecot integration
   */
  async fetchMessages(
    sessionId: string,
    _sequence: string, // Will be used when integrating with Dovecot IMAP proxy
    _items: string[], // Will be used when integrating with Dovecot IMAP proxy
  ): Promise<IMAPMessageData[]> {
    const session = this.sessions.get(sessionId)
    if (!session || !session.authenticated || !session.selectedMailbox) {
      throw new Error('No mailbox selected')
    }

    const storage = getMailboxStorage()
    const index = await storage.getIndex(session.user)

    if (!index) {
      return []
    }

    // Parse sequence (e.g., "1:*", "1,3,5", "1:10")
    // Simplified - just return all for now
    const folderMap: Record<string, string> = {
      INBOX: 'inbox',
      Sent: 'sent',
      Drafts: 'drafts',
      Trash: 'trash',
      Spam: 'spam',
      Archive: 'archive',
    }

    const folderKey =
      folderMap[session.selectedMailbox] ??
      session.selectedMailbox.toLowerCase()
    let emails: typeof index.inbox

    if (folderKey in index) {
      emails = index[folderKey as keyof typeof index] as typeof index.inbox
    } else if (index.folders[folderKey]) {
      emails = index.folders[folderKey]
    } else {
      emails = []
    }

    // Build response based on requested items
    return emails.map(
      (email, i): IMAPMessageData => ({
        uid: i + 1,
        flags: [
          email.flags.read ? '\\Seen' : '',
          email.flags.starred ? '\\Flagged' : '',
          email.flags.deleted ? '\\Deleted' : '',
          email.flags.answered ? '\\Answered' : '',
        ].filter(Boolean),
        internalDate: email.timestamp,
        size: email.size,
        envelope: {
          date: new Date(email.timestamp).toISOString(),
          subject: email.subject,
          from: email.from,
          to: email.to.join(', '),
          messageId: email.messageId,
        },
      }),
    )
  }
}

// ============ Factory ============

export function createIMAPServer(config: IMAPServerConfig): IMAPServer {
  return new IMAPServer(config)
}

// ============ Dovecot Configuration Generator ============

export function generateDovecotConfig(config: {
  imapPort: number
  oauth3Endpoint: string
  storageBackend: string
}): string {
  return `
# Dovecot configuration for Jeju Mail
# Generated by jeju-email service

protocols = imap

# SSL/TLS
ssl = required
ssl_cert = </etc/ssl/certs/jeju-mail.pem
ssl_key = </etc/ssl/private/jeju-mail.key
ssl_min_protocol = TLSv1.2

# Authentication
auth_mechanisms = oauthbearer xoauth2

passdb {
  driver = oauth2
  args = /etc/dovecot/dovecot-oauth2.conf.ext
}

userdb {
  driver = static
  args = uid=vmail gid=vmail home=/var/mail/%u
}

# IMAP settings
protocol imap {
  imap_capability = +XOAUTH2
  mail_plugins = quota
}

# Mail location (will be proxied to DWS)
mail_location = proxy:${config.storageBackend}

# Logging
log_path = /var/log/dovecot.log
info_log_path = /var/log/dovecot-info.log
`
}

export function generateDovecotOAuth2Config(config: {
  oauth3Endpoint: string
  clientId: string
}): string {
  return `
# OAuth2 configuration for Dovecot
# Validates tokens against Jeju OAuth3

tokeninfo_url = ${config.oauth3Endpoint}/oauth2/tokeninfo
introspection_url = ${config.oauth3Endpoint}/oauth2/introspect
introspection_mode = post

client_id = ${config.clientId}

username_attribute = email
active_attribute = active
active_value = true
`
}
