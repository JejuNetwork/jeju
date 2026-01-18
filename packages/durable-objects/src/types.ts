/**
 * @jejunetwork/durable-objects - Type Definitions
 *
 * Cloudflare-compatible Durable Objects API for DWS.
 */

export interface GetOptions {
  allowConcurrency?: boolean
  noCache?: boolean
}

export interface PutOptions {
  allowConcurrency?: boolean
  allowUnconfirmed?: boolean
  noCache?: boolean
}

export interface ListOptions {
  start?: string
  prefix?: string
  end?: string
  limit?: number
  reverse?: boolean
  allowConcurrency?: boolean
  noCache?: boolean
}

export interface DeleteOptions {
  allowConcurrency?: boolean
}

export interface GetAlarmOptions {
  allowConcurrency?: boolean
}

export interface SetAlarmOptions {
  allowConcurrency?: boolean
  allowUnconfirmed?: boolean
}

/**
 * Durable Object Storage - persistent KV per DO instance
 *
 * Key: max 2048 bytes, Value: max 128KB after JSON serialization
 */
export interface DurableObjectStorage {
  get<T = unknown>(key: string, options?: GetOptions): Promise<T | undefined>
  get<T = unknown>(
    keys: string[],
    options?: GetOptions,
  ): Promise<Map<string, T>>
  put<T = unknown>(key: string, value: T, options?: PutOptions): Promise<void>
  put<T = unknown>(
    entries: Record<string, T>,
    options?: PutOptions,
  ): Promise<void>
  delete(key: string, options?: DeleteOptions): Promise<boolean>
  delete(keys: string[], options?: DeleteOptions): Promise<number>
  deleteAll(options?: DeleteOptions): Promise<void>
  list<T = unknown>(options?: ListOptions): Promise<Map<string, T>>
  transaction<T>(closure: () => T | Promise<T>): Promise<T>
  sync(): Promise<void>
  getAlarm(options?: GetAlarmOptions): Promise<number | null>
  setAlarm(
    scheduledTime: Date | number,
    options?: SetAlarmOptions,
  ): Promise<void>
  deleteAlarm(options?: DeleteOptions): Promise<void>
}

/** Unique identifier for a Durable Object instance */
export interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  readonly name?: string
}

/** Handle to send requests to a specific DO instance */
export interface DurableObjectStub {
  readonly id: DurableObjectId
  readonly name?: string
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface GetDurableObjectOptions {
  locationHint?: string
}

/** Binding to a Durable Object namespace (one per DO class) */
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  newUniqueId(): DurableObjectId
  idFromString(id: string): DurableObjectId
  get(id: DurableObjectId, options?: GetDurableObjectOptions): DurableObjectStub
  getByName(name: string, options?: GetDurableObjectOptions): DurableObjectStub
}

/** Runtime state for a DO instance */
export interface DurableObjectState {
  readonly id: DurableObjectId
  readonly storage: DurableObjectStorage
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
  waitUntil(promise: Promise<unknown>): void
  acceptWebSocket(ws: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
  setHibernatableWebSocketEventTimeout(timeoutMs?: number): void
}

/** Interface for DO class implementations */
export interface DurableObject {
  fetch?(request: Request): Response | Promise<Response>
  alarm?(): void | Promise<void>
  webSocketMessage?(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): void | Promise<void>
  webSocketClose?(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void | Promise<void>
  webSocketError?(ws: WebSocket, error: Error): void | Promise<void>
}

export type DurableObjectConstructor = new (
  state: DurableObjectState,
  env: Record<string, unknown>,
) => DurableObject

/** Location registry entry for a DO instance */
export interface DOLocationEntry {
  key: string
  podId: string
  port: number
  status: 'active' | 'hibernating' | 'evicted'
  lastSeen: number
  createdAt: number
}

/** Alarm registry entry */
export interface DOAlarmEntry {
  doId: string
  scheduledTime: number
  createdAt: number
}

/** Configuration for DO storage backend */
export interface DOStorageConfig {
  databaseId: string
  endpoint: string
  debug?: boolean
}
