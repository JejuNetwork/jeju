/** Health Routes */

import { getCoreAppUrl, getL2RpcUrl } from '@jejunetwork/config'
import { Elysia } from 'elysia'

const DWS_API_URL = process.env.DWS_URL || getCoreAppUrl('DWS_API')
const RPC_URL = process.env.RPC_URL || getL2RpcUrl()

async function checkServiceHealth(
  url: string,
  options?: RequestInit,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

export const healthRoutes = new Elysia({ prefix: '/api/health' }).get(
  '/',
  async () => {
    const services: Record<string, boolean> = {
      factory: true,
      dws: false,
      rpc: false,
    }

    services.dws = await checkServiceHealth(`${DWS_API_URL}/health`)

    services.rpc = await checkServiceHealth(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    })

    const allHealthy = Object.values(services).every(Boolean)

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      services,
      urls: {
        dws: DWS_API_URL,
        rpc: RPC_URL,
      },
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
