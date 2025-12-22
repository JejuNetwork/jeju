/**
 * DWS Trigger Service
 * Executes triggers via HTTP webhooks, cron schedules, or event listeners.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
// SECURITY: Configure CORS based on environment
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'
app.use(
  '/*',
  cors({
    origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : '*',
    credentials: true,
  }),
)

interface TriggerExecution {
  executionId: string
  triggerId: string
  startedAt: number
  completedAt?: number
  status: 'running' | 'success' | 'failure'
  response?: { status: number; body: string }
  error?: string
}

interface Trigger {
  id: string
  type: 'cron' | 'event' | 'webhook'
  config: Record<string, string>
  target: string // URL to call
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

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'dws-triggers',
    activeTriggers: triggers.size,
    enabledTriggers: [...triggers.values()].filter((t) => t.enabled).length,
  })
})

app.get('/triggers', (c) => {
  return c.json({
    triggers: Array.from(triggers.values()).map((t) => ({
      ...t,
      executions: t.executions.slice(-10), // Only return last 10 executions
    })),
  })
})

app.get('/triggers/:id', (c) => {
  const trigger = triggers.get(c.req.param('id'))
  if (!trigger) {
    return c.json({ error: 'Trigger not found' }, 404)
  }
  return c.json({ trigger })
})

app.post('/triggers', async (c) => {
  const body =
    await c.req.json<
      Omit<Trigger, 'id' | 'executions' | 'lastRun' | 'lastStatus'>
    >()

  if (!body.target) {
    return c.json({ error: 'target URL is required' }, 400)
  }

  if (!body.type) {
    return c.json({ error: 'type is required (cron, event, or webhook)' }, 400)
  }

  const id = crypto.randomUUID()
  const trigger: Trigger = {
    id,
    ...body,
    executions: [],
    nextRun:
      body.type === 'cron' ? calculateNextCronRun(body.config.cron) : undefined,
  }
  triggers.set(id, trigger)

  // Set up cron if applicable
  if (trigger.type === 'cron' && trigger.enabled && trigger.config.cron) {
    setupCronTrigger(trigger)
  }

  return c.json({ success: true, trigger }, 201)
})

app.put('/triggers/:id', async (c) => {
  const id = c.req.param('id')
  const existing = triggers.get(id)
  if (!existing) {
    return c.json({ error: 'Trigger not found' }, 404)
  }

  const body = await c.req.json<Partial<Trigger>>()
  const updated: Trigger = {
    ...existing,
    ...body,
    id,
    executions: existing.executions,
  }
  triggers.set(id, updated)

  // Update cron if needed
  if (updated.type === 'cron') {
    if (cronIntervals.has(id)) {
      clearInterval(cronIntervals.get(id))
      cronIntervals.delete(id)
    }
    if (updated.enabled && updated.config.cron) {
      setupCronTrigger(updated)
    }
  }

  return c.json({ success: true, trigger: updated })
})

app.delete('/triggers/:id', (c) => {
  const id = c.req.param('id')

  if (cronIntervals.has(id)) {
    clearInterval(cronIntervals.get(id))
    cronIntervals.delete(id)
  }

  if (triggers.delete(id)) {
    return c.json({ success: true })
  }
  return c.json({ error: 'Trigger not found' }, 404)
})

app.post('/triggers/:id/run', async (c) => {
  const id = c.req.param('id')
  const trigger = triggers.get(id)
  if (!trigger) {
    return c.json({ error: 'Trigger not found' }, 404)
  }

  const execution = await executeTrigger(trigger)

  return c.json({
    success: execution.status === 'success',
    execution,
  })
})

app.get('/triggers/:id/executions', (c) => {
  const trigger = triggers.get(c.req.param('id'))
  if (!trigger) {
    return c.json({ error: 'Trigger not found' }, 404)
  }

  const limit = parseInt(c.req.query('limit') || '20', 10)
  return c.json({
    executions: trigger.executions.slice(-limit),
    total: trigger.executions.length,
  })
})

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

    if (!response.ok) {
      execution.error = `HTTP ${response.status}: ${responseBody.slice(0, 200)}`
    }
  }

  // Keep only last 100 executions
  if (trigger.executions.length > 100) {
    trigger.executions = trigger.executions.slice(-100)
  }

  return execution
}

function setupCronTrigger(trigger: Trigger): void {
  // Simple cron interval parsing (e.g., "*/5 * * * *" = every 5 minutes)
  const intervalMs = parseCronToInterval(trigger.config.cron)
  if (intervalMs <= 0) {
    console.log(
      `[Triggers] Invalid cron expression for trigger ${trigger.id}: ${trigger.config.cron}`,
    )
    return
  }

  const interval = setInterval(() => {
    if (trigger.enabled) {
      executeTrigger(trigger)
    }
  }, intervalMs)

  cronIntervals.set(trigger.id, interval)
  console.log(
    `[Triggers] Set up cron trigger ${trigger.id} with interval ${intervalMs}ms`,
  )
}

function parseCronToInterval(cron: string): number {
  // Simple parser for common patterns
  // "*/N * * * *" = every N minutes
  // "0 * * * *" = every hour
  // "0 0 * * *" = every day

  if (!cron) return 0

  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return 0

  const [minutes, hours] = parts

  // Every N minutes
  if (minutes.startsWith('*/')) {
    const n = parseInt(minutes.slice(2), 10)
    if (!Number.isNaN(n) && n > 0) {
      return n * 60 * 1000
    }
  }

  // Every hour (0 * * * *)
  if (minutes === '0' && hours === '*') {
    return 60 * 60 * 1000
  }

  // Every day (0 0 * * *)
  if (minutes === '0' && hours === '0') {
    return 24 * 60 * 60 * 1000
  }

  // Default to every minute for unrecognized patterns
  return 60 * 1000
}

function calculateNextCronRun(cron?: string): number | undefined {
  if (!cron) return undefined
  const intervalMs = parseCronToInterval(cron)
  if (intervalMs <= 0) return undefined
  return Date.now() + intervalMs
}

const PORT = parseInt(process.env.TRIGGER_PORT || '4016', 10)

if (import.meta.main) {
  console.log(`[DWS Triggers] Running at http://localhost:${PORT}`)
  Bun.serve({ port: PORT, fetch: app.fetch })
}

export { app as triggerApp }
