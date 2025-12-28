import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { config, getConfigStatus } from '../config'
import type { StatsResponse } from '../lib/schemas'
import { getNonceCacheStats } from '../services/nonce-manager'
import { createClients, getFacilitatorStats } from '../services/settler'

const serviceStartTime = Date.now()

const healthRoutes = new Elysia()
  .get('/', async ({ set }) => {
    const cfg = config()
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'

    try {
      const { publicClient } = await createClients(cfg.network)
      await publicClient.getBlockNumber()
    } catch {
      status = 'degraded'
    }

    if (
      cfg.facilitatorAddress === ZERO_ADDRESS &&
      cfg.environment === 'production'
    ) {
      status = 'unhealthy'
    }

    const configStatus = await getConfigStatus()
    const nonceStats = await getNonceCacheStats()

    set.status = status === 'unhealthy' ? 503 : 200

    return {
      service: cfg.serviceName,
      version: cfg.serviceVersion,
      status,
      mode: cfg.environment,
      chainId: cfg.chainId,
      network: cfg.network,
      facilitatorAddress: cfg.facilitatorAddress,
      endpoints: {
        verify: 'POST /verify',
        settle: 'POST /settle',
        supported: 'GET /supported',
        stats: 'GET /stats',
      },
      kms: configStatus.kmsAvailable ? configStatus.signingMode : 'disabled',
      distributed: nonceStats.distributed,
      timestamp: Date.now(),
    }
  })
  .get('/stats', async ({ set }) => {
    const cfg = config()
    try {
      const { publicClient } = await createClients(cfg.network)
      const stats = await getFacilitatorStats(publicClient)

      const response: StatsResponse = {
        totalSettlements: stats.totalSettlements.toString(),
        totalVolumeUSD: stats.totalVolumeUSD.toString(),
        protocolFeeBps: Number(stats.protocolFeeBps),
        feeRecipient: stats.feeRecipient,
        supportedTokens: [cfg.usdcAddress],
        uptime: Math.floor((Date.now() - serviceStartTime) / 1000),
        timestamp: Date.now(),
      }
      return response
    } catch (e) {
      set.status = 500
      return {
        error: `Failed to fetch stats: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  })
  .get('/health', async ({ set }) => {
    try {
      const { publicClient } = await createClients(config().network)
      await publicClient.getBlockNumber()
      return { status: 'ok', timestamp: Date.now() }
    } catch {
      set.status = 503
      return { status: 'error', timestamp: Date.now() }
    }
  })
  .get('/ready', async ({ set }) => {
    const cfg = config()
    const configStatus = await getConfigStatus()

    const ready =
      configStatus.signingMode !== 'none' &&
      cfg.facilitatorAddress !== ZERO_ADDRESS
    set.status = ready ? 200 : 503
    return { status: ready ? 'ready' : 'not_ready', timestamp: Date.now() }
  })

export default healthRoutes
