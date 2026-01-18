/**
 * @jejunetwork/durable-objects - Namespace and Stub Implementation
 */

import { DWSObjectId } from './id.js'
import type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectStub,
  GetDurableObjectOptions,
} from './types.js'

export interface DORouterConfig {
  dwsApiUrl: string
  requestTimeout?: number
}

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
    const req = input instanceof Request ? input : new Request(input, init)
    const url = new URL(req.url)
    const path = url.pathname + url.search

    const headers = new Headers(req.headers)
    headers.set('X-DO-Namespace', this.namespace)
    headers.set('X-DO-Id', this.id.toString())
    if (this.name) headers.set('X-DO-Name', this.name)

    return fetch(
      new Request(
        `${this.dwsApiUrl}/do/${this.namespace}/${this.id.toString()}${path}`,
        {
          method: req.method,
          headers,
          body: req.body,
          redirect: req.redirect,
          signal: AbortSignal.timeout(this.requestTimeout),
        },
      ),
    )
  }
}

/**
 * Synchronous namespace - IDs are deferred until actually needed.
 * Cloudflare's API is sync, but our crypto is async, hence deferred resolution.
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
    const resolved = id instanceof DWSObjectIdDeferred ? id.getResolved() : id
    if (resolved instanceof Promise) {
      throw new Error(
        'DurableObjectId not resolved. Use DWSObjectNamespaceAsync or await the ID first.',
      )
    }
    return new DWSObjectStub(resolved as DWSObjectId, this.name, this.config)
  }

  getByName(): DurableObjectStub {
    throw new Error(
      'getByName() requires async ID resolution. Use DWSObjectNamespaceAsync.getByName() instead.',
    )
  }
}

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
        case 'name':
          if (!this.source) throw new Error('source required for name-based ID')
          this.resolved = await DWSObjectId.fromName(
            this.namespace,
            this.source,
          )
          break
        case 'unique':
          this.resolved = await DWSObjectId.newUnique(this.namespace)
          break
        case 'string':
          if (!this.source)
            throw new Error('source required for string-based ID')
          this.resolved = await DWSObjectId.fromString(
            this.namespace,
            this.source,
          )
          break
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

export function createNamespace(
  name: string,
  config: DORouterConfig,
): DWSObjectNamespace {
  return new DWSObjectNamespace(name, config)
}

/** Async namespace - returns fully resolved IDs */
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
    return this.get(await this.idFromName(name), options)
  }
}

export function createAsyncNamespace(
  name: string,
  config: DORouterConfig,
): DWSObjectNamespaceAsync {
  return new DWSObjectNamespaceAsync(name, config)
}
