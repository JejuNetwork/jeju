/**
 * Intent Service - Decentralized Cross-Chain Intent Management
 *
 * Persists intents to CovenantSQL for decentralized storage.
 */

import type {
  Intent,
  IntentQuote,
  OIFStats,
  SupportedChainId,
} from '@jejunetwork/types'
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem'
import { ZERO_ADDRESS } from '../lib/contracts.js'
import {
  type CreateIntentRequest,
  CreateIntentRequestSchema,
  expect,
  expectAddress,
  expectChainId,
  type GetQuoteRequest,
  GetQuoteRequestSchema,
  IntentIdSchema,
  ListIntentsQuerySchema,
} from '../lib/validation.js'
import * as chainService from './chain-service'
import { quoteService } from './quote-service.js'
import {
  initializeState,
  intentState,
  routeState,
  solverState,
} from './state.js'

export class IntentService {
  private chainWatchers: Array<() => void> = []
  private statsRefreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.initialize()
  }

  private async initialize(): Promise<void> {
    await initializeState()
    this.startChainWatchers()
    this.refreshStats()
  }

  private startChainWatchers(): void {
    const chains = [1, 42161, 10, 11155111]

    for (const chainId of chains) {
      const unwatch = chainService.watchOrders(chainId, async (log) => {
        const intent: Intent = {
          intentId: log.orderId,
          user: log.user,
          nonce: '0',
          sourceChainId: chainId as SupportedChainId,
          openDeadline: 0,
          fillDeadline: 0,
          inputs: [
            {
              token: ZERO_ADDRESS,
              amount: log.inputAmount.toString(),
              chainId: chainId as SupportedChainId,
            },
          ],
          outputs: [],
          signature: '0x',
          status: 'open',
          createdAt: Date.now(),
        }

        await intentState.save(intent)
        console.log(
          `[IntentService] New intent: ${log.orderId.slice(0, 10)}...`,
        )
      })

      this.chainWatchers.push(unwatch)
    }
  }

  private async refreshStats(): Promise<void> {
    const registryStats = await chainService.fetchRegistryStats()

    if (registryStats) {
      // Update solver count from chain
      const solvers = await solverState.list({ status: 'active' })
      console.log(
        `[IntentService] Stats refreshed: ${solvers.length} active solvers`,
      )
    }

    this.statsRefreshTimer = setTimeout(() => this.refreshStats(), 30000)
  }

  async createIntent(params: CreateIntentRequest): Promise<Intent> {
    const validated = expect(
      params,
      CreateIntentRequestSchema,
      'createIntent params',
    )
    const now = Date.now()
    const recipient = (validated.recipient || ZERO_ADDRESS) as `0x${string}`
    const intentId = keccak256(
      encodeAbiParameters(
        parseAbiParameters('address, uint256, uint256, uint256'),
        [
          recipient,
          BigInt(validated.sourceChain),
          BigInt(validated.amount),
          BigInt(now),
        ],
      ),
    )

    const intent: Intent = {
      intentId,
      user: recipient,
      nonce: now.toString(),
      sourceChainId: validated.sourceChain,
      openDeadline: Math.floor(now / 1000) + 300,
      fillDeadline: Math.floor(now / 1000) + 3600,
      inputs: [
        {
          token: validated.sourceToken as `0x${string}`,
          amount: validated.amount,
          chainId: validated.sourceChain,
        },
      ],
      outputs: [
        {
          token: validated.destinationToken as `0x${string}`,
          amount: validated.amount,
          recipient: (validated.recipient ||
            validated.sourceToken) as `0x${string}`,
          chainId: validated.destinationChain,
        },
      ],
      signature: '0x',
      status: 'open',
      createdAt: now,
    }

    await intentState.save(intent)

    // Update route stats
    const routeId = `${validated.sourceChain}-${validated.destinationChain}`
    await routeState.incrementVolume(routeId, BigInt(validated.amount))

    return intent
  }

  async getQuotes(params: GetQuoteRequest): Promise<IntentQuote[]> {
    const validated = expect(params, GetQuoteRequestSchema, 'getQuotes params')
    return quoteService.getQuotes({
      ...validated,
      sourceToken: validated.sourceToken as `0x${string}`,
      destinationToken: validated.destinationToken as `0x${string}`,
    })
  }

  async getIntent(intentId: string): Promise<Intent | undefined> {
    const validated = expect(intentId, IntentIdSchema, 'getIntent intentId')
    // Check CQL first
    const intent = await intentState.get(intentId)
    if (intent) return intent

    // Fallback to chain lookup
    for (const chainId of [1, 42161, 10, 11155111]) {
      const order = await chainService.fetchOrder(
        chainId,
        validated as `0x${string}`,
      )
      if (order && order.user !== ZERO_ADDRESS) {
        const chainIntent: Intent = {
          intentId: validated as `0x${string}`,
          user: order.user,
          nonce: '0',
          sourceChainId: chainId as SupportedChainId,
          openDeadline: order.openDeadline,
          fillDeadline: order.fillDeadline,
          inputs: [
            {
              token: order.inputToken,
              amount: order.inputAmount.toString(),
              chainId: chainId as SupportedChainId,
            },
          ],
          outputs: [
            {
              token: order.outputToken,
              amount: order.outputAmount.toString(),
              recipient: order.recipient,
              chainId: Number(order.destinationChainId) as SupportedChainId,
            },
          ],
          signature: '0x',
          status: order.filled ? 'filled' : order.refunded ? 'expired' : 'open',
          createdAt: Number(order.createdBlock) * 12000,
          filledAt: order.filled ? Date.now() : undefined,
          solver: order.solver !== ZERO_ADDRESS ? order.solver : undefined,
        }

        // Cache in CQL
        await intentState.save(chainIntent)
        return chainIntent
      }
    }

    return undefined
  }

  async cancelIntent(
    intentId: string,
    user: string,
  ): Promise<{ success: boolean; message: string }> {
    const validatedIntentId = expect(
      intentId,
      IntentIdSchema,
      'cancelIntent intentId',
    )
    const validatedUser = expectAddress(user, 'cancelIntent user')
    const intent = await intentState.get(validatedIntentId)
    if (!intent) {
      throw new Error('Intent not found')
    }
    if (intent.user.toLowerCase() !== validatedUser.toLowerCase()) {
      throw new Error('Not authorized')
    }
    if (intent.status !== 'open') {
      throw new Error('Intent cannot be cancelled')
    }

    await intentState.updateStatus(validatedIntentId, 'expired', {
      cancelledAt: Date.now(),
    })
    return { success: true, message: 'Intent marked for cancellation' }
  }

  async listIntents(params?: {
    user?: string
    status?: string
    sourceChain?: number
    destinationChain?: number
    limit?: number
  }): Promise<Intent[]> {
    const validated = params
      ? expect(params, ListIntentsQuerySchema, 'listIntents params')
      : undefined
    return intentState.list({
      user: validated?.user,
      status: validated?.status,
      sourceChain: validated?.sourceChain,
      limit: validated?.limit ?? 50,
    })
  }

  async getStats(): Promise<OIFStats> {
    const [totalIntents, openIntents, solvers] = await Promise.all([
      intentState.count(),
      intentState.count({ status: 'open' }),
      solverState.list({ status: 'active' }),
    ])

    return {
      totalIntents,
      totalVolume: '0',
      totalVolumeUsd: '0',
      totalFees: '0',
      totalFeesUsd: '0',
      totalSolvers: solvers.length,
      activeSolvers: solvers.length,
      totalSolverStake: solvers
        .reduce((sum, s) => sum + BigInt(s.stakedAmount), 0n)
        .toString(),
      totalRoutes: 0,
      activeRoutes: 0,
      avgFillTimeSeconds: 0,
      successRate: 0,
      last24hIntents: openIntents,
      last24hVolume: '0',
      last24hFees: '0',
      lastUpdated: Date.now(),
    }
  }

  async getChainStats(chainId: number): Promise<{
    totalIntents: number
    totalVolume: string
    avgFillTime: number
    successRate: number
  }> {
    const validatedChainId = expectChainId(chainId, 'getChainStats chainId')
    const intents = await intentState.list({
      sourceChain: validatedChainId,
      limit: 1000,
    })

    const totalVolume = intents.reduce(
      (sum, i) => sum + BigInt(i.inputs[0]?.amount || '0'),
      0n,
    )

    const filledIntents = intents.filter((i) => i.status === 'filled')
    const failedIntents = intents.filter((i) => i.status === 'expired')
    const totalCompleted = filledIntents.length + failedIntents.length

    const avgFillTime =
      filledIntents.length > 0
        ? filledIntents.reduce((sum, i) => {
            const fillTime =
              (i.filledAt || Date.now()) - (i.createdAt || Date.now())
            return sum + fillTime / 1000
          }, 0) / filledIntents.length
        : 0

    const successRate =
      totalCompleted > 0 ? (filledIntents.length / totalCompleted) * 100 : 0

    return {
      totalIntents: intents.length,
      totalVolume: totalVolume.toString(),
      avgFillTime: Math.round(avgFillTime),
      successRate: Math.round(successRate * 10) / 10,
    }
  }

  destroy(): void {
    for (const unwatch of this.chainWatchers) {
      unwatch()
    }
    if (this.statsRefreshTimer) {
      clearTimeout(this.statsRefreshTimer)
    }
  }
}

// Export singleton instance
export const intentService = new IntentService()
