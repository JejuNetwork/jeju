/**
 * Fee Management Routes
 *
 * API endpoints for the AI CEO to manage network-wide fees.
 * All fee changes are recorded on-chain for transparency.
 */

import { Elysia, t } from 'elysia'
import {
  ceoFeeSkills,
  executeCEOFeeSkill,
  getFeeChangeHistory,
  getFeeConfigState,
  getPendingFeeChanges,
  initializeFeeActions,
  isTxHashResult,
} from '../ceo-fee-actions'
import { getSharedState } from '../shared-state'

// Initialize fee actions on first call
let readOnlyInitialized = false
let writeInitialized = false

function ensureFeeActionsReadOnly(): boolean {
  if (readOnlyInitialized) return true

  const state = getSharedState()
  if (state.clients.publicClient && state.contracts.feeConfig) {
    // Initialize with null wallet client for read-only access
    initializeFeeActions(
      state.contracts.feeConfig,
      state.clients.publicClient,
      null,
    )
    readOnlyInitialized = true
    return true
  }
  return false
}

function ensureFeeActionsWrite(): boolean {
  if (writeInitialized) return true

  const state = getSharedState()
  if (
    state.clients.publicClient &&
    state.clients.walletClient &&
    state.contracts.feeConfig
  ) {
    initializeFeeActions(
      state.contracts.feeConfig,
      state.clients.publicClient,
      state.clients.walletClient,
    )
    writeInitialized = true
    return true
  }
  return false
}

export const feesRoutes = new Elysia({ prefix: '/fees' })
  /**
   * GET /fees
   * Get current fee configuration
   */
  .get('/', async () => {
    if (!ensureFeeActionsReadOnly()) {
      return {
        success: false,
        error: 'Fee actions not initialized - check FEE_CONFIG_ADDRESS and RPC',
      }
    }

    const state = await getFeeConfigState()
    return {
      success: true,
      data: state,
      timestamp: Date.now(),
    }
  })

  /**
   * GET /fees/skills
   * List available CEO fee management skills
   */
  .get('/skills', () => ({
    success: true,
    skills: ceoFeeSkills,
  }))

  /**
   * POST /fees/execute
   * Execute a fee management skill
   */
  .post(
    '/execute',
    async ({ body }) => {
      // Read-only skills don't need wallet client
      if (body.skillId === 'get-fees') {
        if (!ensureFeeActionsReadOnly()) {
          return { success: false, error: 'Fee actions not initialized' }
        }
      } else {
        if (!ensureFeeActionsWrite()) {
          return {
            success: false,
            error: 'Write access not available - wallet client required',
          }
        }
      }

      const { skillId, params } = body
      const result = await executeCEOFeeSkill(skillId, params)

      if (!result.success) {
        return { success: false, error: result.error }
      }

      return {
        success: true,
        data: result.result,
        skillId,
      }
    },
    {
      body: t.Object({
        skillId: t.String(),
        params: t.Record(t.String(), t.Unknown()),
      }),
    },
  )

  /**
   * GET /fees/summary
   * Get a human-readable summary of current fees
   */
  .get('/summary', async () => {
    if (!ensureFeeActionsReadOnly()) {
      return {
        success: false,
        error: 'Fee actions not initialized - check FEE_CONFIG_ADDRESS and RPC',
      }
    }

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

    return {
      success: true,
      summary,
      raw: state,
    }
  })

  /**
   * POST /fees/propose
   * Propose a fee change (for council, CEO can execute immediately or after timelock)
   */
  .post(
    '/propose',
    async ({ body }) => {
      if (!ensureFeeActionsWrite()) {
        return {
          success: false,
          error: 'Write access not available - wallet client required',
        }
      }

      const { category, newValues, reason } = body

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
        return { success: false, error: `Unknown category: ${category}` }
      }

      const result = await executeCEOFeeSkill(skillId, newValues)

      if (!result.success) {
        return { success: false, error: result.error }
      }

      return {
        success: true,
        category,
        reason,
        txHash: isTxHashResult(result.result)
          ? result.result.txHash
          : undefined,
      }
    },
    {
      body: t.Object({
        category: t.Union([
          t.Literal('distribution'),
          t.Literal('compute'),
          t.Literal('storage'),
          t.Literal('defi'),
          t.Literal('infrastructure'),
          t.Literal('marketplace'),
          t.Literal('names'),
          t.Literal('token'),
        ]),
        newValues: t.Record(t.String(), t.Unknown()),
        reason: t.String({ minLength: 10 }),
      }),
    },
  )

  /**
   * GET /fees/treasury
   * Get treasury address and balance
   */
  .get('/treasury', async () => {
    if (!ensureFeeActionsReadOnly()) {
      return {
        success: false,
        error: 'Fee actions not initialized - check FEE_CONFIG_ADDRESS and RPC',
      }
    }

    const state = await getFeeConfigState()
    const sharedState = getSharedState()

    let balance = '0'
    if (sharedState.clients.publicClient && state.treasury) {
      const balanceWei = await sharedState.clients.publicClient.getBalance({
        address: state.treasury,
      })
      // Format to ETH with 4 decimals
      balance = (Number(balanceWei) / 1e18).toFixed(4)
    }

    return {
      success: true,
      treasury: {
        address: state.treasury,
        balance,
      },
    }
  })

  /**
   * GET /fees/history
   * Get fee change history (from blockchain events)
   */
  .get(
    '/history',
    async ({ query }) => {
      if (!ensureFeeActionsReadOnly()) {
        return {
          success: false,
          error:
            'Fee actions not initialized - check FEE_CONFIG_ADDRESS and RPC',
        }
      }

      const limit = query.limit ? Number.parseInt(query.limit, 10) : 50
      const history = await getFeeChangeHistory(limit)

      return {
        success: true,
        history: history.map((h) => ({
          changeId: h.changeId,
          feeType: h.feeType,
          effectiveAt: h.effectiveAt,
          proposedBy: h.proposedBy,
          status: h.status,
          blockNumber: h.blockNumber.toString(),
          transactionHash: h.transactionHash,
        })),
        total: history.length,
      }
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
    },
  )

  /**
   * GET /fees/pending
   * Get pending fee changes awaiting execution
   */
  .get('/pending', async () => {
    if (!ensureFeeActionsReadOnly()) {
      return {
        success: false,
        error: 'Fee actions not initialized - check FEE_CONFIG_ADDRESS and RPC',
      }
    }

    const pending = await getPendingFeeChanges()

    return {
      success: true,
      pending: pending.map((p) => ({
        changeId: p.changeId,
        feeType: p.feeType,
        effectiveAt: p.effectiveAt,
        proposedBy: p.proposedBy,
        executed: p.executed,
      })),
      total: pending.length,
    }
  })
