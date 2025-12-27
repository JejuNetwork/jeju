/**
 * Otto Launch API
 *
 * RESTful API endpoints for token launching with full customization.
 */

import { cors } from '@elysiajs/cors'
import { expectAddress, expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DEFAULT_BONDING_CONFIG,
  DEFAULT_FEE_CONFIG,
  DEFAULT_ICO_CONFIG,
  DEGEN_CONFIG,
  getLaunchService,
  LaunchRequestSchema,
  LaunchResultSchema,
  LEGACY_POOL,
  PROJECT_10_ETH_POOL,
  PROJECT_20_ETH_POOL,
} from '../services/launch'

const launchService = getLaunchService()

const allowedOrigins = process.env.OTTO_ALLOWED_ORIGINS?.split(',') ?? []

// API Schemas
const PreviewRequestSchema = z.object({
  launchType: z.enum(['bonding', 'ico', 'simple']),
  initialSupply: z.string().regex(/^\d+$/),
  bondingConfig: z
    .object({
      virtualEthReserves: z.string(),
      graduationTarget: z.string(),
      tokenSupply: z.string(),
    })
    .optional(),
  icoConfig: z
    .object({
      presaleAllocationBps: z.number(),
      presalePrice: z.string(),
      lpFundingBps: z.number(),
      lpLockDuration: z.number(),
      buyerLockDuration: z.number(),
      softCap: z.string(),
      hardCap: z.string(),
      presaleDuration: z.number(),
    })
    .optional(),
  initialLiquidity: z.string().optional(),
  chainId: z.number().default(420691),
})

const PreviewResponseSchema = z.object({
  estimatedGasCost: z.string(),
  estimatedInitialPrice: z.string(),
  estimatedMarketCap: z.string(),
  graduationMarketCap: z.string().optional(),
})

const BondingBuyRequestSchema = z.object({
  bondingCurve: z.string(),
  ethAmount: z.string().regex(/^\d+$/),
  minTokens: z.string().regex(/^\d+$/),
})

const BondingSellRequestSchema = z.object({
  bondingCurve: z.string(),
  tokenAmount: z.string().regex(/^\d+$/),
  minEth: z.string().regex(/^\d+$/),
})

export const launchApi = new Elysia({ prefix: '/api/launch' })
  .use(
    cors({
      origin:
        allowedOrigins.length > 0
          ? (request) => {
              const origin = request.headers.get('origin') ?? ''
              return allowedOrigins.includes(origin)
            }
          : true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Session-Id',
        'X-Wallet-Address',
      ],
    }),
  )

  // Get launch configurations
  .get('/configs', () => ({
    bonding: {
      default: DEFAULT_BONDING_CONFIG,
      degen: DEGEN_CONFIG,
    },
    ico: {
      default: DEFAULT_ICO_CONFIG,
    },
    fee: {
      default: DEFAULT_FEE_CONFIG,
    },
    pool: {
      project10: PROJECT_10_ETH_POOL,
      project20: PROJECT_20_ETH_POOL,
      legacy: LEGACY_POOL,
    },
    defaults: {
      antiSnipe: false,
      lockLiquidity: true,
      liquidityLockDuration: 30 * 24 * 60 * 60,
    },
    chains: ['base', 'arbitrum', 'ethereum', 'unichain', 'monad', 'jeju'],
  }))

  // Preview launch (get estimates without executing)
  .post('/preview', async ({ body, set }) => {
    const parsed = expectValid(PreviewRequestSchema, body, 'preview request')

    try {
      // Create a mock request for preview
      const preview = await launchService.previewLaunch({
        userId: 'preview',
        walletAddress: '0x0000000000000000000000000000000000000000',
        chain: 'base',
        chainId: parsed.chainId,
        token: {
          name: 'Preview',
          symbol: 'PREV',
          imageUrl: 'https://placehold.co/400x400/png?text=PREV',
          initialSupply: parsed.initialSupply,
          antiSnipe: false,
          antiSnipeBlocks: 0,
          tradingDelayBlocks: 0,
          lockLiquidity: true,
          liquidityLockDuration: 30 * 24 * 60 * 60,
        },
        launchType: parsed.launchType,
        bondingConfig: parsed.bondingConfig,
        icoConfig: parsed.icoConfig,
        initialLiquidity: parsed.initialLiquidity,
      })

      return expectValid(PreviewResponseSchema, preview, 'preview response')
    } catch (err) {
      set.status = 400
      const errorMessage = err instanceof Error ? err.message : 'Preview failed'
      return { error: errorMessage }
    }
  })

  // Launch a new token
  .post('/create', async ({ body, request, set }) => {
    const walletAddress = request.headers.get('X-Wallet-Address')

    if (!walletAddress) {
      set.status = 401
      return { error: 'Wallet address required' }
    }

    const validatedWallet = expectAddress(walletAddress)
    const rawBody = body as Record<string, unknown>
    rawBody.walletAddress = validatedWallet

    const parsed = expectValid(LaunchRequestSchema, rawBody, 'launch request')

    try {
      const result = await launchService.launchToken(parsed)

      if (!result.success) {
        set.status = 400
        return { error: result.error ?? 'Launch failed' }
      }

      return expectValid(LaunchResultSchema, result, 'launch result')
    } catch (err) {
      set.status = 500
      const errorMessage = err instanceof Error ? err.message : 'Launch failed'
      return { error: errorMessage }
    }
  })

  // Get launch info by ID
  .get('/:launchId', async ({ params, set }) => {
    try {
      const info = await launchService.getLaunchInfo(params.launchId)
      return info
    } catch (_err) {
      set.status = 404
      return { error: 'Launch not found' }
    }
  })

  // Get user's launches
  .get('/user/:address', async ({ params }) => {
    try {
      const address = expectAddress(params.address)
      const launches = await launchService.getUserLaunches(address)
      return { launches }
    } catch {
      // Return empty array if service unavailable
      return { launches: [] }
    }
  })

  // Buy from bonding curve
  .post('/bonding/buy', async ({ body, request, set }) => {
    const walletAddress = request.headers.get('X-Wallet-Address')

    if (!walletAddress) {
      set.status = 401
      return { error: 'Wallet address required' }
    }

    const validatedWallet = expectAddress(walletAddress)
    const parsed = expectValid(
      BondingBuyRequestSchema,
      body,
      'bonding buy request',
    )

    try {
      const result = await launchService.buyFromBondingCurve(
        validatedWallet,
        expectAddress(parsed.bondingCurve),
        parsed.ethAmount,
        parsed.minTokens,
      )

      if (!result.success) {
        set.status = 400
        return { error: result.error ?? 'Buy failed' }
      }

      return result
    } catch (err) {
      set.status = 500
      const errorMessage = err instanceof Error ? err.message : 'Buy failed'
      return { error: errorMessage }
    }
  })

  // Sell to bonding curve
  .post('/bonding/sell', async ({ body, request, set }) => {
    const walletAddress = request.headers.get('X-Wallet-Address')

    if (!walletAddress) {
      set.status = 401
      return { error: 'Wallet address required' }
    }

    const validatedWallet = expectAddress(walletAddress)
    const parsed = expectValid(
      BondingSellRequestSchema,
      body,
      'bonding sell request',
    )

    try {
      const result = await launchService.sellToBondingCurve(
        validatedWallet,
        expectAddress(parsed.bondingCurve),
        parsed.tokenAmount,
        parsed.minEth,
      )

      if (!result.success) {
        set.status = 400
        return { error: result.error ?? 'Sell failed' }
      }

      return result
    } catch (err) {
      set.status = 500
      const errorMessage = err instanceof Error ? err.message : 'Sell failed'
      return { error: errorMessage }
    }
  })

export default launchApi
