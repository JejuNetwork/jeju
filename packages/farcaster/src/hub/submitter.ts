/**
 * Hub Message Submitter
 *
 * Submits signed messages to Farcaster hubs via HTTP API.
 */

import type { Hex } from 'viem'
import type { Message } from './message-builder'
import { messageBytesToHex, serializeMessage } from './message-builder'

// ============ Types ============

export interface HubSubmitterConfig {
  /** Hub HTTP API URL */
  hubUrl: string
  /** Request timeout in ms */
  timeoutMs?: number
  /** Retry configuration */
  retries?: number
  /** Delay between retries in ms */
  retryDelayMs?: number
}

export interface SubmitResult {
  success: boolean
  hash?: Hex
  error?: string
  details?: string
  retries?: number
}

export interface HubInfo {
  version: string
  isSyncing: boolean
  nickname: string
  rootHash: string
  dbStats: {
    numMessages: number
    numFids: number
  }
  peerId: string
}

// ============ Hub Submitter Class ============

export class HubSubmitter {
  private readonly hubUrl: string
  private readonly timeout: number
  private readonly maxRetries: number
  private readonly retryDelay: number

  constructor(config: HubSubmitterConfig) {
    this.hubUrl = config.hubUrl.replace(/\/$/, '')
    this.timeout = config.timeoutMs ?? 10000
    this.maxRetries = config.retries ?? 3
    this.retryDelay = config.retryDelayMs ?? 1000
  }

  /**
   * Get hub info to verify connectivity
   */
  async getHubInfo(): Promise<HubInfo> {
    const response = await this.fetchWithTimeout(`${this.hubUrl}/v1/info`)

    if (!response.ok) {
      throw new Error(
        `Failed to get hub info: ${response.status} ${response.statusText}`,
      )
    }

    return response.json() as Promise<HubInfo>
  }

  /**
   * Check if hub is available and synced
   */
  async isReady(): Promise<boolean> {
    const info = await this.getHubInfo()
    return !info.isSyncing
  }

  /**
   * Submit a message to the hub
   */
  async submit(message: Message): Promise<SubmitResult> {
    let lastError: Error | undefined
    let retries = 0

    while (retries <= this.maxRetries) {
      const result = await this.submitOnce(message)

      if (result.success) {
        return { ...result, retries }
      }

      // Check if error is retryable
      if (!this.isRetryableError(result.error ?? '')) {
        return { ...result, retries }
      }

      lastError = new Error(result.error)
      retries++

      if (retries <= this.maxRetries) {
        await this.delay(this.retryDelay * retries)
      }
    }

    return {
      success: false,
      error: lastError?.message ?? 'Max retries exceeded',
      retries,
    }
  }

  /**
   * Submit a message once (no retries)
   */
  private async submitOnce(message: Message): Promise<SubmitResult> {
    const encoded = serializeMessage(message)

    let response: Response
    try {
      response = await this.fetchWithTimeout(
        `${this.hubUrl}/v1/submitMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          body: Buffer.from(encoded),
        },
      )
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Network error'
      return {
        success: false,
        error: `Network error: ${errorMessage}`,
      }
    }

    if (!response.ok) {
      let errorDetails: string
      try {
        const errorBody = await response.json()
        errorDetails = JSON.stringify(errorBody)
      } catch {
        errorDetails = await response.text().catch(() => 'Unknown error')
      }

      return {
        success: false,
        error: `Hub rejected message: ${response.status}`,
        details: errorDetails,
      }
    }

    // Success - return hash
    return {
      success: true,
      hash: messageBytesToHex(message.hash),
    }
  }

  /**
   * Submit multiple messages in sequence
   */
  async submitBatch(messages: Message[]): Promise<SubmitResult[]> {
    const results: SubmitResult[] = []

    for (const message of messages) {
      const result = await this.submit(message)
      results.push(result)

      // Stop on first failure if we want atomic behavior
      if (!result.success) {
        // Mark remaining as not attempted
        for (let i = results.length; i < messages.length; i++) {
          results.push({
            success: false,
            error: 'Not attempted due to previous failure',
          })
        }
        break
      }
    }

    return results
  }

  /**
   * Submit multiple messages in parallel
   */
  async submitParallel(messages: Message[]): Promise<SubmitResult[]> {
    return Promise.all(messages.map((msg) => this.submit(msg)))
  }

  /**
   * Validate a message without submitting
   */
  async validate(
    message: Message,
  ): Promise<{ valid: boolean; error?: string }> {
    const encoded = serializeMessage(message)

    const response = await this.fetchWithTimeout(
      `${this.hubUrl}/v1/validateMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: Buffer.from(encoded),
      },
    )

    if (!response.ok) {
      const error = await response.text().catch(() => 'Validation failed')
      return { valid: false, error }
    }

    const result = (await response.json()) as { valid: boolean }
    return { valid: result.valid }
  }

  // ============ Private Helpers ============

  private async fetchWithTimeout(
    url: string,
    options?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private isRetryableError(error: string): boolean {
    const retryablePatterns = [
      'timeout',
      'network',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      '502',
      '503',
      '504',
      'rate limit',
    ]

    const lowerError = error.toLowerCase()
    return retryablePatterns.some((pattern) =>
      lowerError.includes(pattern.toLowerCase()),
    )
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============ Hub Selection ============

export interface HubEndpoint {
  url: string
  priority: number
  region?: string
}

/**
 * Select best hub from a list based on availability
 */
export async function selectBestHub(
  hubs: HubEndpoint[],
  timeoutMs: number = 5000,
): Promise<HubEndpoint | null> {
  // Sort by priority
  const sorted = [...hubs].sort((a, b) => a.priority - b.priority)

  for (const hub of sorted) {
    const submitter = new HubSubmitter({ hubUrl: hub.url, timeoutMs })

    try {
      const ready = await submitter.isReady()
      if (ready) {
        return hub
      }
    } catch {}
  }

  return null
}

/**
 * Create a submitter with automatic failover
 */
export class FailoverHubSubmitter {
  private hubs: HubEndpoint[]
  private currentHub: HubSubmitter | null = null
  private currentIndex: number = 0
  private readonly timeout: number

  constructor(hubs: HubEndpoint[], timeoutMs: number = 10000) {
    this.hubs = [...hubs].sort((a, b) => a.priority - b.priority)
    this.timeout = timeoutMs
  }

  private async ensureHub(): Promise<HubSubmitter> {
    if (this.currentHub) {
      return this.currentHub
    }

    for (let i = this.currentIndex; i < this.hubs.length; i++) {
      const hub = this.hubs[i]
      const submitter = new HubSubmitter({
        hubUrl: hub.url,
        timeoutMs: this.timeout,
      })

      try {
        await submitter.getHubInfo()
        this.currentHub = submitter
        this.currentIndex = i
        return submitter
      } catch {}
    }

    throw new Error('No available hubs')
  }

  async submit(message: Message): Promise<SubmitResult> {
    const submitter = await this.ensureHub()
    const result = await submitter.submit(message)

    // If failed due to hub issue, try failover
    if (!result.success && this.isHubError(result.error ?? '')) {
      this.currentHub = null
      this.currentIndex++

      if (this.currentIndex < this.hubs.length) {
        const fallback = await this.ensureHub()
        return fallback.submit(message)
      }
    }

    return result
  }

  private isHubError(error: string): boolean {
    const hubErrorPatterns = [
      'network',
      'timeout',
      'connection',
      '502',
      '503',
      '504',
    ]
    const lowerError = error.toLowerCase()
    return hubErrorPatterns.some((pattern) => lowerError.includes(pattern))
  }
}
