/** Node Operator API Routes */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { formatEther, parseEther } from 'viem'

const logBuffer: Array<{ timestamp: number; level: string; message: string }> =
  []
const MAX_LOGS = 10000

interface NodeEarnings {
  total: bigint
  pending: bigint
  lastPayout: number | null
  byService: Record<string, bigint>
}
const nodeEarnings = new Map<string, NodeEarnings>()

export function addNodeLog(level: string, message: string): void {
  logBuffer.push({ timestamp: Date.now(), level, message })
  if (logBuffer.length > MAX_LOGS)
    logBuffer.splice(0, logBuffer.length - MAX_LOGS)
}

export function recordEarning(
  nodeAddress: Address,
  service: string,
  amount: bigint,
): void {
  const key = nodeAddress.toLowerCase()
  const e = nodeEarnings.get(key) || {
    total: 0n,
    pending: 0n,
    lastPayout: null,
    byService: {},
  }
  e.pending += amount
  e.byService[service] = (e.byService[service] || 0n) + amount
  nodeEarnings.set(key, e)
}

export function createNodeRouter() {
  return new Elysia({ prefix: '/node' })
    .get('/health', () => ({ status: 'healthy', service: 'dws-node' }))

    .get('/status', ({ request }) => {
      const address = request.headers.get('x-jeju-address')
      const uptimeMs = process.uptime() * 1000
      const isConfigured = !!process.env.NODE_ID
      const hasServices = !!process.env.ENABLED_SERVICES

      let status: 'active' | 'syncing' | 'offline' | 'unconfigured'
      if (!isConfigured) status = 'unconfigured'
      else if (uptimeMs < 30000) status = 'syncing'
      else if (!hasServices) status = 'offline'
      else status = 'active'

      return {
        nodeId: process.env.NODE_ID || 'not-configured',
        address: address || 'unknown',
        network: process.env.NETWORK || 'localnet',
        services: (process.env.ENABLED_SERVICES || '')
          .split(',')
          .filter(Boolean),
        region: process.env.NODE_REGION || 'global',
        teeProvider: process.env.TEE_PROVIDER || 'none',
        uptime: uptimeMs,
        status,
      }
    })

    .get('/earnings', ({ request }) => {
      const address = request.headers.get('x-jeju-address')
      if (!address) return { error: 'Missing x-jeju-address header' }

      const earnings = nodeEarnings.get(address.toLowerCase())
      if (!earnings)
        return { total: '0', pending: '0', lastPayout: null, breakdown: {} }

      const breakdown: Record<string, string> = {}
      for (const [service, amount] of Object.entries(earnings.byService)) {
        breakdown[service] = formatEther(amount)
      }

      return {
        total: formatEther(earnings.total),
        pending: formatEther(earnings.pending),
        lastPayout: earnings.lastPayout,
        breakdown,
      }
    })

    .get(
      '/logs',
      ({ query }) => {
        const lines = Math.min(parseInt(query.lines || '100', 10), 1000)
        return logBuffer
          .slice(-lines)
          .map(
            (log) =>
              `${new Date(log.timestamp).toISOString()} [${log.level.toUpperCase()}] ${log.message}`,
          )
          .join('\n')
      },
      { query: t.Object({ lines: t.Optional(t.String()) }) },
    )

    .get('/logs/stream', ({ set }) => {
      set.headers['content-type'] = 'text/event-stream'
      set.headers['cache-control'] = 'no-cache'
      set.headers.connection = 'keep-alive'

      const stream = new ReadableStream({
        start(controller) {
          let lastIndex = logBuffer.length
          controller.enqueue('data: Connected to log stream\n\n')

          const interval = setInterval(() => {
            if (logBuffer.length > lastIndex) {
              const newLogs = logBuffer.slice(lastIndex)
              lastIndex = logBuffer.length
              for (const log of newLogs) {
                controller.enqueue(
                  `data: ${new Date(log.timestamp).toISOString()} [${log.level.toUpperCase()}] ${log.message}\n\n`,
                )
              }
            }
          }, 500)

          return () => clearInterval(interval)
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    })

    .post(
      '/withdraw',
      async ({ request, body, set }) => {
        const address = request.headers.get('x-jeju-address')
        if (!address) {
          set.status = 400
          return { error: 'Missing x-jeju-address header' }
        }

        const earnings = nodeEarnings.get(address.toLowerCase())
        if (!earnings || earnings.pending === 0n) {
          set.status = 400
          return { error: 'No pending earnings to withdraw' }
        }

        const amount = body.amount ? parseEther(body.amount) : earnings.pending
        if (amount > earnings.pending) {
          set.status = 400
          return { error: 'Insufficient pending earnings' }
        }

        earnings.pending -= amount
        earnings.total += amount
        earnings.lastPayout = Date.now()

        return {
          success: true,
          amount: formatEther(amount),
          mode: 'development',
          message:
            'Local balance updated. Production withdrawals require on-chain transaction.',
        }
      },
      { body: t.Object({ amount: t.Optional(t.String()) }) },
    )
}
