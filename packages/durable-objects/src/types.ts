/**
 * @jejunetwork/durable-objects - Type Definitions
 *
 * Implements Cloudflare Durable Objects API for DWS.
 * Storage is backed by SQLit distributed database.
 */

// ============================================================================
// Storage Options and Results
// ============================================================================

/** Options for storage get operations */
export interface GetOptions {
  /** Allow reads concurrent with other operations (default: false) */
  allowConcurrency?: boolean
  /** Don't update LRU cache order */
  noCache?: boolean
}

/** Options for storage put operations */
export interface PutOptions {
  /** Allow writes concurrent with other operations (default: false) */
  allowConcurrency?: boolean
  /** Allow unconfirmed writes (default: false) */
  allowUnconfirmed?: boolean
  /** Don't cache the written value */
  noCache?: boolean
}

/** Options for storage list operations */
export interface ListOptions {
  /** Key to start listing from (exclusive) */
  start?: string
  /** Prefix to filter keys */
  prefix?: string
  /** Key to end listing at (exclusive) */
  end?: string
  /** Maximum number of keys to return (default: 1000, max: 1000) */
  limit?: number
  /** Whether to list in reverse order */
  reverse?: boolean
  /** Allow concurrent reads */
  allowConcurrency?: boolean
  /** Don't update cache order */
  noCache?: boolean
}

/** Options for storage delete operations */
export interface DeleteOptions {
  /** Allow concurrent deletes */
  allowConcurrency?: boolean
}

/** Options for alarm operations */
export interface GetAlarmOptions {
  /** Allow concurrent reads */
  allowConcurrency?: boolean
}

/** Options for setting alarms */
export interface SetAlarmOptions {
  /** Allow concurrent alarm modification */
  allowConcurrency?: boolean
  /** Allow unconfirmed alarm setting */
  allowUnconfirmed?: boolean
}

// ============================================================================
// Storage Interface
// ============================================================================

/**
 * Durable Object Storage API
 *
 * Provides persistent key-value storage for a single Durable Object instance.
 * All data is persisted to SQLit distributed database.
 *
 * Key constraints:
 * - Maximum key size: 2048 bytes (UTF-8 encoded)
 * - Maximum value size: 131072 bytes (128KB, after JSON serialization)
 *
 * @example
 * ```typescript
 * // Single key operations
 * await storage.put('counter', 42)
 * const value = await storage.get<number>('counter')
 *
 * // Multi-key operations
 * await storage.put({ 'key1': 'value1', 'key2': 'value2' })
 * const map = await storage.get(['key1', 'key2'])
 *
 * // Transactions
 * await storage.transaction(async () => {
 *   const count = await storage.get<number>('count') ?? 0
 *   await storage.put('count', count + 1)
 * })
 * ```
 */
export interface DurableObjectStorage {
  /**
   * Get a single value by key
   * @returns The value, or undefined if not found
   */
  get<T = unknown>(key: string, options?: GetOptions): Promise<T | undefined>

  /**
   * Get multiple values by keys
   * @returns A Map of key to value for all found keys
   */
  get<T = unknown>(
    keys: string[],
    options?: GetOptions,
  ): Promise<Map<string, T>>

  /**
   * Store a single key-value pair
   */
  put<T = unknown>(key: string, value: T, options?: PutOptions): Promise<void>

  /**
   * Store multiple key-value pairs atomically
   */
  put<T = unknown>(
    entries: Record<string, T>,
    options?: PutOptions,
  ): Promise<void>

  /**
   * Delete a single key
   * @returns true if the key existed and was deleted
   */
  delete(key: string, options?: DeleteOptions): Promise<boolean>

  /**
   * Delete multiple keys
   * @returns The number of keys that were deleted
   */
  delete(keys: string[], options?: DeleteOptions): Promise<number>

  /**
   * Delete all keys in this Durable Object's storage
   */
  deleteAll(options?: DeleteOptions): Promise<void>

  /**
   * List keys in storage
   * @returns A Map of key to value for matching keys
   */
  list<T = unknown>(options?: ListOptions): Promise<Map<string, T>>

  /**
   * Execute operations atomically in a transaction
   *
   * All storage operations within the closure are executed atomically.
   * If any operation fails, or the closure throws, all changes are rolled back.
   *
   * @param closure Function containing storage operations
   * @returns The return value of the closure
   */
  transaction<T>(closure: () => T | Promise<T>): Promise<T>

  /**
   * Wait for all writes to be confirmed persisted
   *
   * Normally, writes are confirmed asynchronously. Call this to ensure
   * all pending writes have been durably stored before continuing.
   */
  sync(): Promise<void>

  /**
   * Get the currently scheduled alarm time
   * @returns The scheduled time in milliseconds since epoch, or null if no alarm
   */
  getAlarm(options?: GetAlarmOptions): Promise<number | null>

  /**
   * Schedule an alarm to fire at the specified time
   *
   * When the alarm fires, the DO's `alarm()` handler will be called.
   * Only one alarm can be scheduled at a time; setting a new alarm
   * cancels any existing alarm.
   *
   * @param scheduledTime Time to fire (Date or ms since epoch)
   */
  setAlarm(
    scheduledTime: Date | number,
    options?: SetAlarmOptions,
  ): Promise<void>

  /**
   * Cancel any scheduled alarm
   */
  deleteAlarm(options?: DeleteOptions): Promise<void>
}

// ============================================================================
// ID Interface
// ============================================================================

/**
 * Unique identifier for a Durable Object instance
 *
 * IDs can be created in two ways:
 * - From a name: `namespace.idFromName('my-room')` - deterministic, stable
 * - Unique: `namespace.newUniqueId()` - random, globally unique
 */
export interface DurableObjectId {
  /**
   * Get the string representation of this ID
   * Can be used to reconstruct the ID via `namespace.idFromString()`
   */
  toString(): string

  /**
   * Check if this ID equals another
   */
  equals(other: DurableObjectId): boolean

  /**
   * The name this ID was created from, if created via `idFromName()`
   * Undefined for IDs created via `newUniqueId()`
   */
  readonly name?: string
}

// ============================================================================
// Stub Interface
// ============================================================================

/**
 * A handle to a specific Durable Object instance
 *
 * The stub is used to send requests to the DO. The DO may be running
 * on any pod in the cluster; the stub handles routing automatically.
 *
 * @example
 * ```typescript
 * const id = namespace.idFromName('room-123')
 * const stub = namespace.get(id)
 *
 * // Send HTTP request to the DO
 * const response = await stub.fetch('http://do/messages', {
 *   method: 'POST',
 *   body: JSON.stringify({ text: 'Hello!' })
 * })
 * ```
 */
export interface DurableObjectStub {
  /** The ID of the Durable Object this stub refers to */
  readonly id: DurableObjectId

  /** The name of the DO, if created from a name */
  readonly name?: string

  /**
   * Send an HTTP request to the Durable Object
   *
   * The request is routed to the pod hosting this DO instance.
   * If the DO is not currently running, it will be started.
   *
   * @param input Request URL or Request object
   * @param init Optional fetch init options
   * @returns The response from the DO's fetch() handler
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

/**
 * Options for getting a Durable Object stub
 */
export interface GetDurableObjectOptions {
  /**
   * Location hint for DO placement (ignored in DWS - for CF compatibility)
   */
  locationHint?: string
}

// ============================================================================
// Namespace Interface
// ============================================================================

/**
 * A binding to a Durable Object namespace
 *
 * A namespace corresponds to a single DO class. Use it to create IDs
 * and get stubs for DO instances.
 *
 * @example
 * ```typescript
 * // In worker env
 * interface Env {
 *   ROOMS: DurableObjectNamespace
 * }
 *
 * export default {
 *   async fetch(request: Request, env: Env): Promise<Response> {
 *     const id = env.ROOMS.idFromName('lobby')
 *     const stub = env.ROOMS.get(id)
 *     return stub.fetch(request)
 *   }
 * }
 * ```
 */
export interface DurableObjectNamespace {
  /**
   * Create a Durable Object ID from a name
   *
   * The same name always produces the same ID, making this useful
   * for scenarios where you need predictable ID assignment.
   *
   * @param name Any string to derive the ID from
   */
  idFromName(name: string): DurableObjectId

  /**
   * Create a new unique Durable Object ID
   *
   * Each call produces a different ID. Use this when you don't need
   * to derive IDs from existing identifiers.
   */
  newUniqueId(): DurableObjectId

  /**
   * Reconstruct a Durable Object ID from its string representation
   *
   * @param id String from `DurableObjectId.toString()`
   * @throws If the string is not a valid ID for this namespace
   */
  idFromString(id: string): DurableObjectId

  /**
   * Get a stub to interact with a Durable Object
   *
   * @param id The DO's ID
   * @param options Optional configuration
   */
  get(id: DurableObjectId, options?: GetDurableObjectOptions): DurableObjectStub

  /**
   * Convenience method to get a stub by name
   *
   * Equivalent to `namespace.get(namespace.idFromName(name))`
   */
  getByName(name: string, options?: GetDurableObjectOptions): DurableObjectStub
}

// ============================================================================
// State Interface
// ============================================================================

/**
 * Runtime state for a Durable Object instance
 *
 * Passed to the DO constructor and provides access to storage,
 * WebSocket management, and lifecycle utilities.
 */
export interface DurableObjectState {
  /** The ID of this Durable Object */
  readonly id: DurableObjectId

  /** Persistent storage for this DO */
  readonly storage: DurableObjectStorage

  /**
   * Execute a function while blocking concurrent requests
   *
   * Use in the constructor to perform async initialization before
   * the DO starts handling requests.
   *
   * @example
   * ```typescript
   * constructor(state: DurableObjectState) {
   *   state.blockConcurrencyWhile(async () => {
   *     this.data = await state.storage.get('data')
   *   })
   * }
   * ```
   */
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>

  /**
   * Register a promise to keep the DO alive until it completes
   *
   * Similar to FetchEvent.waitUntil() - allows background work
   * to continue after returning a response.
   */
  waitUntil(promise: Promise<unknown>): void

  /**
   * Accept a WebSocket connection for this Durable Object
   *
   * The WebSocket will be managed by the DO's hibernation manager.
   * When messages arrive, `webSocketMessage()` will be called.
   * When the connection closes, `webSocketClose()` will be called.
   *
   * @param ws The WebSocket to accept (from WebSocketPair[1])
   * @param tags Optional tags to categorize this WebSocket
   */
  acceptWebSocket(ws: WebSocket, tags?: string[]): void

  /**
   * Get all WebSockets accepted by this DO, optionally filtered by tag
   *
   * @param tag If provided, only return WebSockets with this tag
   */
  getWebSockets(tag?: string): WebSocket[]

  /**
   * Set the maximum time for WebSocket event handlers
   *
   * If a handler takes longer than this timeout, it will be cancelled.
   *
   * @param timeoutMs Timeout in milliseconds, or undefined to remove limit
   */
  setHibernatableWebSocketEventTimeout(timeoutMs?: number): void
}

// ============================================================================
// Durable Object Class Interface
// ============================================================================

/**
 * Interface for Durable Object class implementations
 *
 * Implement this interface and export the class from your worker.
 *
 * @example
 * ```typescript
 * export class ChatRoom implements DurableObject {
 *   constructor(private state: DurableObjectState) {
 *     this.state.blockConcurrencyWhile(async () => {
 *       this.messages = await state.storage.get<string[]>('messages') ?? []
 *     })
 *   }
 *
 *   async fetch(request: Request): Promise<Response> {
 *     if (request.headers.get('Upgrade') === 'websocket') {
 *       const pair = new WebSocketPair()
 *       this.state.acceptWebSocket(pair[1])
 *       return new Response(null, { status: 101, webSocket: pair[0] })
 *     }
 *     return new Response('Use WebSocket')
 *   }
 *
 *   webSocketMessage(ws: WebSocket, message: string) {
 *     this.broadcast(message)
 *   }
 * }
 * ```
 */
export interface DurableObject {
  /**
   * Handle HTTP requests to this Durable Object
   *
   * Called for each request routed to this DO instance.
   */
  fetch?(request: Request): Response | Promise<Response>

  /**
   * Handle scheduled alarms
   *
   * Called when a previously-scheduled alarm fires.
   * Use `state.storage.setAlarm()` to schedule alarms.
   */
  alarm?(): void | Promise<void>

  /**
   * Handle incoming WebSocket messages
   *
   * Called for each message received on WebSockets accepted via
   * `state.acceptWebSocket()`.
   *
   * @param ws The WebSocket that received the message
   * @param message The message content (string or ArrayBuffer)
   */
  webSocketMessage?(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): void | Promise<void>

  /**
   * Handle WebSocket close events
   *
   * Called when an accepted WebSocket connection closes.
   *
   * @param ws The WebSocket that closed
   * @param code The close code
   * @param reason The close reason
   * @param wasClean Whether the connection closed cleanly
   */
  webSocketClose?(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void | Promise<void>

  /**
   * Handle WebSocket errors
   *
   * Called when an error occurs on an accepted WebSocket.
   *
   * @param ws The WebSocket that errored
   * @param error The error that occurred
   */
  webSocketError?(ws: WebSocket, error: Error): void | Promise<void>
}

/**
 * Constructor signature for Durable Object classes
 */
export type DurableObjectConstructor = new (
  state: DurableObjectState,
  env: Record<string, unknown>,
) => DurableObject

// ============================================================================
// Internal Types (used by DWS implementation)
// ============================================================================

/** Location registry entry for a DO instance */
export interface DOLocationEntry {
  /** Composite key: namespace:doId */
  key: string
  /** Pod ID hosting this DO */
  podId: string
  /** Worker process port on that pod */
  port: number
  /** Current status */
  status: 'active' | 'hibernating' | 'evicted'
  /** Last heartbeat timestamp (ms since epoch) */
  lastSeen: number
  /** Creation timestamp */
  createdAt: number
}

/** WebSocket connection registry entry */
export interface DOWebSocketEntry {
  /** Unique WebSocket ID */
  wsId: string
  /** DO instance this WS belongs to */
  doId: string
  /** Tags assigned to this WebSocket */
  tags: string[]
  /** Current state */
  state: 'active' | 'hibernating' | 'closing'
  /** Serialized attachment data */
  attachment?: string
  /** When the WS was accepted */
  createdAt: number
  /** Last message timestamp */
  lastMessage: number
}

/** Alarm registry entry */
export interface DOAlarmEntry {
  /** DO instance ID */
  doId: string
  /** Scheduled time (ms since epoch) */
  scheduledTime: number
  /** When the alarm was set */
  createdAt: number
}

/** Configuration for DO storage backend */
export interface DOStorageConfig {
  /** SQLit database ID to store DO state in */
  databaseId: string
  /** SQLit endpoint */
  endpoint: string
  /** Enable debug logging */
  debug?: boolean
}
