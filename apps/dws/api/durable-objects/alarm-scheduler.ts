/**
 * Durable Objects Alarm Scheduler
 *
 * Polls the do_alarms table and fires alarms when due.
 * Each pod runs its own scheduler but only fires alarms for DOs it hosts.
 *
 * IMPORTANT: Uses the shared DurableObjectManager for instance management
 * to avoid creating duplicate/disconnected DO instances.
 */

import { getLogLevel, getSQLitDatabaseId } from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import type { DurableObject } from '@jejunetwork/durable-objects'
import pino from 'pino'

const log = pino({
  name: 'dws:alarm-scheduler',
  level: getLogLevel(),
})

interface AlarmEntry {
  do_id: string
  scheduled_time: number
  created_at: number
}

interface LocationEntry {
  key: string
  pod_id: string
  port: number
  status: string
}

/**
 * Interface for the DO instance provider (implemented by DurableObjectManager)
 */
export interface DOInstanceProvider {
  /**
   * Get an existing instance if active, or create one if needed
   */
  getOrCreateInstance(
    namespace: string,
    doIdString: string,
    env?: Record<string, unknown>,
  ): Promise<{ instance: DurableObject }>

  /**
   * Check if an instance exists and is active
   */
  hasInstance(key: string): boolean
}

/**
 * Alarm Scheduler Service
 *
 * Polls for due alarms and dispatches them to the appropriate DO instances.
 * Uses the shared instance provider to avoid creating duplicate instances.
 */
export class AlarmScheduler {
  private sqlit: SQLitClient
  private databaseId: string
  private podId: string
  private debug: boolean

  private running = false
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private pollIntervalMs = 1000 // Check every second

  // Instance provider (shared with DurableObjectManager)
  private instanceProvider: DOInstanceProvider | null = null

  constructor(
    sqlit: SQLitClient,
    databaseId: string,
    podId: string,
    debug = false,
  ) {
    this.sqlit = sqlit
    this.databaseId = databaseId
    this.podId = podId
    this.debug = debug
  }

  /**
   * Set the DO instance provider (called by router on startup)
   */
  setInstanceProvider(provider: DOInstanceProvider): void {
    this.instanceProvider = provider
    log.info('Alarm scheduler connected to instance provider')
  }

  /**
   * Start the alarm scheduler
   */
  start(): void {
    if (this.running) return

    if (!this.instanceProvider) {
      log.warn(
        'Alarm scheduler starting without instance provider - alarms will create new instances',
      )
    }

    this.running = true
    this.pollInterval = setInterval(() => {
      this.pollAlarms().catch((err) => {
        log.error({ error: err }, 'Alarm poll failed')
      })
    }, this.pollIntervalMs)

    log.info(
      { podId: this.podId, interval: this.pollIntervalMs },
      'Alarm scheduler started',
    )
  }

  /**
   * Stop the alarm scheduler
   */
  stop(): void {
    if (!this.running) return

    this.running = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }

    log.info({ podId: this.podId }, 'Alarm scheduler stopped')
  }

  /**
   * Poll for due alarms and fire them
   */
  private async pollAlarms(): Promise<void> {
    const now = Date.now()

    // Find all due alarms
    const dueAlarms = await this.sqlit.query<AlarmEntry>(
      `SELECT do_id, scheduled_time, created_at FROM do_alarms WHERE scheduled_time <= ?`,
      [now],
      this.databaseId,
    )

    if (dueAlarms.rows.length === 0) return

    // Process each due alarm
    for (const alarm of dueAlarms.rows) {
      await this.processAlarm(alarm)
    }
  }

  /**
   * Process a single alarm
   */
  private async processAlarm(alarm: AlarmEntry): Promise<void> {
    const doId = alarm.do_id

    // Parse namespace from do_id (format: namespace:hex)
    const colonIdx = doId.indexOf(':')
    if (colonIdx === -1) {
      log.error({ doId }, 'Invalid do_id format in alarm')
      await this.deleteAlarm(doId)
      return
    }

    const namespace = doId.substring(0, colonIdx)
    const doIdHex = doId.substring(colonIdx + 1)
    const key = `${namespace}:${doIdHex}`

    // Check if this DO is hosted on this pod
    const isLocal = await this.isLocalDO(key)
    if (!isLocal) {
      // Not our DO, skip - another pod will handle it
      if (this.debug) {
        log.debug(
          { doId, podId: this.podId },
          'Skipping alarm for non-local DO',
        )
      }
      return
    }

    // Get the DO instance through the shared provider
    let instance: DurableObject | null = null

    if (this.instanceProvider) {
      const result = await this.instanceProvider.getOrCreateInstance(
        namespace,
        doIdHex,
        {},
      )
      instance = result.instance
    } else {
      // Fallback: no instance provider, skip (don't create orphan instances)
      log.warn({ doId }, 'No instance provider available for alarm - skipping')
      return
    }

    // Fire the alarm
    if (instance.alarm) {
      if (this.debug) {
        log.debug({ doId }, 'Firing alarm')
      }
      await instance.alarm()
    }

    // Delete the alarm after firing
    await this.deleteAlarm(doId)
  }

  /**
   * Check if a DO is hosted on this pod
   */
  private async isLocalDO(key: string): Promise<boolean> {
    const result = await this.sqlit.query<LocationEntry>(
      `SELECT pod_id FROM do_locations WHERE key = ? AND status = 'active'`,
      [key],
      this.databaseId,
    )

    if (result.rows.length === 0) {
      // No location registered - we can claim it
      return true
    }

    return result.rows[0].pod_id === this.podId
  }

  /**
   * Delete an alarm after it has fired
   */
  private async deleteAlarm(doId: string): Promise<void> {
    await this.sqlit.exec(
      `DELETE FROM do_alarms WHERE do_id = ?`,
      [doId],
      this.databaseId,
    )
  }

  /**
   * Get the number of pending alarms
   */
  async getPendingAlarmCount(): Promise<number> {
    const result = await this.sqlit.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM do_alarms WHERE scheduled_time > ?`,
      [Date.now()],
      this.databaseId,
    )
    return result.rows[0]?.count ?? 0
  }

  /**
   * Get alarms due in the next N seconds
   */
  async getUpcomingAlarms(seconds: number): Promise<AlarmEntry[]> {
    const now = Date.now()
    const until = now + seconds * 1000
    const result = await this.sqlit.query<AlarmEntry>(
      `SELECT do_id, scheduled_time, created_at FROM do_alarms WHERE scheduled_time <= ? ORDER BY scheduled_time`,
      [until],
      this.databaseId,
    )
    return result.rows
  }
}

// ============================================================================
// Singleton
// ============================================================================

let scheduler: AlarmScheduler | null = null

export function getAlarmScheduler(): AlarmScheduler {
  if (!scheduler) {
    const sqlit = getSQLit()
    const databaseId = getSQLitDatabaseId() ?? 'dws-durable-objects'
    const podId = process.env.POD_ID ?? process.env.HOSTNAME ?? 'local'
    scheduler = new AlarmScheduler(
      sqlit,
      databaseId,
      podId,
      getLogLevel() === 'debug',
    )
  }
  return scheduler
}

export function startAlarmScheduler(): void {
  getAlarmScheduler().start()
}

export function stopAlarmScheduler(): void {
  if (scheduler) {
    scheduler.stop()
  }
}
