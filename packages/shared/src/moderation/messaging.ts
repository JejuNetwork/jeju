/**
 * Messaging Content Moderation Service
 *
 * Screens XMTP/Farcaster messages for CSAM.
 * Caller must provide plaintext - service does NOT decrypt.
 *
 * LIMITATIONS:
 * - Audit log is stored IN MEMORY only (lost on restart)
 * - Max 10,000 entries before truncation
 * - For production, implement external audit storage via getAuditLog() export
 */

import type { Address, Hex } from 'viem'
import { ContentModerationPipeline, type PipelineConfig } from './pipeline'
import type { ModerationAction, ModerationResult, ModerationSeverity } from './types'

export interface MessageEnvelope {
  id: string
  sender: Address
  recipient: Address
  timestamp: number
  plainContent?: string
  contentHash: Hex
  protocol: 'xmtp' | 'farcaster' | 'matrix' | 'other'
}

export interface MessageScreeningResult {
  messageId: string
  contentHash: Hex
  result: ModerationResult
  shouldDeliver: boolean
  warning?: string
}

export interface AuditEntry {
  timestamp: number
  messageId: string
  contentHash: Hex
  sender: Address
  action: ModerationAction
  severity: ModerationSeverity
  category?: string
}

export interface MessagingConfig extends PipelineConfig {
  /** Callback for external audit persistence. Called on every moderation action. */
  onAudit?: (entry: AuditEntry) => void | Promise<void>
  /** Max in-memory audit entries before truncation (default: 10000) */
  maxAuditSize?: number
}

export class MessagingModerationService {
  private pipeline: ContentModerationPipeline
  private audit: AuditEntry[] = []
  private stats = { blocked: 0, warned: 0, allowed: 0 }
  private maxAuditSize: number
  private onAudit?: (entry: AuditEntry) => void | Promise<void>

  constructor(config: MessagingConfig) {
    this.pipeline = new ContentModerationPipeline(config)
    this.onAudit = config.onAudit
    this.maxAuditSize = config.maxAuditSize ?? 10000
  }

  async initialize(): Promise<void> {
    await this.pipeline.initialize()
  }

  async screenMessage(msg: MessageEnvelope): Promise<MessageScreeningResult> {
    if (!msg.plainContent) {
      return { messageId: msg.id, contentHash: msg.contentHash, result: this.emptyResult(), shouldDeliver: true }
    }

    const result = await this.pipeline.moderate({
      content: msg.plainContent,
      contentType: 'text',
      senderAddress: msg.sender,
    })

    this.logAudit(msg, result)
    const shouldDeliver = result.action === 'allow' || result.action === 'warn'

    return {
      messageId: msg.id,
      contentHash: msg.contentHash,
      result,
      shouldDeliver,
      warning: result.action === 'warn' ? 'May contain sensitive content' : undefined,
    }
  }

  async screenMessages(msgs: MessageEnvelope[]): Promise<MessageScreeningResult[]> {
    return Promise.all(msgs.map(m => this.screenMessage(m)))
  }

  private logAudit(msg: MessageEnvelope, result: ModerationResult): void {
    const entry: AuditEntry = {
      timestamp: Date.now(),
      messageId: msg.id,
      contentHash: msg.contentHash,
      sender: msg.sender,
      action: result.action,
      severity: result.severity,
      category: result.primaryCategory,
    }

    this.audit.push(entry)

    // Update stats
    if (result.action === 'allow') this.stats.allowed++
    else if (result.action === 'warn') this.stats.warned++
    else this.stats.blocked++

    // Trim in-memory audit log
    if (this.audit.length > this.maxAuditSize) {
      this.audit = this.audit.slice(-this.maxAuditSize / 2)
    }

    // Call external audit handler if configured
    if (this.onAudit) {
      Promise.resolve(this.onAudit(entry)).catch(() => {
        // Swallow errors - don't let audit failures affect message flow
      })
    }
  }

  getAuditLog(filter?: { action?: ModerationAction; sender?: Address; startTime?: number; endTime?: number }): AuditEntry[] {
    if (!filter) return this.audit
    return this.audit.filter(e =>
      (!filter.action || e.action === filter.action) &&
      (!filter.sender || e.sender === filter.sender) &&
      (!filter.startTime || e.timestamp >= filter.startTime) &&
      (!filter.endTime || e.timestamp <= filter.endTime)
    )
  }

  getStats() {
    return { total: this.audit.length, ...this.stats }
  }

  clearAuditLog(): void {
    this.audit = []
    this.stats = { blocked: 0, warned: 0, allowed: 0 }
  }

  private emptyResult(): ModerationResult {
    return { safe: true, action: 'allow', severity: 'none', categories: [], reviewRequired: false, processingTimeMs: 0, providers: [] }
  }
}

let instance: MessagingModerationService | null = null

export function getMessagingModerationService(): MessagingModerationService {
  if (!instance) {
    instance = new MessagingModerationService({
      openai: process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : undefined,
    })
  }
  return instance
}

export function createMessagingModerationService(config: PipelineConfig): MessagingModerationService {
  return new MessagingModerationService(config)
}

export function resetMessagingModerationService(): void {
  instance = null
}
