/**
 * @jejunetwork/durable-objects - State Implementation
 *
 * Runtime state for DO instances: storage, WebSocket management, concurrency control.
 * WebSockets are in-memory only (live TCP sockets can't survive restarts).
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

const log = pino({ name: 'durable-objects:state', level: getLogLevel() })

interface WebSocketEntry {
  ws: WebSocket
  tags: string[]
  attachment?: unknown
}

export class DWSObjectState implements DurableObjectState {
  readonly id: DurableObjectId
  readonly storage: DurableObjectStorage

  private readonly doIdString: string
  private readonly debug: boolean
  private webSockets = new Map<string, WebSocketEntry>()
  private wsToId = new WeakMap<WebSocket, string>()
  private wsIdCounter = 0
  private wsEventTimeout?: number
  private blockingPromise: Promise<void> | null = null
  private pendingRequests: Array<() => void> = []
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

  async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    if (this.blockingPromise) await this.blockingPromise

    let resolveBlocking!: () => void
    this.blockingPromise = new Promise((resolve) => {
      resolveBlocking = resolve
    })

    try {
      return await fn()
    } finally {
      this.blockingPromise = null
      resolveBlocking?.()
      for (const resolve of this.pendingRequests) resolve()
      this.pendingRequests = []
    }
  }

  async waitForUnblock(): Promise<void> {
    if (this.blockingPromise) {
      await new Promise<void>((resolve) => {
        this.pendingRequests.push(resolve)
      })
    }
  }

  waitUntil(promise: Promise<unknown>): void {
    this.waitUntilPromises.push(
      promise.catch((err) =>
        log.error({ doId: this.doIdString, error: err }, 'waitUntil rejected'),
      ),
    )
  }

  async drainWaitUntil(): Promise<void> {
    if (this.waitUntilPromises.length > 0) {
      await Promise.allSettled(this.waitUntilPromises)
      this.waitUntilPromises = []
    }
  }

  acceptWebSocket(ws: WebSocket, tags?: string[]): void {
    const wsId = `ws-${this.doIdString}-${++this.wsIdCounter}-${Date.now()}`
    this.webSockets.set(wsId, { ws, tags: tags ?? [] })
    this.wsToId.set(ws, wsId)

    if (this.debug)
      log.debug({ doId: this.doIdString, wsId, tags }, 'WebSocket accepted')

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
      if (tag === undefined || entry.tags.includes(tag)) result.push(entry.ws)
    }
    return result
  }

  setHibernatableWebSocketEventTimeout(timeoutMs?: number): void {
    this.wsEventTimeout = timeoutMs
  }

  getWebSocketEventTimeout(): number | undefined {
    return this.wsEventTimeout
  }

  getWebSocketCount(): number {
    return this.webSockets.size
  }

  broadcast(message: string | ArrayBuffer, tag?: string): void {
    for (const ws of this.getWebSockets(tag)) {
      if (ws.readyState === WebSocket.OPEN) ws.send(message)
    }
  }

  closeAllWebSockets(code = 1000, reason = 'Durable Object evicted'): void {
    for (const entry of this.webSockets.values()) {
      if (entry.ws.readyState === WebSocket.OPEN) entry.ws.close(code, reason)
    }
    this.webSockets.clear()
  }

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

export function createDurableObjectState(
  id: DWSObjectId,
  sqlit: SQLitClient,
  databaseId: string,
  debug = false,
): DWSObjectState {
  return new DWSObjectState(id, sqlit, databaseId, debug)
}
