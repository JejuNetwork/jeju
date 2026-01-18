/**
 * Durable Objects Alarm Scheduler - polls do_alarms and fires when due
 */

import { getLogLevel, getSQLitDatabaseId } from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import type { DurableObject } from '@jejunetwork/durable-objects'
import pino from 'pino'

const log = pino({ name: 'dws:alarm-scheduler', level: getLogLevel() })

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

export interface DOInstanceProvider {
  getOrCreateInstance(
    namespace: string,
    doIdString: string,
    env?: Record<string, unknown>,
  ): Promise<{ instance: DurableObject }>
  hasInstance(key: string): boolean
}

export class AlarmScheduler {
  private sqlit: SQLitClient
  private databaseId: string
  private podId: string
  private debug: boolean
  private running = false
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private pollIntervalMs = 1000
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

  setInstanceProvider(provider: DOInstanceProvider): void {
    this.instanceProvider = provider
    log.info('Alarm scheduler connected to instance provider')
  }

  start(): void {
    if (this.running) return

    if (!this.instanceProvider) {
      log.warn(
        'Alarm scheduler starting without instance provider - alarms will skip',
      )
    }

    this.running = true
    this.pollInterval = setInterval(
      () =>
        this.pollAlarms().catch((err) =>
          log.error({ error: err }, 'Alarm poll failed'),
        ),
      this.pollIntervalMs,
    )
    log.info(
      { podId: this.podId, interval: this.pollIntervalMs },
      'Alarm scheduler started',
    )
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    log.info({ podId: this.podId }, 'Alarm scheduler stopped')
  }

  private async pollAlarms(): Promise<void> {
    const dueAlarms = await this.sqlit.query<AlarmEntry>(
      `SELECT do_id, scheduled_time, created_at FROM do_alarms WHERE scheduled_time <= ?`,
      [Date.now()],
      this.databaseId,
    )
    for (const alarm of dueAlarms.rows) {
      await this.processAlarm(alarm)
    }
  }

  private async processAlarm(alarm: AlarmEntry): Promise<void> {
    const doId = alarm.do_id
    const colonIdx = doId.indexOf(':')

    if (colonIdx === -1) {
      log.error({ doId }, 'Invalid do_id format in alarm')
      await this.deleteAlarm(doId)
      return
    }

    const namespace = doId.substring(0, colonIdx)
    const doIdHex = doId.substring(colonIdx + 1)
    const key = `${namespace}:${doIdHex}`

    if (!(await this.isLocalDO(key))) {
      if (this.debug)
        log.debug(
          { doId, podId: this.podId },
          'Skipping alarm for non-local DO',
        )
      return
    }

    if (!this.instanceProvider) {
      log.warn({ doId }, 'No instance provider - skipping alarm')
      return
    }

    const { instance } = await this.instanceProvider.getOrCreateInstance(
      namespace,
      doIdHex,
      {},
    )

    if (instance.alarm) {
      if (this.debug) log.debug({ doId }, 'Firing alarm')
      await instance.alarm()
    }

    await this.deleteAlarm(doId)
  }

  private async isLocalDO(key: string): Promise<boolean> {
    const result = await this.sqlit.query<LocationEntry>(
      `SELECT pod_id FROM do_locations WHERE key = ? AND status = 'active'`,
      [key],
      this.databaseId,
    )
    return result.rows.length === 0 || result.rows[0].pod_id === this.podId
  }

  private async deleteAlarm(doId: string): Promise<void> {
    await this.sqlit.exec(
      `DELETE FROM do_alarms WHERE do_id = ?`,
      [doId],
      this.databaseId,
    )
  }

  async getPendingAlarmCount(): Promise<number> {
    const result = await this.sqlit.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM do_alarms WHERE scheduled_time > ?`,
      [Date.now()],
      this.databaseId,
    )
    return result.rows[0]?.count ?? 0
  }

  async getUpcomingAlarms(seconds: number): Promise<AlarmEntry[]> {
    const result = await this.sqlit.query<AlarmEntry>(
      `SELECT do_id, scheduled_time, created_at FROM do_alarms WHERE scheduled_time <= ? ORDER BY scheduled_time`,
      [Date.now() + seconds * 1000],
      this.databaseId,
    )
    return result.rows
  }
}

let scheduler: AlarmScheduler | null = null

export function getAlarmScheduler(): AlarmScheduler {
  if (!scheduler) {
    scheduler = new AlarmScheduler(
      getSQLit(),
      getSQLitDatabaseId() ?? 'dws-durable-objects',
      process.env.POD_ID ?? process.env.HOSTNAME ?? 'local',
      getLogLevel() === 'debug',
    )
  }
  return scheduler
}

export function startAlarmScheduler(): void {
  getAlarmScheduler().start()
}
export function stopAlarmScheduler(): void {
  scheduler?.stop()
}
