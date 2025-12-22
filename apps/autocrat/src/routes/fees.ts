/**
 * Fee Management Routes
 *
 * API endpoints for the AI CEO to manage network-wide fees.
 * All fee changes are recorded on-chain for transparency.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import {
  ceoFeeSkills,
  executeCEOFeeSkill,
  getFeeConfigState,
  initializeFeeActions,
} from '../ceo-fee-actions'
import { getSharedState } from '../shared-state'

// ============ Schemas ============

const executeFeeSkillSchema = z.object({
  skillId: z.string(),
  params: z.record(z.unknown()),
})

const feeChangeProposalSchema = z.object({
  category: z.enum([
    'distribution',
    'compute',
    'storage',
    'defi',
    'infrastructure',
    'marketplace',
    'names',
    'token',
  ]),
  newValues: z.record(z.unknown()),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
})

// ============ Router ============

export function createFeesRouter(): Hono {
  const router = new Hono()

  // Initialize fee actions on first request
  let initialized = false
  router.use('*', async (c, next) => {
    if (!initialized) {
      const state = getSharedState()
      if (state.clients.publicClient && state.clients.walletClient && state.contracts.feeConfig) {
        initializeFeeActions(
          state.contracts.feeConfig,
          state.clients.publicClient,
          state.clients.walletClient,
        )
        initialized = true
      }
    }
    await next()
  })

  /**
   * GET /fees
   * Get current fee configuration
   */
  router.get('/', async (c) => {
    const state = await getFeeConfigState()
    return c.json({
      success: true,
      data: state,
      timestamp: Date.now(),
    })
  })

  /**
   * GET /fees/skills
   * List available CEO fee management skills
   */
  router.get('/skills', (c) => {
    return c.json({
      success: true,
      skills: ceoFeeSkills,
    })
  })

  /**
   * POST /fees/execute
   * Execute a fee management skill
   */
  router.post('/execute', async (c) => {
    const body = await c.req.json()
    const parsed = executeFeeSkillSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400)
    }

    const { skillId, params } = parsed.data
    const result = await executeCEOFeeSkill(skillId, params)

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400)
    }

    return c.json({
      success: true,
      data: result.result,
      skillId,
    })
  })

  /**
   * GET /fees/summary
   * Get a human-readable summary of current fees
   */
  router.get('/summary', async (c) => {
    const state = await getFeeConfigState()

    const summary = {
      distribution: {
        appDeveloperShare: `${state.distribution.appShareBps / 100}%`,
        liquidityProviderShare: `${state.distribution.lpShareBps / 100}%`,
        contributorPoolShare: `${state.distribution.contributorShareBps / 100}%`,
      },
      compute: {
        inferenceFee: `${state.compute.inferencePlatformFeeBps / 100}%`,
        rentalFee: `${state.compute.rentalPlatformFeeBps / 100}%`,
        triggerFee: `${state.compute.triggerPlatformFeeBps / 100}%`,
      },
      storage: {
        uploadFee: `${state.storage.uploadFeeBps / 100}%`,
        retrievalFee: `${state.storage.retrievalFeeBps / 100}%`,
        pinningFee: `${state.storage.pinningFeeBps / 100}%`,
      },
      defi: {
        swapProtocolFee: `${state.defi.swapProtocolFeeBps / 100}%`,
        bridgeFee: `${state.defi.bridgeFeeBps / 100}%`,
        crossChainMargin: `${state.defi.crossChainMarginBps / 100}%`,
      },
      infrastructure: {
        sequencerRevenue: `${state.infrastructure.sequencerRevenueShareBps / 100}%`,
        oracleTreasury: `${state.infrastructure.oracleTreasuryShareBps / 100}%`,
        rpcPremium: `${state.infrastructure.rpcPremiumFeeBps / 100}%`,
        messaging: `${state.infrastructure.messagingFeeBps / 100}%`,
      },
      marketplace: {
        bazaarPlatform: `${state.marketplace.bazaarPlatformFeeBps / 100}%`,
        launchpadCreator: `${state.marketplace.launchpadCreatorFeeBps / 100}%`,
        launchpadCommunity: `${state.marketplace.launchpadCommunityFeeBps / 100}%`,
        x402Protocol: `${state.marketplace.x402ProtocolFeeBps / 100}%`,
      },
      token: {
        xlpRewardShare: `${state.token.xlpRewardShareBps / 100}%`,
        protocolShare: `${state.token.protocolShareBps / 100}%`,
        burnShare: `${state.token.burnShareBps / 100}%`,
        bridgeFeeRange: `${state.token.bridgeFeeMinBps / 100}% - ${state.token.bridgeFeeMaxBps / 100}%`,
      },
      governance: {
        treasury: state.treasury,
        council: state.council,
        ceo: state.ceo,
      },
    }

    return c.json({
      success: true,
      summary,
      raw: state,
    })
  })

  /**
   * POST /fees/propose
   * Propose a fee change (for council, CEO can execute immediately or after timelock)
   */
  router.post('/propose', async (c) => {
    const body = await c.req.json()
    const parsed = feeChangeProposalSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400)
    }

    const { category, newValues, reason } = parsed.data

    // Map category to skill and params
    const skillMap: Record<string, string> = {
      distribution: 'set-distribution-fees',
      compute: 'set-compute-fees',
      storage: 'set-storage-fees',
      defi: 'set-defi-fees',
      infrastructure: 'set-infrastructure-fees',
      marketplace: 'set-marketplace-fees',
      names: 'set-names-fees',
      token: 'set-token-fees',
    }

    const skillId = skillMap[category]
    if (!skillId) {
      return c.json({ success: false, error: `Unknown category: ${category}` }, 400)
    }

    const result = await executeCEOFeeSkill(skillId, newValues)

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400)
    }

    return c.json({
      success: true,
      category,
      reason,
      txHash: result.result?.txHash,
    })
  })

  /**
   * GET /fees/history
   * Get fee change history (from blockchain events)
   * TODO: Implement by querying FeeConfig events
   */
  router.get('/history', async (c) => {
    // Placeholder - would query blockchain for fee change events
    return c.json({
      success: true,
      history: [],
      message: 'Fee history query not yet implemented',
    })
  })

  /**
   * GET /fees/pending
   * Get pending fee changes awaiting execution
   * TODO: Implement by querying pendingChanges mapping
   */
  router.get('/pending', async (c) => {
    // Placeholder - would query blockchain for pending changes
    return c.json({
      success: true,
      pending: [],
      message: 'Pending changes query not yet implemented',
    })
  })

  return router
}

export default createFeesRouter

