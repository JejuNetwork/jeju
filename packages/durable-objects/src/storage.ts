/**
 * @jejunetwork/durable-objects - Storage Implementation
 *
 * Persistent KV storage backed by SQLit. Constraints match Cloudflare:
 * - Max key: 2048 bytes, Max value: 128KB, Max list: 1000, Max batch: 128
 */

import { getLogLevel } from '@jejunetwork/config'
import type { QueryParam, SQLitClient, SQLitConnection } from '@jejunetwork/db'
import pino from 'pino'
import type {
  DurableObjectStorage,
  GetAlarmOptions,
  GetOptions,
  ListOptions,
  PutOptions,
  SetAlarmOptions,
} from './types.js'

export const MAX_KEY_SIZE = 2048
export const MAX_VALUE_SIZE = 131072
export const MAX_LIST_LIMIT = 1000
export const MAX_BATCH_SIZE = 128

const log = pino({ name: 'durable-objects:storage', level: getLogLevel() })

function validateKey(key: string): void {
  if (key.length === 0) throw new Error('Key cannot be empty')
  const bytes = new TextEncoder().encode(key)
  if (bytes.length > MAX_KEY_SIZE) {
    throw new Error(`Key size ${bytes.length} exceeds maximum ${MAX_KEY_SIZE} bytes`)
  }
}

function validateValue(serialized: string): void {
  const bytes = new TextEncoder().encode(serialized)
  if (bytes.length > MAX_VALUE_SIZE) {
    throw new Error(`Value size ${bytes.length} exceeds maximum ${MAX_VALUE_SIZE} bytes (128KB)`)
  }
}

interface StateRow { key: string; value: string }
interface AlarmRow { scheduled_time: number }

export class DWSObjectStorage implements DurableObjectStorage {
  private readonly doId: string
  private readonly sqlit: SQLitClient
  private readonly databaseId: string
  private readonly debug: boolean
  private inTransaction = false
  private transactionConnection: SQLitConnection | null = null

  constructor(doId: string, sqlit: SQLitClient, databaseId: string, debug = false) {
    this.doId = doId
    this.sqlit = sqlit
    this.databaseId = databaseId
    this.debug = debug
  }

  async get<T = unknown>(key: string, options?: GetOptions): Promise<T | undefined>
  async get<T = unknown>(keys: string[], options?: GetOptions): Promise<Map<string, T>>
  async get<T = unknown>(keyOrKeys: string | string[], _options?: GetOptions): Promise<T | undefined | Map<string, T>> {
    if (typeof keyOrKeys === 'string') {
      validateKey(keyOrKeys)
      const result = await this.query<StateRow>(
        `SELECT value FROM do_state WHERE do_id = ? AND key = ?`,
        [this.doId, keyOrKeys],
      )
      if (result.length === 0) return undefined
      if (this.debug) log.debug({ doId: this.doId, key: keyOrKeys }, 'get')
      return JSON.parse(result[0].value) as T
    }

    if (keyOrKeys.length === 0) return new Map()
    for (const key of keyOrKeys) validateKey(key)

    const placeholders = keyOrKeys.map(() => '?').join(', ')
    const result = await this.query<StateRow>(
      `SELECT key, value FROM do_state WHERE do_id = ? AND key IN (${placeholders})`,
      [this.doId, ...keyOrKeys],
    )
    const map = new Map<string, T>()
    for (const row of result) {
      map.set(row.key, JSON.parse(row.value) as T)
    }
    if (this.debug) log.debug({ doId: this.doId, found: map.size }, 'getMultiple')
    return map
  }

  async put<T = unknown>(key: string, value: T, options?: PutOptions): Promise<void>
  async put<T = unknown>(entries: Record<string, T>, options?: PutOptions): Promise<void>
  async put<T = unknown>(keyOrEntries: string | Record<string, T>, valueOrOptions?: T | PutOptions): Promise<void> {
    if (typeof keyOrEntries === 'string') {
      validateKey(keyOrEntries)
      const serialized = JSON.stringify(valueOrOptions)
      validateValue(serialized)
      await this.exec(
        `INSERT INTO do_state (do_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (do_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [this.doId, keyOrEntries, serialized, Date.now()],
      )
      if (this.debug) log.debug({ doId: this.doId, key: keyOrEntries }, 'put')
      return
    }

    const keys = Object.keys(keyOrEntries)
    if (keys.length === 0) return
    if (keys.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch put size ${keys.length} exceeds maximum ${MAX_BATCH_SIZE}`)
    }

    const serialized = keys.map((key) => {
      validateKey(key)
      const value = JSON.stringify(keyOrEntries[key])
      validateValue(value)
      return { key, value }
    })

    const sql = `INSERT INTO do_state (do_id, key, value, updated_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT (do_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    const now = Date.now()

    if (this.inTransaction && this.transactionConnection) {
      for (const { key, value } of serialized) {
        await this.transactionConnection.exec(sql, [this.doId, key, value, now])
      }
    } else {
      const conn = await this.sqlit.connect(this.databaseId)
      const tx = await conn.beginTransaction()
      for (const { key, value } of serialized) {
        await tx.exec(sql, [this.doId, key, value, now])
      }
      await tx.commit()
      this.sqlit.getPool(this.databaseId).release(conn)
    }
    if (this.debug) log.debug({ doId: this.doId, count: keys.length }, 'putMultiple')
  }

  async delete(key: string): Promise<boolean>
  async delete(keys: string[]): Promise<number>
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    if (typeof keyOrKeys === 'string') {
      validateKey(keyOrKeys)
      const result = await this.exec(
        `DELETE FROM do_state WHERE do_id = ? AND key = ?`,
        [this.doId, keyOrKeys],
      )
      if (this.debug) log.debug({ doId: this.doId, key: keyOrKeys, deleted: result.rowsAffected > 0 }, 'delete')
      return result.rowsAffected > 0
    }

    if (keyOrKeys.length === 0) return 0
    for (const key of keyOrKeys) validateKey(key)

    const placeholders = keyOrKeys.map(() => '?').join(', ')
    const result = await this.exec(
      `DELETE FROM do_state WHERE do_id = ? AND key IN (${placeholders})`,
      [this.doId, ...keyOrKeys],
    )
    if (this.debug) log.debug({ doId: this.doId, deleted: result.rowsAffected }, 'deleteMultiple')
    return result.rowsAffected
  }

  async deleteAll(): Promise<void> {
    const result = await this.exec(`DELETE FROM do_state WHERE do_id = ?`, [this.doId])
    if (this.debug) log.debug({ doId: this.doId, deleted: result.rowsAffected }, 'deleteAll')
  }

  async list<T = unknown>(options?: ListOptions): Promise<Map<string, T>> {
    const limit = Math.min(options?.limit ?? MAX_LIST_LIMIT, MAX_LIST_LIMIT)
    const reverse = options?.reverse ?? false

    const conditions: string[] = ['do_id = ?']
    const params: QueryParam[] = [this.doId]

    if (options?.prefix) {
      conditions.push('key LIKE ?')
      params.push(`${options.prefix.replace(/[%_\\]/g, '\\$&')}%`)
    }
    if (options?.start) {
      conditions.push(reverse ? 'key <= ?' : 'key >= ?')
      params.push(options.start)
    }
    if (options?.end) {
      conditions.push(reverse ? 'key > ?' : 'key < ?')
      params.push(options.end)
    }
    params.push(limit)

    const result = await this.query<StateRow>(
      `SELECT key, value FROM do_state WHERE ${conditions.join(' AND ')} ORDER BY key ${reverse ? 'DESC' : 'ASC'} LIMIT ?`,
      params,
    )
    const map = new Map<string, T>()
    for (const row of result) {
      map.set(row.key, JSON.parse(row.value) as T)
    }
    if (this.debug) log.debug({ doId: this.doId, count: map.size }, 'list')
    return map
  }

  async transaction<T>(closure: () => T | Promise<T>): Promise<T> {
    if (this.inTransaction) throw new Error('Nested transactions not supported')

    const conn = await this.sqlit.connect(this.databaseId)
    const tx = await conn.beginTransaction()
    this.inTransaction = true
    this.transactionConnection = conn

    try {
      const result = await closure()
      await tx.commit()
      return result
    } catch (e) {
      await tx.rollback()
      throw e instanceof Error ? e : new Error(String(e))
    } finally {
      this.inTransaction = false
      this.transactionConnection = null
      this.sqlit.getPool(this.databaseId).release(conn)
    }
  }

  /** No-op for Cloudflare API compat - SQLit writes are already synchronous (BFT consensus) */
  async sync(): Promise<void> {}

  async getAlarm(): Promise<number | null> {
    const result = await this.query<AlarmRow>(
      `SELECT scheduled_time FROM do_alarms WHERE do_id = ?`,
      [this.doId],
    )
    return result.length > 0 ? result[0].scheduled_time : null
  }

  async setAlarm(scheduledTime: Date | number): Promise<void> {
    const time = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime()
    if (time <= Date.now()) throw new Error('Alarm time must be in the future')

    await this.exec(
      `INSERT INTO do_alarms (do_id, scheduled_time, created_at) VALUES (?, ?, ?)
       ON CONFLICT (do_id) DO UPDATE SET scheduled_time = excluded.scheduled_time, created_at = excluded.created_at`,
      [this.doId, time, Date.now()],
    )
    if (this.debug) log.debug({ doId: this.doId, scheduledTime: time }, 'setAlarm')
  }

  async deleteAlarm(): Promise<void> {
    await this.exec(`DELETE FROM do_alarms WHERE do_id = ?`, [this.doId])
  }

  private async query<T>(sql: string, params: QueryParam[]): Promise<T[]> {
    if (this.inTransaction && this.transactionConnection) {
      return (await this.transactionConnection.query<T>(sql, params)).rows
    }
    return (await this.sqlit.query<T>(sql, params, this.databaseId)).rows
  }

  private async exec(sql: string, params: QueryParam[]): Promise<{ rowsAffected: number }> {
    if (this.inTransaction && this.transactionConnection) {
      return { rowsAffected: (await this.transactionConnection.exec(sql, params)).rowsAffected }
    }
    return { rowsAffected: (await this.sqlit.exec(sql, params, this.databaseId)).rowsAffected }
  }
}
