import type { Address } from 'viem'
import { getDatabase } from '../db/client'
import type { CronJob } from '../types'
import { getNextMidnight } from '../utils'

const CRON_ENDPOINT = process.env.CRON_ENDPOINT || 'http://localhost:4200/cron'
const WEBHOOK_BASE = process.env.WEBHOOK_BASE || 'http://localhost:4500'
const CRON_TIMEOUT = 10000

interface Reminder {
  id: string
  todoId: string
  owner: Address
  reminderTime: number
  sent: boolean
  createdAt: number
}

interface CronService {
  scheduleReminder(
    todoId: string,
    owner: Address,
    reminderTime: number,
  ): Promise<Reminder>
  cancelReminder(reminderId: string, owner: Address): Promise<boolean>
  listReminders(owner: Address): Promise<Reminder[]>
  getDueReminders(): Promise<Reminder[]>
  markReminderSent(reminderId: string): Promise<boolean>
  scheduleCleanup(owner: Address): Promise<CronJob>
  isHealthy(): Promise<boolean>
}

class ComputeCronService implements CronService {
  private healthLastChecked = 0
  private healthy = false

  async scheduleReminder(
    todoId: string,
    owner: Address,
    reminderTime: number,
  ): Promise<Reminder> {
    const id = `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    const db = getDatabase()
    await db.exec(
      `INSERT INTO reminders (id, todo_id, owner, reminder_time, sent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, todoId, owner.toLowerCase(), reminderTime, 0, now],
    )

    // Register with compute cron
    await this.registerCronTrigger(id, reminderTime)

    return {
      id,
      todoId,
      owner,
      reminderTime,
      sent: false,
      createdAt: now,
    }
  }

  async cancelReminder(reminderId: string, owner: Address): Promise<boolean> {
    const db = getDatabase()
    const result = await db.exec(
      'DELETE FROM reminders WHERE id = ? AND owner = ?',
      [reminderId, owner.toLowerCase()],
    )

    if (result.rowsAffected > 0) {
      await this.cancelCronTrigger(reminderId)
    }

    return result.rowsAffected > 0
  }

  async listReminders(owner: Address): Promise<Reminder[]> {
    const db = getDatabase()
    const result = await db.query<{
      id: string
      todo_id: string
      owner: string
      reminder_time: number
      sent: number
      created_at: number
    }>('SELECT * FROM reminders WHERE owner = ? ORDER BY reminder_time ASC', [
      owner.toLowerCase(),
    ])

    return result.rows.map((row) => ({
      id: row.id,
      todoId: row.todo_id,
      owner: row.owner as Address,
      reminderTime: row.reminder_time,
      sent: row.sent === 1,
      createdAt: row.created_at,
    }))
  }

  async getDueReminders(): Promise<Reminder[]> {
    const db = getDatabase()
    const now = Date.now()

    const result = await db.query<{
      id: string
      todo_id: string
      owner: string
      reminder_time: number
      sent: number
      created_at: number
    }>('SELECT * FROM reminders WHERE reminder_time <= ? AND sent = 0', [now])

    return result.rows.map((row) => ({
      id: row.id,
      todoId: row.todo_id,
      owner: row.owner as Address,
      reminderTime: row.reminder_time,
      sent: row.sent === 1,
      createdAt: row.created_at,
    }))
  }

  async markReminderSent(reminderId: string): Promise<boolean> {
    const db = getDatabase()
    const result = await db.exec('UPDATE reminders SET sent = 1 WHERE id = ?', [
      reminderId,
    ])
    return result.rowsAffected > 0
  }

  async scheduleCleanup(owner: Address): Promise<CronJob> {
    const jobId = `cleanup-${owner.toLowerCase().slice(0, 8)}`

    await this.registerCleanupJob(jobId, owner)

    return {
      id: jobId,
      name: 'Data Cleanup',
      schedule: '0 0 * * *', // Daily at midnight
      endpoint: `${WEBHOOK_BASE}/webhooks/cleanup`,
      enabled: true,
      lastRun: null,
      nextRun: getNextMidnight(),
    }
  }

  async isHealthy(): Promise<boolean> {
    // Cache the health check result for 30 seconds
    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy
    }

    try {
      const response = await fetch(`${CRON_ENDPOINT}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      this.healthy = response.ok
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.debug(`[Cron] Health check failed: ${errorMsg}`)
      this.healthy = false
    }

    this.healthLastChecked = Date.now()
    return this.healthy
  }

  private async registerCronTrigger(
    reminderId: string,
    triggerTime: number,
  ): Promise<void> {
    const response = await fetch(`${CRON_ENDPOINT}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: reminderId,
        type: 'once',
        triggerTime,
        webhook: `${WEBHOOK_BASE}/webhooks/reminder/${reminderId}`,
      }),
      signal: AbortSignal.timeout(CRON_TIMEOUT),
    })

    if (!response.ok) {
      console.warn(`Failed to register cron trigger: ${response.status}`)
    }
  }

  private async cancelCronTrigger(triggerId: string): Promise<void> {
    const response = await fetch(`${CRON_ENDPOINT}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: triggerId }),
      signal: AbortSignal.timeout(CRON_TIMEOUT),
    })

    if (!response.ok && response.status !== 404) {
      console.warn(`Failed to cancel cron trigger: ${response.status}`)
    }
  }

  private async registerCleanupJob(
    jobId: string,
    owner: Address,
  ): Promise<void> {
    const response = await fetch(`${CRON_ENDPOINT}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: jobId,
        type: 'cron',
        expression: '0 0 * * *', // Daily at midnight
        webhook: `${WEBHOOK_BASE}/webhooks/cleanup`,
        metadata: { owner },
      }),
      signal: AbortSignal.timeout(CRON_TIMEOUT),
    })

    if (!response.ok) {
      console.warn(`Failed to register cleanup job: ${response.status}`)
    }
  }
}

let cronService: CronService | null = null

export function getCronService(): CronService {
  if (!cronService) {
    cronService = new ComputeCronService()
  }
  return cronService
}

// Webhook handlers for cron callbacks
export async function handleReminderWebhook(reminderId: string): Promise<void> {
  const cron = getCronService()
  await cron.markReminderSent(reminderId)
  console.log(`Reminder ${reminderId} triggered`)
}

export async function handleCleanupWebhook(): Promise<void> {
  const db = getDatabase()
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  // Delete completed todos older than 30 days
  await db.exec('DELETE FROM todos WHERE completed = 1 AND updated_at < ?', [
    thirtyDaysAgo,
  ])

  // Delete sent reminders older than 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  await db.exec('DELETE FROM reminders WHERE sent = 1 AND created_at < ?', [
    sevenDaysAgo,
  ])

  console.log('Cleanup job completed')
}
