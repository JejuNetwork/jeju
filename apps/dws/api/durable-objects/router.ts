/**
 * Durable Objects Router - routes requests to DO instances
 */

import { getLogLevel, getSQLitDatabaseId } from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import {
  cleanupStaleDOData,
  createDurableObjectState,
  type DurableObject,
  type DurableObjectConstructor,
  DWSObjectId,
  getDOStats,
  initializeDOSchema,
  isDOSchemaInitialized,
} from '@jejunetwork/durable-objects'
import { Elysia } from 'elysia'
import pino from 'pino'
import {
  type DOInstanceProvider,
  getAlarmScheduler,
  startAlarmScheduler,
  stopAlarmScheduler,
} from './alarm-scheduler.js'

const log = pino({ name: 'dws:durable-objects', level: getLogLevel() })

// Metrics collection
const metrics = {
  instancesCreated: 0,
  instancesEvicted: 0,
  requestsTotal: 0,
  requestsSuccess: 0,
  requestsError: 0,
  alarmsProcessed: 0,
  websocketsAccepted: 0,
  websocketsClosed: 0,
  requestLatencyMs: [] as number[],
}

export function getDOMetrics() {
  const latencies = metrics.requestLatencyMs.slice(-100)
  const sorted = [...latencies].sort((a, b) => a - b) // Copy before sort
  const p99Index = Math.max(0, Math.ceil(sorted.length * 0.99) - 1) // Proper p99 index
  return {
    instancesCreated: metrics.instancesCreated,
    instancesEvicted: metrics.instancesEvicted,
    requestsTotal: metrics.requestsTotal,
    requestsSuccess: metrics.requestsSuccess,
    requestsError: metrics.requestsError,
    alarmsProcessed: metrics.alarmsProcessed,
    websocketsAccepted: metrics.websocketsAccepted,
    websocketsClosed: metrics.websocketsClosed,
    avgLatencyMs:
      sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
    p99LatencyMs: sorted.length > 0 ? sorted[p99Index] : 0,
    sampleCount: sorted.length,
  }
}

interface DOInstance {
  id: string
  namespace: string
  doIdString: string
  instance: DurableObject
  state: ReturnType<typeof createDurableObjectState>
  lastAccess: number
  createdAt: number
}

class DurableObjectManager implements DOInstanceProvider {
  private instances = new Map<string, DOInstance>()
  private sqlit: SQLitClient
  private databaseId: string
  private debug: boolean
  private maxIdleMs = 5 * 60 * 1000
  private evictionInterval: ReturnType<typeof setInterval> | null = null
  private registeredClasses = new Map<string, DurableObjectConstructor>()

  constructor(sqlit: SQLitClient, databaseId: string, debug = false) {
    this.sqlit = sqlit
    this.databaseId = databaseId
    this.debug = debug
  }

  registerClass(namespace: string, doClass: DurableObjectConstructor): void {
    this.registeredClasses.set(namespace, doClass)
    log.info({ namespace }, 'Registered DO class')
  }

  hasInstance(key: string): boolean {
    return this.instances.has(key)
  }

  async getOrCreateInstance(
    namespace: string,
    doIdString: string,
    env: Record<string, unknown> = {},
  ): Promise<DOInstance> {
    const key = `${namespace}:${doIdString}`
    let instance = this.instances.get(key)

    if (instance) {
      instance.lastAccess = Date.now()
      return instance
    }

    const doClass = this.registeredClasses.get(namespace)
    if (!doClass)
      throw new Error(
        `No Durable Object class registered for namespace: ${namespace}`,
      )

    const id = await DWSObjectId.fromString(namespace, doIdString)
    const state = createDurableObjectState(
      id,
      this.sqlit,
      this.databaseId,
      this.debug,
    )
    const doInstance = new doClass(state, env)

    instance = {
      id: key,
      namespace,
      doIdString,
      instance: doInstance,
      state,
      lastAccess: Date.now(),
      createdAt: Date.now(),
    }

    this.instances.set(key, instance)
    metrics.instancesCreated++
    if (this.debug) log.debug({ namespace, doIdString }, 'Created DO instance')

    await this.registerLocation(namespace, doIdString)
    return instance
  }

  async routeRequest(
    namespace: string,
    doIdString: string,
    request: Request,
    env: Record<string, unknown> = {},
  ): Promise<Response> {
    const start = Date.now()
    metrics.requestsTotal++

    const instance = await this.getOrCreateInstance(namespace, doIdString, env)
    await instance.state.waitForUnblock()

    if (!instance.instance.fetch) {
      metrics.requestsError++
      return new Response('Durable Object does not implement fetch()', {
        status: 501,
      })
    }

    const response = await instance.instance.fetch(request)
    const latency = Date.now() - start
    metrics.requestLatencyMs.push(latency)
    if (metrics.requestLatencyMs.length > 1000) metrics.requestLatencyMs.shift()

    if (response.ok) {
      metrics.requestsSuccess++
    } else {
      metrics.requestsError++
    }
    return response
  }

  private async registerLocation(
    namespace: string,
    doIdString: string,
  ): Promise<void> {
    const key = `${namespace}:${doIdString}`
    const now = Date.now()
    const podId = process.env.POD_ID ?? process.env.HOSTNAME ?? 'local'
    const port = parseInt(process.env.PORT ?? '4030', 10)

    await this.sqlit.exec(
      `INSERT INTO do_locations (key, pod_id, port, status, last_seen, created_at) VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT (key) DO UPDATE SET pod_id = excluded.pod_id, port = excluded.port, status = 'active', last_seen = excluded.last_seen`,
      [key, podId, port, now, now],
      this.databaseId,
    )
  }

  async heartbeat(): Promise<void> {
    const now = Date.now()
    const podId = process.env.POD_ID ?? process.env.HOSTNAME ?? 'local'

    for (const instance of this.instances.values()) {
      await this.sqlit.exec(
        `UPDATE do_locations SET last_seen = ? WHERE key = ? AND pod_id = ?`,
        [now, `${instance.namespace}:${instance.doIdString}`, podId],
        this.databaseId,
      )
    }
  }

  async evictIdleInstances(): Promise<number> {
    const now = Date.now()
    let evicted = 0

    for (const [key, instance] of this.instances.entries()) {
      if (now - instance.lastAccess > this.maxIdleMs) {
        await this.evictInstance(key)
        evicted++
      }
    }

    if (evicted > 0) log.info({ evicted }, 'Evicted idle DO instances')
    return evicted
  }

  async evictInstance(key: string): Promise<void> {
    const instance = this.instances.get(key)
    if (!instance) return

    metrics.websocketsClosed += instance.state.getWebSocketCount()
    instance.state.closeAllWebSockets(1001, 'Durable Object evicted')
    await instance.state.drainWaitUntil()

    await this.sqlit.exec(
      `UPDATE do_locations SET status = 'evicted' WHERE key = ?`,
      [key],
      this.databaseId,
    )
    this.instances.delete(key)
    metrics.instancesEvicted++
    if (this.debug) log.debug({ key }, 'Evicted DO instance')
  }

  startBackgroundTasks(): void {
    setInterval(
      () =>
        this.heartbeat().catch((err) =>
          log.error({ error: err }, 'Heartbeat failed'),
        ),
      30000,
    )
    this.evictionInterval = setInterval(
      () =>
        this.evictIdleInstances().catch((err) =>
          log.error({ error: err }, 'Eviction failed'),
        ),
      60000,
    )
  }

  stopBackgroundTasks(): void {
    if (this.evictionInterval) {
      clearInterval(this.evictionInterval)
      this.evictionInterval = null
    }
  }

  getInstanceCount(): number {
    return this.instances.size
  }
  getRegisteredNamespaces(): string[] {
    return Array.from(this.registeredClasses.keys())
  }
}

let manager: DurableObjectManager | null = null
let schemaInitialized = false

async function getManager(): Promise<DurableObjectManager> {
  if (!manager) {
    manager = new DurableObjectManager(
      getSQLit(),
      getSQLitDatabaseId() ?? 'dws-durable-objects',
      getLogLevel() === 'debug',
    )
  }
  return manager
}

async function ensureSchemaInitialized(): Promise<void> {
  if (schemaInitialized) return
  const sqlit = getSQLit()
  const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'
  if (!(await isDOSchemaInitialized(sqlit, databaseId))) {
    await initializeDOSchema(sqlit, databaseId)
  }
  schemaInitialized = true
}

async function handleDORequest(
  params: { namespace: string; doId: string },
  request: Request,
  path: string,
): Promise<Response> {
  await ensureSchemaInitialized()
  const mgr = await getManager()

  const isValidId = await DWSObjectId.validateNamespace(
    params.namespace,
    params.doId,
  )
  if (!isValidId) {
    return new Response(
      JSON.stringify({ error: 'Invalid Durable Object ID for namespace' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  const doUrl = new URL(path, request.url)
  const doRequest = new Request(doUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  })

  return mgr.routeRequest(params.namespace, params.doId, doRequest)
}

export function createDurableObjectsRouter() {
  return new Elysia({ prefix: '/do' })
    .get('/health', async () => {
      const start = Date.now()
      const sqlit = getSQLit()
      const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'

      // Check SQLit connectivity
      let sqlitHealthy = false
      let sqlitLatencyMs = 0
      try {
        const sqlitStart = Date.now()
        await sqlit.query('SELECT 1', undefined, databaseId)
        sqlitLatencyMs = Date.now() - sqlitStart
        sqlitHealthy = true
      } catch {
        sqlitHealthy = false
      }

      // Check schema
      let schemaReady = false
      try {
        schemaReady = await isDOSchemaInitialized(sqlit, databaseId)
      } catch {
        schemaReady = false
      }

      const mgr = manager
      const healthy = sqlitHealthy && schemaReady

      return {
        status: healthy ? 'healthy' : 'unhealthy',
        checks: {
          sqlit: { healthy: sqlitHealthy, latencyMs: sqlitLatencyMs },
          schema: { initialized: schemaReady },
          manager: {
            initialized: !!mgr,
            instanceCount: mgr?.getInstanceCount() ?? 0,
            namespaces: mgr?.getRegisteredNamespaces() ?? [],
          },
        },
        uptimeMs: Date.now() - start,
      }
    })
    .get('/metrics', () => getDOMetrics())
    .get('/stats', async () => {
      await ensureSchemaInitialized()
      const sqlit = getSQLit()
      const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'
      const stats = await getDOStats(sqlit, databaseId)
      const mgr = await getManager()
      return {
        ...stats,
        localInstances: mgr.getInstanceCount(),
        registeredNamespaces: mgr.getRegisteredNamespaces(),
      }
    })
    .post('/schema/init', async () => {
      await initializeDOSchema(
        getSQLit(),
        getSQLitDatabaseId() ?? 'dws-durable-objects',
      )
      schemaInitialized = true
      return { success: true, message: 'DO schema initialized' }
    })
    .post('/cleanup', async () => {
      await ensureSchemaInitialized()
      const result = await cleanupStaleDOData(
        getSQLit(),
        getSQLitDatabaseId() ?? 'dws-durable-objects',
      )
      return { success: true, ...result }
    })
    .all('/:namespace/:doId/*', async ({ params, request }) => {
      const path =
        request.url.split(`/do/${params.namespace}/${params.doId}`)[1] ?? '/'
      return handleDORequest(params, request, path)
    })
    .all('/:namespace/:doId', async ({ params, request }) => {
      return handleDORequest(params, request, '/')
    })
}

export async function registerDurableObjectClass(
  namespace: string,
  doClass: DurableObjectConstructor,
): Promise<void> {
  await ensureSchemaInitialized()
  const mgr = await getManager()
  mgr.registerClass(namespace, doClass)
}

export async function startDurableObjectManager(): Promise<void> {
  await ensureSchemaInitialized()
  const mgr = await getManager()
  mgr.startBackgroundTasks()

  const alarmScheduler = getAlarmScheduler()
  alarmScheduler.setInstanceProvider(mgr)
  startAlarmScheduler()

  log.info('Durable Object manager started')
}

export async function stopDurableObjectManager(): Promise<void> {
  if (manager) manager.stopBackgroundTasks()
  stopAlarmScheduler()
}
