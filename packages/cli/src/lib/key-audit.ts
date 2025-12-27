/**
 * Key Audit Logging - Track all key access operations
 *
 * SECURITY: Provides audit trail for:
 * - Key generation events
 * - Key loading/access
 * - Key usage (signing, deployment)
 * - Key deletion/burning
 *
 * Logs are stored locally and optionally can be sent to a remote
 * audit service for compliance purposes.
 */

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export type AuditEventType =
  | 'key_generated'
  | 'key_loaded'
  | 'key_used'
  | 'key_exported'
  | 'key_deleted'
  | 'key_encrypted'
  | 'key_decrypted'
  | 'ceremony_started'
  | 'ceremony_completed'
  | 'signature_created'
  | 'deployment_authorized'

export interface AuditEvent {
  timestamp: string
  eventType: AuditEventType
  keyIdentifier: string // Address or key name (never the private key!)
  network: string
  actor?: string // Who performed the action
  metadata?: Record<string, string | number | boolean>
  success: boolean
  errorMessage?: string
  machineId: string
  sessionId: string
}

/** Audit event schema for validation */
export const AuditEventSchema = z.object({
  timestamp: z.string(),
  eventType: z.enum([
    'key_generated',
    'key_loaded',
    'key_used',
    'key_exported',
    'key_deleted',
    'key_encrypted',
    'key_decrypted',
    'ceremony_started',
    'ceremony_completed',
    'signature_created',
    'deployment_authorized',
  ]),
  keyIdentifier: z.string(),
  network: z.string(),
  actor: z.string().optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
  machineId: z.string(),
  sessionId: z.string(),
})

// ============================================================================
// Audit Logger
// ============================================================================

class KeyAuditLogger {
  private logDir: string
  private sessionId: string
  private machineId: string
  private initialized = false

  constructor() {
    this.logDir = ''
    this.sessionId = this.generateSessionId()
    this.machineId = this.generateMachineId()
  }

  /**
   * Initialize the audit logger with a root directory
   */
  initialize(rootDir: string): void {
    this.logDir = join(rootDir, '.jeju', 'audit')
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
    this.initialized = true
  }

  /**
   * Log an audit event
   */
  log(event: Omit<AuditEvent, 'timestamp' | 'machineId' | 'sessionId'>): void {
    if (!this.initialized) {
      // If not initialized, just skip (don't crash)
      console.debug('[AUDIT] Logger not initialized, skipping audit event')
      return
    }

    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      machineId: this.machineId,
      sessionId: this.sessionId,
    }

    // Validate event structure
    const result = AuditEventSchema.safeParse(fullEvent)
    if (!result.success) {
      console.error('[AUDIT] Invalid event structure:', result.error.message)
      return
    }

    // Write to daily log file
    const logFile = this.getLogFile()
    const logLine = `${JSON.stringify(fullEvent)}\n`

    try {
      appendFileSync(logFile, logLine)
    } catch (error) {
      console.error('[AUDIT] Failed to write audit log:', error)
    }

    // Console output for visibility
    this.consoleLog(fullEvent)
  }

  /**
   * Log key generation event
   */
  logKeyGenerated(
    address: string,
    network: string,
    role?: string,
    teeUsed?: boolean,
  ): void {
    this.log({
      eventType: 'key_generated',
      keyIdentifier: address,
      network,
      success: true,
      metadata: {
        role: role ?? 'unknown',
        teeUsed: teeUsed ?? false,
      },
    })
  }

  /**
   * Log key loaded event
   */
  logKeyLoaded(
    address: string,
    network: string,
    source: 'file' | 'env' | 'hardware' | 'default',
  ): void {
    this.log({
      eventType: 'key_loaded',
      keyIdentifier: address,
      network,
      success: true,
      metadata: { source },
    })
  }

  /**
   * Log key usage event
   */
  logKeyUsed(
    address: string,
    network: string,
    purpose: string,
    txHash?: string,
  ): void {
    this.log({
      eventType: 'key_used',
      keyIdentifier: address,
      network,
      success: true,
      metadata: {
        purpose,
        ...(txHash ? { txHash } : {}),
      },
    })
  }

  /**
   * Log key deletion event
   */
  logKeyDeleted(address: string, network: string, secureWipe: boolean): void {
    this.log({
      eventType: 'key_deleted',
      keyIdentifier: address,
      network,
      success: true,
      metadata: { secureWipe },
    })
  }

  /**
   * Log ceremony event
   */
  logCeremony(
    type: 'started' | 'completed',
    network: string,
    addresses: string[],
    teeProvider?: string,
  ): void {
    this.log({
      eventType: type === 'started' ? 'ceremony_started' : 'ceremony_completed',
      keyIdentifier: addresses.join(','),
      network,
      success: true,
      metadata: {
        keyCount: addresses.length,
        ...(teeProvider ? { teeProvider } : {}),
      },
    })
  }

  /**
   * Log signature creation
   */
  logSignatureCreated(
    signerAddress: string,
    network: string,
    purpose: string,
    targetHash: string,
  ): void {
    this.log({
      eventType: 'signature_created',
      keyIdentifier: signerAddress,
      network,
      success: true,
      metadata: {
        purpose,
        targetHash: `${targetHash.slice(0, 16)}...`,
      },
    })
  }

  /**
   * Log deployment authorization
   */
  logDeploymentAuthorized(
    signerAddress: string,
    network: string,
    manifestFingerprint: string,
  ): void {
    this.log({
      eventType: 'deployment_authorized',
      keyIdentifier: signerAddress,
      network,
      success: true,
      metadata: {
        manifestFingerprint,
      },
    })
  }

  /**
   * Log an error event
   */
  logError(
    eventType: AuditEventType,
    keyIdentifier: string,
    network: string,
    error: Error | string,
  ): void {
    this.log({
      eventType,
      keyIdentifier,
      network,
      success: false,
      errorMessage: error instanceof Error ? error.message : error,
    })
  }

  /**
   * Get recent audit events
   */
  getRecentEvents(days = 7): AuditEvent[] {
    if (!this.initialized) {
      return []
    }

    const events: AuditEvent[] = []
    const now = new Date()

    for (let i = 0; i < days; i++) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const logFile = this.getLogFileForDate(date)

      if (existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf-8')
        const lines = content.trim().split('\n').filter(Boolean)

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as AuditEvent
            events.push(event)
          } catch {
            // Skip malformed lines
          }
        }
      }
    }

    // Sort by timestamp descending
    return events.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
  }

  /**
   * Get audit events for a specific key
   */
  getEventsForKey(address: string, days = 30): AuditEvent[] {
    return this.getRecentEvents(days).filter(
      (e) =>
        e.keyIdentifier === address ||
        e.keyIdentifier.split(',').includes(address),
    )
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private getLogFile(): string {
    return this.getLogFileForDate(new Date())
  }

  private getLogFileForDate(date: Date): string {
    const dateStr = date.toISOString().split('T')[0]
    return join(this.logDir, `key-audit-${dateStr}.log`)
  }

  private generateSessionId(): string {
    // SECURITY: Use crypto.randomUUID for unpredictable session IDs
    return `session-${Date.now()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
  }

  private generateMachineId(): string {
    // Create a stable machine ID based on hostname and platform
    const os = require('node:os')
    const data = `${os.hostname()}-${os.platform()}-${os.arch()}`
    return createHash('sha256').update(data).digest('hex').slice(0, 16)
  }

  private consoleLog(event: AuditEvent): void {
    const symbol = event.success ? '✓' : '✗'
    const color = event.success ? '\x1b[32m' : '\x1b[31m'
    const reset = '\x1b[0m'

    console.debug(
      `${color}[AUDIT ${symbol}]${reset} ${event.eventType} | ${event.keyIdentifier.slice(0, 10)}... | ${event.network}`,
    )
  }
}

// ============================================================================
// Exports
// ============================================================================

/** Global audit logger instance */
export const keyAudit = new KeyAuditLogger()

/**
 * Initialize the key audit logger
 * Should be called early in CLI initialization
 */
export function initializeKeyAudit(rootDir: string): void {
  keyAudit.initialize(rootDir)
}

/**
 * Decorator-style wrapper for auditing key operations
 */
export function withKeyAudit<
  T extends (...args: unknown[]) => Promise<unknown>,
>(
  fn: T,
  eventType: AuditEventType,
  getKeyIdentifier: (args: Parameters<T>) => string,
  getNetwork: (args: Parameters<T>) => string,
): T {
  return (async (...args: Parameters<T>) => {
    const keyId = getKeyIdentifier(args)
    const network = getNetwork(args)

    try {
      const result = await fn(...args)
      keyAudit.log({
        eventType,
        keyIdentifier: keyId,
        network,
        success: true,
      })
      return result
    } catch (error) {
      keyAudit.logError(
        eventType,
        keyId,
        network,
        error instanceof Error ? error : String(error),
      )
      throw error
    }
  }) as T
}
