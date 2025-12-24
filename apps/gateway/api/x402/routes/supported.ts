import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { config } from '../config'
import { CHAIN_CONFIGS } from '../lib/chains'
import type { SupportedResponse } from '../lib/schemas'

const supportedRoutes = new Elysia({ prefix: '/supported' })
  .get('/', () => {
    const cfg = config()
    const networks = Object.keys(CHAIN_CONFIGS)

    const kinds: Array<{ scheme: 'exact' | 'upto'; network: string }> = []

    for (const network of networks) {
      const chainConfig = CHAIN_CONFIGS[network]
      const hasFacilitator = chainConfig.facilitator !== ZERO_ADDRESS
      const isPrimary = network === cfg.network

      if (hasFacilitator || cfg.environment === 'development' || isPrimary) {
        kinds.push({ scheme: 'exact', network }, { scheme: 'upto', network })
      }
    }

    const response: SupportedResponse = {
      kinds,
      x402Version: 1,
      facilitator: {
        name: cfg.serviceName,
        version: cfg.serviceVersion,
        url: cfg.serviceUrl,
      },
    }

    return response
  })
  .get('/networks', () => {
    const networks = Object.keys(CHAIN_CONFIGS)

    const details = networks.map((network) => {
      const chainConfig = CHAIN_CONFIGS[network]
      return {
        network,
        chainId: chainConfig.chainId,
        name: chainConfig.name,
        usdc: chainConfig.usdc,
        facilitator: chainConfig.facilitator,
        blockExplorer: chainConfig.blockExplorer || null,
      }
    })

    return { networks: details }
  })
  .get('/tokens/:network', ({ params, set }) => {
    const network = params.network
    const chainConfig = CHAIN_CONFIGS[network]

    if (!chainConfig) {
      set.status = 400
      return { error: `Unsupported network: ${network}` }
    }

    const tokens = []

    if (chainConfig.usdc !== ZERO_ADDRESS) {
      tokens.push({
        address: chainConfig.usdc,
        symbol: 'USDC',
        decimals: 6,
        name: 'USD Coin',
      })
    }

    tokens.push({
      address: ZERO_ADDRESS,
      symbol: chainConfig.nativeCurrency.symbol,
      decimals: chainConfig.nativeCurrency.decimals,
      name: chainConfig.nativeCurrency.name,
    })

    return { network, tokens }
  })

export default supportedRoutes
