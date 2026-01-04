/**
 * @jejunetwork/durable-objects - Durable Object State Implementation
 *
 * Provides runtime state for a DO instance including:
 * - Storage access (persisted to SQLit)
 * - WebSocket management (in-memory only - connections are live sockets)
 * - Concurrency control
 * - Background task tracking
 *
 * NOTE: WebSocket connections are tracked in-memory only. This is intentional
 * because WebSocket connections are live TCP sockets that cannot survive
 * process restarts. When a DO is evicted, all WebSockets are closed.
 * If you need to reconnect clients after eviction, use storage to persist
 * reconnection tokens and have clients reconnect when they detect disconnection.
 */

import { getLogLevel } from '@jejunetwork/config'
import type { SQLitClient } from '@jejunetwork/db'
import pino from 'pino'
import type { DWSObjectId } from './id.js'
import { DWSObjectStorage } from './storage.js'
import type {
  DurableObjectId,
  DurableObjectState,
  DurableObjectStorage,
} from './types.js'

const log = pino({
  name: 'durable-objects:state',
  level: getLogLevel(),
})

interface WebSocketEntry {
  ws: WebSocket
  tags: string[]
  attachment?: unknown
}

/**
 * DWS implementation of DurableObjectState
 */
export class DWSObjectState implements DurableObjectState {
  readonly id: DurableObjectId
  readonly storage: DurableObjectStorage

  private readonly doIdString: string
  private readonly debug: boolean

  // WebSocket management - indexed both ways for efficient lookup
  private webSockets = new Map<string, WebSocketEntry>()
  private wsToId = new WeakMap<WebSocket, string>()
  private wsIdCounter = 0
  private wsEventTimeout?: number

  // Concurrency control
  private blockingPromise: Promise<void> | null = null
  private pendingRequests: Array<() => void> = []

  // Background tasks
  private waitUntilPromises: Promise<unknown>[] = []

  constructor(
    id: DWSObjectId,
    sqlit: SQLitClient,
    databaseId: string,
    debug = false,
  ) {
    this.id = id
    this.doIdString = id.toString()
    this.debug = debug
    this.storage = new DWSObjectStorage(
      this.doIdString,
      sqlit,
      databaseId,
      debug,
    ) as DurableObjectStorage
  }

  // ============================================================================
  // Concurrency Control
  // ============================================================================

  async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    // If already blocking, wait for it
    if (this.blockingPromise) {
      await this.blockingPromise
    }

    // Set up blocking
    let resolveBlocking!: () => void
    this.blockingPromise = new Promise((resolve) => {
      resolveBlocking = resolve
    })

    let result: T

    try {
      result = await fn()
    } finally {
      // Release blocking
      this.blockingPromise = null
      resolveBlocking?.()

      // Process any pending requests
      for (const resolve of this.pendingRequests) {
        resolve()
      }
      this.pendingRequests = []
    }

    return result
  }

  /**
   * Wait for any blocking operation to complete
   * Used internally before processing requests
   */
  async waitForUnblock(): Promise<void> {
    if (this.blockingPromise) {
      await new Promise<void>((resolve) => {
        this.pendingRequests.push(resolve)
      })
    }
  }

  // ============================================================================
  // Background Tasks
  // ============================================================================

  waitUntil(promise: Promise<unknown>): void {
    this.waitUntilPromises.push(
      promise.catch((err) => {
        log.error(
          { doId: this.doIdString, error: err },
          'waitUntil promise rejected',
        )
      }),
    )
  }

  /**
   * Wait for all background tasks to complete
   * Called when the DO is being evicted
   */
  async drainWaitUntil(): Promise<void> {
    if (this.waitUntilPromises.length > 0) {
      await Promise.allSettled(this.waitUntilPromises)
      this.waitUntilPromises = []
    }
  }

  // ============================================================================
  // WebSocket Management
  // ============================================================================

  acceptWebSocket(ws: WebSocket, tags?: string[]): void {
    const wsId = `ws-${this.doIdString}-${++this.wsIdCounter}-${Date.now()}`
    const entry: WebSocketEntry = { ws, tags: tags ?? [] }

    this.webSockets.set(wsId, entry)
    this.wsToId.set(ws, wsId)

    if (this.debug) {
      log.debug(
        { doId: this.doIdString, wsId, tags: entry.tags },
        'WebSocket accepted',
      )
    }

    // Cleanup on close/error
    const cleanup = () => {
      this.webSockets.delete(wsId)
      if (this.debug)
        log.debug({ doId: this.doIdString, wsId }, 'WebSocket removed')
    }

    const originalOnclose = ws.onclose
    ws.onclose = (event) => {
      cleanup()
      originalOnclose?.call(ws, event)
    }

    const originalOnerror = ws.onerror
    ws.onerror = (event) => {
      cleanup()
      originalOnerror?.call(ws, event)
    }
  }

  getWebSockets(tag?: string): WebSocket[] {
    const result: WebSocket[] = []

    for (const entry of this.webSockets.values()) {
      if (tag === undefined || entry.tags.includes(tag)) {
        result.push(entry.ws)
      }
    }

    if (this.debug) {
      log.debug(
        { doId: this.doIdString, tag, count: result.length },
        'getWebSockets',
      )
    }

    return result
  }

  setHibernatableWebSocketEventTimeout(timeoutMs?: number): void {
    this.wsEventTimeout = timeoutMs

    if (this.debug) {
      log.debug(
        { doId: this.doIdString, timeoutMs },
        'setHibernatableWebSocketEventTimeout',
      )
    }
  }

  /**
   * Get the configured WebSocket event timeout
   */
  getWebSocketEventTimeout(): number | undefined {
    return this.wsEventTimeout
  }

  /**
   * Get the count of active WebSocket connections
   */
  getWebSocketCount(): number {
    return this.webSockets.size
  }

  /**
   * Broadcast a message to all WebSockets, optionally filtered by tag
   */
  broadcast(message: string | ArrayBuffer, tag?: string): void {
    const sockets = this.getWebSockets(tag)
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message)
      }
    }

    if (this.debug) {
      log.debug(
        { doId: this.doIdString, tag, count: sockets.length },
        'broadcast',
      )
    }
  }

  /**
   * Close all WebSocket connections
   * Called when the DO is being evicted
   */
  closeAllWebSockets(code = 1000, reason = 'Durable Object evicted'): void {
    for (const entry of this.webSockets.values()) {
      if (entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.close(code, reason)
      }
    }
    this.webSockets.clear()

    if (this.debug) {
      log.debug({ doId: this.doIdString }, 'All WebSockets closed')
    }
  }

  // ============================================================================
  // WebSocket Attachment (for hibernation)
  // ============================================================================

  private getEntry(ws: WebSocket): WebSocketEntry | undefined {
    const wsId = this.wsToId.get(ws)
    return wsId ? this.webSockets.get(wsId) : undefined
  }

  getWebSocketAttachment(ws: WebSocket): unknown | undefined {
    return this.getEntry(ws)?.attachment
  }

  setWebSocketAttachment(ws: WebSocket, attachment: unknown): void {
    const entry = this.getEntry(ws)
    if (entry) entry.attachment = attachment
  }

  getWebSocketTags(ws: WebSocket): string[] {
    return [...(this.getEntry(ws)?.tags ?? [])]
  }
}

/**
 * Create a new DurableObjectState for a DO instance
 */
export function createDurableObjectState(
  id: DWSObjectId,
  sqlit: SQLitClient,
  databaseId: string,
  debug = false,
): DWSObjectState {
  return new DWSObjectState(id, sqlit, databaseId, debug)
}
