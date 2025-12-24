/**
 * DWS Trigger Service
 * Executes triggers via HTTP webhooks, cron schedules, or event listeners.
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'

// CORS Configuration

function getCorsConfig() {
  const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'
  return {
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
    credentials: true,
  }
}

export interface TriggerExecution {
  executionId: string
  triggerId: string
  startedAt: number
  completedAt?: number
  status: 'running' | 'success' | 'failure'
  response?: { status: number; body: string }
  error?: string
}

export interface Trigger {
  id: string
  type: 'cron' | 'event' | 'webhook'
  config: Record<string, string>
  target: string
  enabled: boolean
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  lastRun?: number
  lastStatus?: 'success' | 'failure'
  nextRun?: number
  executions: TriggerExecution[]
}

const triggers = new Map<string, Trigger>()
const cronIntervals = new Map<string, ReturnType<typeof setInterval>>()

async function executeTrigger(trigger: Trigger): Promise<TriggerExecution> {
  const executionId = crypto.randomUUID()
  const execution: TriggerExecution = {
    executionId,
    triggerId: trigger.id,
    startedAt: Date.now(),
    status: 'running',
  }
  trigger.executions.push(execution)
  trigger.lastRun = execution.startedAt

  const response = await fetch(trigger.target, {
    method: trigger.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Trigger-ID': trigger.id,
      'X-Execution-ID': executionId,
      ...trigger.headers,
    },
    body:
      trigger.method === 'GET'
        ? undefined
        : trigger.body ||
          JSON.stringify({ triggerId: trigger.id, timestamp: Date.now() }),
  }).catch((err: Error) => ({ error: err.message }))

  execution.completedAt = Date.now()
  if ('error' in response) {
    execution.status = 'failure'
    execution.error = response.error
    trigger.lastStatus = 'failure'
  } else {
    const responseBody = await response.text()
    execution.response = { status: response.status, body: responseBody }
    execution.status = response.ok ? 'success' : 'failure'
    trigger.lastStatus = response.ok ? 'success' : 'failure'
    if (!response.ok)
      execution.error = `HTTP ${response.status}: ${responseBody.slice(0, 200)}`
  }
  if (trigger.executions.length > 100)
    trigger.executions = trigger.executions.slice(-100)
  return execution
}

function parseCronToInterval(cron: string): number {
  if (!cron) return 0
  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return 0
  const [minutes, hours] = parts
  if (minutes.startsWith('*/')) {
    const n = parseInt(minutes.slice(2), 10)
    if (!Number.isNaN(n) && n > 0) return n * 60 * 1000
  }
  if (minutes === '0' && hours === '*') return 60 * 60 * 1000
  if (minutes === '0' && hours === '0') return 24 * 60 * 60 * 1000
  return 60 * 1000
}

function calculateNextCronRun(cron?: string): number | undefined {
  if (!cron) return undefined
  const intervalMs = parseCronToInterval(cron)
  if (intervalMs <= 0) return undefined
  return Date.now() + intervalMs
}

function setupCronTrigger(trigger: Trigger): void {
  const intervalMs = parseCronToInterval(trigger.config.cron)
  if (intervalMs <= 0) {
    console.log(
      `[Triggers] Invalid cron expression for trigger ${trigger.id}: ${trigger.config.cron}`,
    )
    return
  }
  const interval = setInterval(() => {
    if (trigger.enabled) executeTrigger(trigger)
  }, intervalMs)
  cronIntervals.set(trigger.id, interval)
  console.log(
    `[Triggers] Set up cron trigger ${trigger.id} with interval ${intervalMs}ms`,
  )
}

const app = new Elysia()
  .use(cors(getCorsConfig()))
  .get('/health', () => ({
    status: 'healthy',
    service: 'dws-triggers',
    activeTriggers: triggers.size,
    enabledTriggers: [...triggers.values()].filter((t) => t.enabled).length,
  }))
  .get('/triggers', () => ({
    triggers: Array.from(triggers.values()).map((t) => ({
      ...t,
      executions: t.executions.slice(-10),
    })),
  }))
  .get('/triggers/:id', ({ params, set }) => {
    const trigger = triggers.get(params.id)
    if (!trigger) {
      set.status = 404
      return { error: 'Trigger not found' }
    }
    return { trigger }
  })
  .post('/triggers', ({ body, set }) => {
    const req = body as Omit<
      Trigger,
      'id' | 'executions' | 'lastRun' | 'lastStatus'
    >
    if (!req.target) {
      set.status = 400
      return { error: 'target URL is required' }
    }
    if (!req.type) {
      set.status = 400
      return { error: 'type is required (cron, event, or webhook)' }
    }
    const id = crypto.randomUUID()
    const trigger: Trigger = {
      id,
      ...req,
      executions: [],
      nextRun:
        req.type === 'cron' ? calculateNextCronRun(req.config.cron) : undefined,
    }
    triggers.set(id, trigger)
    if (trigger.type === 'cron' && trigger.enabled && trigger.config.cron)
      setupCronTrigger(trigger)
    set.status = 201
    return { success: true, trigger }
  })
  .put('/triggers/:id', async ({ params, body, set }) => {
    const existing = triggers.get(params.id)
    if (!existing) {
      set.status = 404
      return { error: 'Trigger not found' }
    }
    const req = body as Partial<Trigger>
    const updated: Trigger = {
      ...existing,
      ...req,
      id: params.id,
      executions: existing.executions,
    }
    triggers.set(params.id, updated)
    if (updated.type === 'cron') {
      if (cronIntervals.has(params.id)) {
        clearInterval(cronIntervals.get(params.id))
        cronIntervals.delete(params.id)
      }
      if (updated.enabled && updated.config.cron) setupCronTrigger(updated)
    }
    return { success: true, trigger: updated }
  })
  .delete('/triggers/:id', ({ params, set }) => {
    if (cronIntervals.has(params.id)) {
      clearInterval(cronIntervals.get(params.id))
      cronIntervals.delete(params.id)
    }
    if (triggers.delete(params.id)) return { success: true }
    set.status = 404
    return { error: 'Trigger not found' }
  })
  .post('/triggers/:id/run', async ({ params, set }) => {
    const trigger = triggers.get(params.id)
    if (!trigger) {
      set.status = 404
      return { error: 'Trigger not found' }
    }
    const execution = await executeTrigger(trigger)
    return { success: execution.status === 'success', execution }
  })
  .get('/triggers/:id/executions', ({ params, query, set }) => {
    const trigger = triggers.get(params.id)
    if (!trigger) {
      set.status = 404
      return { error: 'Trigger not found' }
    }
    const limit = parseInt((query.limit as string) || '20', 10)
    return {
      executions: trigger.executions.slice(-limit),
      total: trigger.executions.length,
    }
  })

const PORT = parseInt(process.env.TRIGGER_PORT || '4016', 10)

if (import.meta.main) {
  console.log(`[DWS Triggers] Running at http://localhost:${PORT}`)
  app.listen(PORT)
}

export type TriggerApp = typeof app
export { app as triggerApp }
