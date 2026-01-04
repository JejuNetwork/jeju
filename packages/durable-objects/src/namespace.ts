/**
 * @jejunetwork/durable-objects - Namespace and Stub Implementation
 *
 * Provides the binding interface for workers to access Durable Objects.
 */

import { DWSObjectId } from './id.js'
import type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectStub,
  GetDurableObjectOptions,
} from './types.js'

/**
 * Configuration for the DO router
 */
export interface DORouterConfig {
  /** Base URL for the DWS API that handles DO routing */
  dwsApiUrl: string
  /** Timeout for requests to DOs (ms) */
  requestTimeout?: number
  /** Enable debug logging */
  debug?: boolean
}

/**
 * DWS implementation of DurableObjectStub
 *
 * Routes requests to the DO instance via the DWS API.
 */
export class DWSObjectStub implements DurableObjectStub {
  readonly id: DurableObjectId
  readonly name?: string

  private readonly namespace: string
  private readonly dwsApiUrl: string
  private readonly requestTimeout: number

  constructor(id: DWSObjectId, namespace: string, config: DORouterConfig) {
    this.id = id
    this.name = id.name
    this.namespace = namespace
    this.dwsApiUrl = config.dwsApiUrl
    this.requestTimeout = config.requestTimeout ?? 30000
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const originalRequest =
      input instanceof Request ? input : new Request(input, init)
    const originalUrl = new URL(originalRequest.url)
    const path = originalUrl.pathname + originalUrl.search

    // Route: {dwsApiUrl}/do/{namespace}/{doId}/{path}
    const doUrl = `${this.dwsApiUrl}/do/${this.namespace}/${this.id.toString()}${path}`

    const headers = new Headers(originalRequest.headers)
    headers.set('X-DO-Namespace', this.namespace)
    headers.set('X-DO-Id', this.id.toString())
    if (this.name) headers.set('X-DO-Name', this.name)

    return fetch(
      new Request(doUrl, {
        method: originalRequest.method,
        headers,
        body: originalRequest.body,
        redirect: originalRequest.redirect,
        signal: AbortSignal.timeout(this.requestTimeout),
      }),
    )
  }
}

/**
 * DWS implementation of DurableObjectNamespace
 *
 * Factory for creating DO IDs and stubs.
 * Note: Due to async ID generation, use DWSObjectNamespaceAsync for most cases.
 */
export class DWSObjectNamespace implements DurableObjectNamespace {
  private readonly name: string
  private readonly config: DORouterConfig

  constructor(name: string, config: DORouterConfig) {
    this.name = name
    this.config = config
  }

  idFromName(name: string): DurableObjectId {
    return new DWSObjectIdDeferred(this.name, name, 'name')
  }

  newUniqueId(): DurableObjectId {
    return new DWSObjectIdDeferred(this.name, undefined, 'unique')
  }

  idFromString(id: string): DurableObjectId {
    return new DWSObjectIdDeferred(this.name, id, 'string')
  }

  get(id: DurableObjectId): DurableObjectStub {
    const resolvedId = id instanceof DWSObjectIdDeferred ? id.getResolved() : id
    if (resolvedId instanceof Promise) {
      throw new Error(
        'DurableObjectId not resolved. Use DWSObjectNamespaceAsync or await the ID first.',
      )
    }
    return new DWSObjectStub(resolvedId as DWSObjectId, this.name, this.config)
  }

  getByName(): DurableObjectStub {
    throw new Error(
      'getByName() requires async ID resolution. Use DWSObjectNamespaceAsync.getByName() instead.',
    )
  }
}

/**
 * Deferred ID that lazily resolves async ID creation.
 * Cloudflare's API is synchronous, but our crypto operations are async.
 */
class DWSObjectIdDeferred implements DurableObjectId {
  private readonly namespace: string
  private readonly source?: string
  private readonly type: 'name' | 'unique' | 'string'
  private resolved: DWSObjectId | null = null
  private resolving: Promise<DWSObjectId> | null = null

  constructor(
    namespace: string,
    source: string | undefined,
    type: 'name' | 'unique' | 'string',
  ) {
    this.namespace = namespace
    this.source = source
    this.type = type
  }

  private async resolve(): Promise<DWSObjectId> {
    if (this.resolved) return this.resolved
    if (this.resolving) return this.resolving

    this.resolving = (async () => {
      switch (this.type) {
        case 'name': {
          if (!this.source) throw new Error('source required for name-based ID')
          this.resolved = await DWSObjectId.fromName(
            this.namespace,
            this.source,
          )
          break
        }
        case 'unique':
          this.resolved = await DWSObjectId.newUnique(this.namespace)
          break
        case 'string': {
          if (!this.source)
            throw new Error('source required for string-based ID')
          this.resolved = await DWSObjectId.fromString(
            this.namespace,
            this.source,
          )
          break
        }
      }
      return this.resolved
    })()

    return this.resolving
  }

  getResolved(): DWSObjectId | Promise<DWSObjectId> {
    return this.resolved ?? this.resolve()
  }

  toString(): string {
    if (!this.resolved)
      throw new Error('DurableObjectId not resolved. Await the ID first.')
    return this.resolved.toString()
  }

  equals(other: DurableObjectId): boolean {
    if (!this.resolved)
      throw new Error('DurableObjectId not resolved. Await the ID first.')
    return this.resolved.equals(other)
  }

  get name(): string | undefined {
    return this.type === 'name' ? this.source : this.resolved?.name
  }
}

/**
 * Async version of the namespace that returns resolved IDs
 *
 * Use this when you need fully resolved IDs before using them.
 */
export class DWSObjectNamespaceAsync {
  private readonly name: string
  private readonly config: DORouterConfig

  constructor(name: string, config: DORouterConfig) {
    this.name = name
    this.config = config
  }

  async idFromName(name: string): Promise<DWSObjectId> {
    return DWSObjectId.fromName(this.name, name)
  }

  async newUniqueId(): Promise<DWSObjectId> {
    return DWSObjectId.newUnique(this.name)
  }

  async idFromString(id: string): Promise<DWSObjectId> {
    return DWSObjectId.fromString(this.name, id)
  }

  get(id: DWSObjectId, _options?: GetDurableObjectOptions): DWSObjectStub {
    return new DWSObjectStub(id, this.name, this.config)
  }

  async getByName(
    name: string,
    options?: GetDurableObjectOptions,
  ): Promise<DWSObjectStub> {
    const id = await this.idFromName(name)
    return this.get(id, options)
  }
}

/**
 * Create a DurableObjectNamespace binding for a worker
 */
export function createNamespace(
  name: string,
  config: DORouterConfig,
): DurableObjectNamespace {
  return new DWSObjectNamespace(name, config)
}

/**
 * Create an async DurableObjectNamespace for use in workers that can await
 */
export function createAsyncNamespace(
  name: string,
  config: DORouterConfig,
): DWSObjectNamespaceAsync {
  return new DWSObjectNamespaceAsync(name, config)
}
