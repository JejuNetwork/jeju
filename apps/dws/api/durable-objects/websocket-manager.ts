/**
 * Durable Objects WebSocket Manager
 *
 * Manages WebSocket connections for Durable Objects.
 * Handles the bridge between Bun WebSocket server and DO instances.
 *
 * Architecture:
 * 1. Client connects to DWS server with WS upgrade to /do/{namespace}/{doId}/ws
 * 2. DWS server upgrades the connection and creates a bridge
 * 3. Bridge forwards messages between client WS and DO instance
 * 4. DO calls state.acceptWebSocket(ws) to accept the connection
 * 5. Messages are forwarded to DO's webSocketMessage() handler
 */

import { getLogLevel, getSQLitDatabaseId } from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import type { DurableObject } from '@jejunetwork/durable-objects'
import pino from 'pino'

const log = pino({
  name: 'dws:websocket-manager',
  level: getLogLevel(),
})

// ============================================================================
// Types
// ============================================================================

/** Represents a WebSocket connection to a client */
interface ClientWebSocket {
  /** Unique ID for this connection */
  id: string
  /** The namespace of the DO */
  namespace: string
  /** The DO ID */
  doId: string
  /** Tags assigned to this WebSocket */
  tags: string[]
  /** Attachment data (serializable) */
  attachment?: unknown
  /** Send a message to the client */
  send(message: string | ArrayBuffer): void
  /** Close the connection */
  close(code?: number, reason?: string): void
  /** Connection state */
  readyState: number
}

/** Bridge between client WebSocket and DO instance */
interface WebSocketBridge {
  /** The client-facing WebSocket handle */
  clientWs: ClientWebSocket
  /** The DO instance handling this connection */
  doInstance?: DurableObject
  /** Whether the DO has accepted this WebSocket */
  accepted: boolean
  /** Message queue for messages received before DO accepts */
  messageQueue: Array<string | ArrayBuffer>
  /** Created timestamp */
  createdAt: number
}

// ============================================================================
// WebSocket Manager
// ============================================================================

/**
 * Manages WebSocket connections for all Durable Objects
 */
export class DOWebSocketManager {
  private bridges = new Map<string, WebSocketBridge>()
  private wsIdCounter = 0
  private sqlit: SQLitClient
  private databaseId: string
  private debug: boolean

  constructor(sqlit: SQLitClient, databaseId: string, debug = false) {
    this.sqlit = sqlit
    this.databaseId = databaseId
    this.debug = debug
  }

  /**
   * Create a new WebSocket bridge for an incoming connection
   */
  createBridge(
    namespace: string,
    doId: string,
    sendFn: (message: string | ArrayBuffer) => void,
    closeFn: (code?: number, reason?: string) => void,
    readyStateFn: () => number,
  ): string {
    const wsId = `ws-${namespace}-${doId}-${++this.wsIdCounter}-${Date.now()}`

    const clientWs: ClientWebSocket = {
      id: wsId,
      namespace,
      doId,
      tags: [],
      send: sendFn,
      close: closeFn,
      get readyState() {
        return readyStateFn()
      },
    }

    const bridge: WebSocketBridge = {
      clientWs,
      accepted: false,
      messageQueue: [],
      createdAt: Date.now(),
    }

    this.bridges.set(wsId, bridge)

    if (this.debug) {
      log.debug({ wsId, namespace, doId }, 'Created WebSocket bridge')
    }

    // Record in database
    this.recordWebSocket(wsId, namespace, doId).catch((err) => {
      log.error({ wsId, error: err }, 'Failed to record WebSocket')
    })

    return wsId
  }

  /**
   * Accept a WebSocket for a DO instance
   * Called when DO calls state.acceptWebSocket(ws)
   */
  acceptWebSocket(
    wsId: string,
    doInstance: DurableObject,
    tags: string[] = [],
  ): void {
    const bridge = this.bridges.get(wsId)
    if (!bridge) {
      log.warn({ wsId }, 'Attempted to accept unknown WebSocket')
      return
    }

    bridge.doInstance = doInstance
    bridge.accepted = true
    bridge.clientWs.tags = tags

    if (this.debug) {
      log.debug({ wsId, tags }, 'WebSocket accepted by DO')
    }

    // Process any queued messages
    for (const message of bridge.messageQueue) {
      this.dispatchMessage(wsId, message)
    }
    bridge.messageQueue = []

    // Update database
    this.updateWebSocketTags(wsId, tags).catch((err) => {
      log.error({ wsId, error: err }, 'Failed to update WebSocket tags')
    })
  }

  /**
   * Handle an incoming message from the client
   */
  onMessage(wsId: string, message: string | ArrayBuffer): void {
    const bridge = this.bridges.get(wsId)
    if (!bridge) {
      log.warn({ wsId }, 'Message received for unknown WebSocket')
      return
    }

    if (!bridge.accepted) {
      // Queue message until DO accepts
      bridge.messageQueue.push(message)
      return
    }

    this.dispatchMessage(wsId, message)
  }

  /**
   * Dispatch a message to the DO instance
   */
  private dispatchMessage(wsId: string, message: string | ArrayBuffer): void {
    const bridge = this.bridges.get(wsId)
    if (!bridge?.doInstance?.webSocketMessage) return

    // Create a WebSocket-like object for the DO
    const ws = this.createDOWebSocket(wsId)

    const result = bridge.doInstance.webSocketMessage(ws, message)
    if (result instanceof Promise) {
      result.catch((err: Error) => {
        log.error({ wsId, error: err }, 'webSocketMessage handler threw')
      })
    }

    // Update last message time
    this.updateWebSocketLastMessage(wsId).catch((err) => {
      log.error({ wsId, error: err }, 'Failed to update last message time')
    })
  }

  /**
   * Handle client WebSocket close
   */
  onClose(wsId: string, code: number, reason: string, wasClean: boolean): void {
    const bridge = this.bridges.get(wsId)
    if (!bridge) return

    if (bridge.accepted && bridge.doInstance?.webSocketClose) {
      const ws = this.createDOWebSocket(wsId)
      const result = bridge.doInstance.webSocketClose(
        ws,
        code,
        reason,
        wasClean,
      )
      if (result instanceof Promise) {
        result.catch((err: Error) => {
          log.error({ wsId, error: err }, 'webSocketClose handler threw')
        })
      }
    }

    // Clean up
    this.bridges.delete(wsId)

    if (this.debug) {
      log.debug({ wsId, code, reason }, 'WebSocket closed')
    }

    // Remove from database
    this.removeWebSocket(wsId).catch((err) => {
      log.error(
        { wsId, error: err },
        'Failed to remove WebSocket from database',
      )
    })
  }

  /**
   * Handle client WebSocket error
   */
  onError(wsId: string, error: Error): void {
    const bridge = this.bridges.get(wsId)
    if (!bridge) return

    if (bridge.accepted && bridge.doInstance?.webSocketError) {
      const ws = this.createDOWebSocket(wsId)
      const result = bridge.doInstance.webSocketError(ws, error)
      if (result instanceof Promise) {
        result.catch((err: Error) => {
          log.error({ wsId, error: err }, 'webSocketError handler threw')
        })
      }
    }

    // Clean up
    this.bridges.delete(wsId)

    // Remove from database
    this.removeWebSocket(wsId).catch((err) => {
      log.error(
        { wsId, error: err },
        'Failed to remove WebSocket from database',
      )
    })
  }

  /**
   * Get all WebSockets for a DO, optionally filtered by tag
   */
  getWebSockets(namespace: string, doId: string, tag?: string): WebSocket[] {
    const result: WebSocket[] = []

    for (const bridge of this.bridges.values()) {
      if (
        bridge.clientWs.namespace !== namespace ||
        bridge.clientWs.doId !== doId
      ) {
        continue
      }
      if (!bridge.accepted) {
        continue
      }
      if (tag !== undefined && !bridge.clientWs.tags.includes(tag)) {
        continue
      }
      result.push(this.createDOWebSocket(bridge.clientWs.id))
    }

    return result
  }

  /**
   * Get WebSocket count for a DO
   */
  getWebSocketCount(namespace: string, doId: string): number {
    let count = 0
    for (const bridge of this.bridges.values()) {
      if (
        bridge.clientWs.namespace === namespace &&
        bridge.clientWs.doId === doId &&
        bridge.accepted
      ) {
        count++
      }
    }
    return count
  }

  /**
   * Close all WebSockets for a DO
   */
  closeAllWebSockets(
    namespace: string,
    doId: string,
    code = 1000,
    reason = 'Durable Object evicted',
  ): void {
    for (const [wsId, bridge] of this.bridges.entries()) {
      if (
        bridge.clientWs.namespace === namespace &&
        bridge.clientWs.doId === doId
      ) {
        bridge.clientWs.close(code, reason)
        this.bridges.delete(wsId)
      }
    }
  }

  /**
   * Set attachment for a WebSocket
   */
  setAttachment(wsId: string, attachment: unknown): void {
    const bridge = this.bridges.get(wsId)
    if (bridge) {
      bridge.clientWs.attachment = attachment
    }
  }

  /**
   * Get attachment for a WebSocket
   */
  getAttachment(wsId: string): unknown | undefined {
    return this.bridges.get(wsId)?.clientWs.attachment
  }

  /**
   * Create a WebSocket-like object for DO handlers
   */
  private createDOWebSocket(wsId: string): WebSocket {
    const bridge = this.bridges.get(wsId)
    if (!bridge) {
      throw new Error(`WebSocket ${wsId} not found`)
    }

    // Return a WebSocket-like object
    return {
      send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        if (typeof data === 'string' || data instanceof ArrayBuffer) {
          bridge.clientWs.send(data)
        } else if (ArrayBuffer.isView(data)) {
          const buffer = data.buffer
          if (buffer instanceof ArrayBuffer) {
            bridge.clientWs.send(
              buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
            )
          }
        }
      },
      close: (code?: number, reason?: string) => {
        bridge.clientWs.close(code, reason)
      },
      get readyState() {
        return bridge.clientWs.readyState
      },
      // WebSocket constants
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
      // Event handlers (not used - we call DO methods directly)
      onopen: null,
      onclose: null,
      onmessage: null,
      onerror: null,
      // Additional WebSocket properties
      binaryType: 'arraybuffer' as BinaryType,
      bufferedAmount: 0,
      extensions: '',
      protocol: '',
      url: '',
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    } as unknown as WebSocket
  }

  // ============================================================================
  // Database Operations
  // ============================================================================

  private async recordWebSocket(
    wsId: string,
    namespace: string,
    doId: string,
  ): Promise<void> {
    const now = Date.now()
    const doKey = `${namespace}:${doId}`

    await this.sqlit.exec(
      `INSERT INTO do_websockets (ws_id, do_id, tags, state, created_at, last_message)
       VALUES (?, ?, '[]', 'active', ?, ?)`,
      [wsId, doKey, now, now],
      this.databaseId,
    )
  }

  private async updateWebSocketTags(
    wsId: string,
    tags: string[],
  ): Promise<void> {
    await this.sqlit.exec(
      `UPDATE do_websockets SET tags = ? WHERE ws_id = ?`,
      [JSON.stringify(tags), wsId],
      this.databaseId,
    )
  }

  private async updateWebSocketLastMessage(wsId: string): Promise<void> {
    await this.sqlit.exec(
      `UPDATE do_websockets SET last_message = ? WHERE ws_id = ?`,
      [Date.now(), wsId],
      this.databaseId,
    )
  }

  private async removeWebSocket(wsId: string): Promise<void> {
    await this.sqlit.exec(
      `DELETE FROM do_websockets WHERE ws_id = ?`,
      [wsId],
      this.databaseId,
    )
  }
}

// ============================================================================
// Singleton
// ============================================================================

let wsManager: DOWebSocketManager | null = null

export function getDOWebSocketManager(): DOWebSocketManager {
  if (!wsManager) {
    const sqlit = getSQLit()
    const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'
    wsManager = new DOWebSocketManager(
      sqlit,
      databaseId,
      getLogLevel() === 'debug',
    )
  }
  return wsManager
}
