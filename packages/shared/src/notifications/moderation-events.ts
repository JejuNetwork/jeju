/**
 * Moderation Event Notification System
 *
 * Monitors on-chain moderation events and sends notifications via:
 * - WebSocket for real-time UI updates
 * - Webhooks for external integrations
 * - Email (optional) for high-priority events
 */

import EventEmitter from 'node:events'
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
  type Log,
  type PublicClient,
  type Transport,
} from 'viem'
import { baseSepolia } from 'viem/chains'

// ============ Types ============

export interface ModerationEvent {
  type: EventType
  timestamp: number
  blockNumber: number
  txHash: Hex
  data: EventData
}

export type EventType =
  | 'BAN_APPLIED'
  | 'BAN_REMOVED'
  | 'CASE_CREATED'
  | 'CASE_RESOLVED'
  | 'VOTE_CAST'
  | 'REPORT_SUBMITTED'
  | 'LABEL_APPLIED'
  | 'STAKE_DEPOSITED'
  | 'STAKE_WITHDRAWN'
  | 'ON_NOTICE'
  | 'SLASH_APPLIED'

export interface EventData {
  target?: Address
  agentId?: string
  caseId?: Hex
  reporter?: Address
  voter?: Address
  amount?: string
  reason?: string
  outcome?: string
  label?: string
  position?: string
  [key: string]: string | undefined
}

export interface NotificationConfig {
  rpcUrl: string
  banManagerAddress: Address
  moderationMarketplaceAddress: Address
  reportingSystemAddress: Address
  webhookUrls?: string[]
  wsPort?: number
  pollInterval?: number
}

export interface Subscriber {
  id: string
  filter?: {
    eventTypes?: EventType[]
    addresses?: Address[]
    agentIds?: string[]
  }
  callback: (event: ModerationEvent) => void
}

// ============ Notification Service ============

export class ModerationNotificationService extends EventEmitter {
  private config: Required<NotificationConfig>
  private publicClient: PublicClient<Transport, Chain>
  private subscribers: Map<string, Subscriber> = new Map()
  private lastProcessedBlock: bigint = 0n
  private isRunning: boolean = false
  private pollTimer: NodeJS.Timeout | null = null

  constructor(config: NotificationConfig) {
    super()

    this.config = {
      rpcUrl: config.rpcUrl,
      banManagerAddress: config.banManagerAddress,
      moderationMarketplaceAddress: config.moderationMarketplaceAddress,
      reportingSystemAddress: config.reportingSystemAddress,
      webhookUrls: config.webhookUrls || [],
      wsPort: config.wsPort || 8081,
      pollInterval: config.pollInterval || 5000,
    }

    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.config.rpcUrl),
    }) as PublicClient<Transport, Chain>
  }

  /**
   * Start monitoring for events
   */
  async start(): Promise<void> {
    if (this.isRunning) return

    this.isRunning = true
    this.lastProcessedBlock = await this.publicClient.getBlockNumber()

    console.log(
      `[ModerationNotifications] Starting from block ${this.lastProcessedBlock}`,
    )

    // Start polling loop
    this.pollTimer = setInterval(
      () => this.pollEvents(),
      this.config.pollInterval,
    )

    this.emit('started', { fromBlock: this.lastProcessedBlock })
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.isRunning = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.emit('stopped')
  }

  /**
   * Subscribe to events
   */
  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.set(subscriber.id, subscriber)

    return () => {
      this.subscribers.delete(subscriber.id)
    }
  }

  /**
   * Poll for new events
   */
  private async pollEvents(): Promise<void> {
    if (!this.isRunning) return

    const currentBlock = await this.publicClient.getBlockNumber()
    if (currentBlock <= this.lastProcessedBlock) return

    // Fetch logs from all moderation contracts
    const logs = await this.publicClient.getLogs({
      address: [
        this.config.banManagerAddress,
        this.config.moderationMarketplaceAddress,
        this.config.reportingSystemAddress,
      ],
      fromBlock: this.lastProcessedBlock + 1n,
      toBlock: currentBlock,
    })

    // Process each log
    for (const log of logs) {
      const event = this.parseLog(log)
      if (event) {
        await this.processEvent(event)
      }
    }

    this.lastProcessedBlock = currentBlock
  }

  /**
   * Parse a log into a ModerationEvent
   */
  private parseLog(log: Log): ModerationEvent | null {
    const topic0 = log.topics[0]
    if (!topic0) return null

    let type: EventType | null = null
    const data: EventData = {}

    // Match topic to event type
    if (topic0.includes('BanApplied')) {
      type = topic0.includes('NetworkBan') ? 'BAN_APPLIED' : 'BAN_APPLIED'
      data.target = log.topics[1] as Address
    } else if (topic0.includes('BanRemoved')) {
      type = 'BAN_REMOVED'
      data.target = log.topics[1] as Address
    } else if (topic0.includes('CaseCreated')) {
      type = 'CASE_CREATED'
      data.caseId = log.topics[1] as Hex
      data.reporter = log.topics[2] as Address
      data.target = log.topics[3] as Address
    } else if (topic0.includes('CaseResolved')) {
      type = 'CASE_RESOLVED'
      data.caseId = log.topics[1] as Hex
    } else if (topic0.includes('VoteCast')) {
      type = 'VOTE_CAST'
      data.caseId = log.topics[1] as Hex
      data.voter = log.topics[2] as Address
    } else if (topic0.includes('ReportSubmitted')) {
      type = 'REPORT_SUBMITTED'
      data.reporter = log.topics[3] as Address
    } else if (topic0.includes('OnNotice')) {
      type = 'ON_NOTICE'
      data.target = log.topics[1] as Address
    }

    if (!type) return null

    return {
      type,
      timestamp: Date.now(),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash as Hex,
      data,
    }
  }

  /**
   * Process and distribute an event
   */
  private async processEvent(event: ModerationEvent): Promise<void> {
    // Emit to EventEmitter listeners
    this.emit('event', event)
    this.emit(event.type, event)

    // Notify subscribers
    for (const subscriber of this.subscribers.values()) {
      if (this.matchesFilter(event, subscriber.filter)) {
        try {
          subscriber.callback(event)
        } catch (error) {
          console.error(
            `[ModerationNotifications] Subscriber ${subscriber.id} error:`,
            error,
          )
        }
      }
    }

    // Send webhooks
    await this.sendWebhooks(event)
  }

  /**
   * Check if event matches subscriber filter
   */
  private matchesFilter(
    event: ModerationEvent,
    filter?: Subscriber['filter'],
  ): boolean {
    if (!filter) return true

    if (filter.eventTypes && !filter.eventTypes.includes(event.type)) {
      return false
    }

    if (filter.addresses) {
      const eventAddresses = [
        event.data.target,
        event.data.reporter,
        event.data.voter,
      ].filter(Boolean) as Address[]

      if (
        !eventAddresses.some((addr) =>
          filter.addresses
            ?.map((a) => a.toLowerCase())
            .includes(addr.toLowerCase()),
        )
      ) {
        return false
      }
    }

    if (filter.agentIds && event.data.agentId) {
      if (!filter.agentIds.includes(event.data.agentId)) {
        return false
      }
    }

    return true
  }

  /**
   * Send event to configured webhooks
   */
  private async sendWebhooks(event: ModerationEvent): Promise<void> {
    for (const webhookUrl of this.config.webhookUrls) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Type': event.type,
          },
          body: JSON.stringify({
            event,
            timestamp: new Date().toISOString(),
            source: 'jeju-moderation',
          }),
        })
      } catch (error) {
        console.error(
          `[ModerationNotifications] Webhook failed for ${webhookUrl}:`,
          error,
        )
      }
    }
  }

  /**
   * Get subscription for a user address
   */
  getAddressSubscription(address: Address): Subscriber | undefined {
    return Array.from(this.subscribers.values()).find((sub) =>
      sub.filter?.addresses
        ?.map((a) => a.toLowerCase())
        .includes(address.toLowerCase()),
    )
  }
}

// ============ Factory ============

export function createModerationNotifications(
  config: NotificationConfig,
): ModerationNotificationService {
  return new ModerationNotificationService(config)
}

// ============ High Priority Event Handlers ============

/**
 * Create notification for ban events (high priority)
 */
export function createBanNotification(event: ModerationEvent): {
  title: string
  body: string
  priority: 'high' | 'normal' | 'low'
  action?: string
} {
  switch (event.type) {
    case 'BAN_APPLIED':
      return {
        title: 'Account Banned',
        body: `Address ${event.data.target?.slice(0, 10)}... has been banned. Reason: ${event.data.reason || 'N/A'}`,
        priority: 'high',
        action: `/moderation/case/${event.data.caseId}`,
      }
    case 'ON_NOTICE':
      return {
        title: 'Account Under Review',
        body: `Address ${event.data.target?.slice(0, 10)}... has been placed on notice pending review.`,
        priority: 'high',
        action: `/moderation/case/${event.data.caseId}`,
      }
    case 'CASE_CREATED':
      return {
        title: 'New Moderation Case',
        body: `A new case has been opened against ${event.data.target?.slice(0, 10)}...`,
        priority: 'normal',
        action: `/moderation/case/${event.data.caseId}`,
      }
    case 'CASE_RESOLVED':
      return {
        title: 'Case Resolved',
        body: `Moderation case ${event.data.caseId?.slice(0, 10)}... has been resolved. Outcome: ${event.data.outcome}`,
        priority: 'normal',
        action: `/moderation/case/${event.data.caseId}`,
      }
    default:
      return {
        title: 'Moderation Update',
        body: `Event: ${event.type}`,
        priority: 'low',
      }
  }
}
