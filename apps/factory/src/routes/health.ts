/**
 * Health Check Routes
 */

import { Elysia } from 'elysia'

const DWS_API_URL = process.env.DWS_URL || 'http://localhost:3456'
const RPC_URL = process.env.RPC_URL || 'http://localhost:9545'

export const healthRoutes = new Elysia({ prefix: '/api/health' }).get(
  '/',
  async () => {
    const services: Record<string, boolean> = {
      factory: true,
      dws: false,
      rpc: false,
    }

    // Check DWS health
    const dwsResponse = await fetch(`${DWS_API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    services.dws = dwsResponse?.ok ?? false

    // Check RPC connectivity
    const rpcResponse = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    services.rpc = rpcResponse?.ok ?? false

    const allHealthy = Object.values(services).every(Boolean)

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      services,
      timestamp: Date.now(),
      version: '1.0.0',
    }
  },
  {
    detail: {
      tags: ['health'],
      summary: 'Health check',
      description: 'Check the health status of Factory and its dependencies',
    },
  },
)
