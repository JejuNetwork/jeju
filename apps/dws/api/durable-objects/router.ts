/**
 * Durable Objects Router
 *
 * Handles routing requests to Durable Object instances.
 *
 * Routes:
 * - POST /do/:namespace/:doId/* - Route request to DO instance
 * - GET  /do/:namespace/:doId/ws - WebSocket upgrade to DO
 * - GET  /do/stats - Get DO system statistics
 * - POST /do/schema/init - Initialize DO schema (admin only)
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

const log = pino({
  name: 'dws:durable-objects',
  level: getLogLevel(),
})

// ============================================================================
// DO Instance Manager
// ============================================================================

interface DOInstance {
  id: string
  namespace: string
  doIdString: string
  instance: DurableObject
  state: ReturnType<typeof createDurableObjectState>
  lastAccess: number
  createdAt: number
}

/**
 * Manages DO instances and routes requests to them.
 * Implements DOInstanceProvider for the alarm scheduler.
 */
class DurableObjectManager implements DOInstanceProvider {
  private instances = new Map<string, DOInstance>()
  private sqlit: SQLitClient
  private databaseId: string
  private debug: boolean
  private maxIdleMs = 5 * 60 * 1000 // 5 minutes before eviction
  private evictionInterval: ReturnType<typeof setInterval> | null = null

  // Registered DO classes by namespace
  private registeredClasses = new Map<string, DurableObjectConstructor>()

  constructor(sqlit: SQLitClient, databaseId: string, debug = false) {
    this.sqlit = sqlit
    this.databaseId = databaseId
    this.debug = debug
  }

  /**
   * Register a Durable Object class for a namespace
   */
  registerClass(namespace: string, doClass: DurableObjectConstructor): void {
    this.registeredClasses.set(namespace, doClass)
    log.info({ namespace }, 'Registered DO class')
  }

  /**
   * Check if an instance exists and is active
   * (Implements DOInstanceProvider)
   */
  hasInstance(key: string): boolean {
    return this.instances.has(key)
  }

  /**
   * Get or create a DO instance
   * (Implements DOInstanceProvider)
   */
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

    // Get the registered class
    const doClass = this.registeredClasses.get(namespace)
    if (!doClass) {
      throw new Error(
        `No Durable Object class registered for namespace: ${namespace}`,
      )
    }

    // Create the DO state
    const id = await DWSObjectId.fromString(namespace, doIdString)
    const state = createDurableObjectState(
      id,
      this.sqlit,
      this.databaseId,
      this.debug,
    )

    // Create the DO instance
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

    if (this.debug) {
      log.debug({ namespace, doIdString }, 'Created DO instance')
    }

    // Register location in SQLit
    await this.registerLocation(namespace, doIdString)

    return instance
  }

  /**
   * Route a fetch request to a DO instance
   */
  async routeRequest(
    namespace: string,
    doIdString: string,
    request: Request,
    env: Record<string, unknown> = {},
  ): Promise<Response> {
    const instance = await this.getOrCreateInstance(namespace, doIdString, env)

    // Wait for any blocking operations
    await instance.state.waitForUnblock()

    // Call the DO's fetch handler
    if (!instance.instance.fetch) {
      return new Response('Durable Object does not implement fetch()', {
        status: 501,
      })
    }

    return instance.instance.fetch(request)
  }

  /**
   * Register DO location in SQLit
   */
  private async registerLocation(
    namespace: string,
    doIdString: string,
  ): Promise<void> {
    const key = `${namespace}:${doIdString}`
    const now = Date.now()
    const podId = process.env.POD_ID ?? process.env.HOSTNAME ?? 'local'
    const port = parseInt(process.env.PORT ?? '4030', 10)

    await this.sqlit.exec(
      `INSERT INTO do_locations (key, pod_id, port, status, last_seen, created_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT (key) DO UPDATE SET pod_id = excluded.pod_id, port = excluded.port, status = 'active', last_seen = excluded.last_seen`,
      [key, podId, port, now, now],
      this.databaseId,
    )
  }

  /**
   * Update location heartbeat
   */
  async heartbeat(): Promise<void> {
    const now = Date.now()
    const podId = process.env.POD_ID ?? process.env.HOSTNAME ?? 'local'

    for (const instance of this.instances.values()) {
      const key = `${instance.namespace}:${instance.doIdString}`
      await this.sqlit.exec(
        `UPDATE do_locations SET last_seen = ? WHERE key = ? AND pod_id = ?`,
        [now, key, podId],
        this.databaseId,
      )
    }
  }

  /**
   * Evict idle instances
   */
  async evictIdleInstances(): Promise<number> {
    const now = Date.now()
    let evicted = 0

    for (const [key, instance] of this.instances.entries()) {
      if (now - instance.lastAccess > this.maxIdleMs) {
        await this.evictInstance(key)
        evicted++
      }
    }

    if (evicted > 0) {
      log.info({ evicted }, 'Evicted idle DO instances')
    }

    return evicted
  }

  /**
   * Evict a specific instance
   */
  async evictInstance(key: string): Promise<void> {
    const instance = this.instances.get(key)
    if (!instance) return

    // Close all WebSockets
    instance.state.closeAllWebSockets(1001, 'Durable Object evicted')

    // Drain waitUntil promises
    await instance.state.drainWaitUntil()

    // Mark as evicted in SQLit
    await this.sqlit.exec(
      `UPDATE do_locations SET status = 'evicted' WHERE key = ?`,
      [key],
      this.databaseId,
    )

    // Remove from local map
    this.instances.delete(key)

    if (this.debug) {
      log.debug({ key }, 'Evicted DO instance')
    }
  }

  /**
   * Start background tasks (heartbeat, eviction)
   */
  startBackgroundTasks(): void {
    // Heartbeat every 30 seconds
    setInterval(() => {
      this.heartbeat().catch((err) => {
        log.error({ error: err }, 'Heartbeat failed')
      })
    }, 30000)

    // Eviction check every minute
    this.evictionInterval = setInterval(() => {
      this.evictIdleInstances().catch((err) => {
        log.error({ error: err }, 'Eviction check failed')
      })
    }, 60000)
  }

  /**
   * Stop background tasks
   */
  stopBackgroundTasks(): void {
    if (this.evictionInterval) {
      clearInterval(this.evictionInterval)
      this.evictionInterval = null
    }
  }

  /**
   * Get instance count
   */
  getInstanceCount(): number {
    return this.instances.size
  }

  /**
   * Get all registered namespaces
   */
  getRegisteredNamespaces(): string[] {
    return Array.from(this.registeredClasses.keys())
  }
}

// ============================================================================
// Singleton Manager
// ============================================================================

let manager: DurableObjectManager | null = null
let schemaInitialized = false

async function getManager(): Promise<DurableObjectManager> {
  if (!manager) {
    const sqlit = getSQLit()
    const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'
    manager = new DurableObjectManager(
      sqlit,
      databaseId,
      getLogLevel() === 'debug',
    )
  }
  return manager
}

async function ensureSchemaInitialized(): Promise<void> {
  if (schemaInitialized) return

  const sqlit = getSQLit()
  const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'

  const initialized = await isDOSchemaInitialized(sqlit, databaseId)
  if (!initialized) {
    await initializeDOSchema(sqlit, databaseId)
  }
  schemaInitialized = true
}

// ============================================================================
// Router
// ============================================================================

export function createDurableObjectsRouter() {
  return (
    new Elysia({ prefix: '/do' })
      // -------------------------------------------------------------------------
      // Stats endpoint
      // -------------------------------------------------------------------------
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

      // -------------------------------------------------------------------------
      // Schema initialization (admin only)
      // -------------------------------------------------------------------------
      .post('/schema/init', async () => {
        const sqlit = getSQLit()
        const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'

        await initializeDOSchema(sqlit, databaseId)
        schemaInitialized = true

        return { success: true, message: 'DO schema initialized' }
      })

      // -------------------------------------------------------------------------
      // Cleanup stale data
      // -------------------------------------------------------------------------
      .post('/cleanup', async () => {
        await ensureSchemaInitialized()
        const sqlit = getSQLit()
        const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'

        const result = await cleanupStaleDOData(sqlit, databaseId)

        return { success: true, ...result }
      })

      // -------------------------------------------------------------------------
      // Route request to DO instance
      // -------------------------------------------------------------------------
      .all('/:namespace/:doId/*', async ({ params, request }) => {
        await ensureSchemaInitialized()
        const mgr = await getManager()

        const { namespace, doId } = params
        const path = request.url.split(`/do/${namespace}/${doId}`)[1] ?? '/'

        // Validate DO ID format
        const isValidId = await DWSObjectId.validateNamespace(namespace, doId)
        if (!isValidId) {
          return new Response(
            JSON.stringify({
              error: 'Invalid Durable Object ID for namespace',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Create a new request with the DO-relative path
        const doUrl = new URL(path, request.url)
        const doRequest = new Request(doUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
        })

        return mgr.routeRequest(namespace, doId, doRequest)
      })

      // -------------------------------------------------------------------------
      // Direct route for DO root (without trailing path)
      // -------------------------------------------------------------------------
      .all('/:namespace/:doId', async ({ params, request }) => {
        await ensureSchemaInitialized()
        const mgr = await getManager()

        const { namespace, doId } = params

        // Validate DO ID format
        const isValidId = await DWSObjectId.validateNamespace(namespace, doId)
        if (!isValidId) {
          return new Response(
            JSON.stringify({
              error: 'Invalid Durable Object ID for namespace',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Create a new request with root path
        const doUrl = new URL('/', request.url)
        const doRequest = new Request(doUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
        })

        return mgr.routeRequest(namespace, doId, doRequest)
      })
  )
}

// ============================================================================
// DO Registration API (for workers to register their DO classes)
// ============================================================================

/**
 * Register a Durable Object class for a namespace
 */
export async function registerDurableObjectClass(
  namespace: string,
  doClass: DurableObjectConstructor,
): Promise<void> {
  await ensureSchemaInitialized()
  const mgr = await getManager()
  mgr.registerClass(namespace, doClass)
}

/**
 * Start the DO manager background tasks
 */
export async function startDurableObjectManager(): Promise<void> {
  await ensureSchemaInitialized()
  const mgr = await getManager()
  mgr.startBackgroundTasks()

  // Connect manager to alarm scheduler as instance provider
  const alarmScheduler = getAlarmScheduler()
  alarmScheduler.setInstanceProvider(mgr)

  // Start alarm scheduler
  startAlarmScheduler()

  log.info('Durable Object manager started')
}

/**
 * Stop the DO manager background tasks
 */
export async function stopDurableObjectManager(): Promise<void> {
  if (manager) {
    manager.stopBackgroundTasks()
  }
  stopAlarmScheduler()
}
