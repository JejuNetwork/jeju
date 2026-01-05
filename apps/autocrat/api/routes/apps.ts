import { Elysia, t } from 'elysia'
import type { Address, Hash, Hex } from 'viem'
import { getSharedState } from '../shared-state'

/**
 * App Fee Management Routes
 *
 * Core Principle: Network gets 0% - fees go to apps and community
 *
 * These routes allow:
 * - App registration for fee eligibility
 * - Viewing app fee stats
 * - Claiming accumulated fees
 * - Managing app contracts
 */

// ABIs for contract interaction
const AppFeeRegistryABI = [
  {
    type: 'function',
    name: 'registerApp',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'primaryContract', type: 'address' },
      { name: 'feeRecipient', type: 'address' },
      { name: 'daoId', type: 'bytes32' },
    ],
    outputs: [{ name: 'appId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addAppContract',
    inputs: [
      { name: 'appId', type: 'bytes32' },
      { name: 'contractAddr', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setFeeRecipient',
    inputs: [
      { name: 'appId', type: 'bytes32' },
      { name: 'newRecipient', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getApp',
    inputs: [{ name: 'appId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'appId', type: 'bytes32' },
          { name: 'daoId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'primaryContract', type: 'address' },
          { name: 'additionalContracts', type: 'address[]' },
          { name: 'feeRecipient', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'isVerified', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAppStats',
    inputs: [{ name: 'appId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'totalTransactions', type: 'uint256' },
          { name: 'totalFeesEarned', type: 'uint256' },
          { name: 'totalFeesClaimed', type: 'uint256' },
          { name: 'lastClaimAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAOApps',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOwnerApps',
    inputs: [{ name: 'ownerAddr', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAppForContract',
    inputs: [{ name: 'contractAddr', type: 'address' }],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isEligibleForFees',
    inputs: [{ name: 'contractAddr', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'linkAgent',
    inputs: [
      { name: 'appId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyApp',
    inputs: [{ name: 'appId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

const FeeDistributorABI = [
  {
    type: 'function',
    name: 'getEarnings',
    inputs: [{ name: 'app', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'claimEarnings',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimEarningsTo',
    inputs: [{ name: 'recipient', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getCurrentFeeSplits',
    inputs: [],
    outputs: [
      { name: 'appShareBps', type: 'uint16' },
      { name: 'lpShareBps', type: 'uint16' },
      { name: 'contributorShareBps', type: 'uint16' },
      { name: 'ethLpShareBps', type: 'uint16' },
      { name: 'tokenLpShareBps', type: 'uint16' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getStats',
    inputs: [],
    outputs: [
      { name: '_totalDistributed', type: 'uint256' },
      { name: '_totalAppEarnings', type: 'uint256' },
      { name: '_totalLPEarnings', type: 'uint256' },
      { name: '_totalContributorEarnings', type: 'uint256' },
      { name: '_computeFeesCollected', type: 'uint256' },
      { name: '_storageFeesCollected', type: 'uint256' },
      { name: '_contributorPoolBalance', type: 'uint256' },
      { name: '_currentPeriod', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

import { ZERO_ADDRESS } from '@jejunetwork/types'

function getAppFeeRegistry(): Address {
  const state = getSharedState()
  const address = state.contracts.appFeeRegistry
  if (!address || address === ZERO_ADDRESS) {
    throw new Error(
      'AppFeeRegistry address not configured - deploy the contract first',
    )
  }
  return address
}

function getFeeDistributor(): Address {
  const state = getSharedState()
  const address = state.contracts.feeDistributor
  if (!address || address === ZERO_ADDRESS) {
    throw new Error(
      'FeeDistributor address not configured - deploy the contract first',
    )
  }
  return address
}

export const appsRoutes = new Elysia({ prefix: '/apps' })
  /**
   * GET /apps
   * List all apps for the caller or a specific DAO
   */
  .get(
    '/',
    async ({ query }) => {
      const state = getSharedState()
      if (!state.clients.publicClient) {
        return { success: false, error: 'Public client not initialized' }
      }

      const registryAddr = getAppFeeRegistry()

      let appIds: Hex[] = []

      if (query.daoId) {
        appIds = (await state.clients.publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getDAOApps',
          args: [query.daoId as Hex],
        })) as Hex[]
      } else if (query.owner) {
        appIds = (await state.clients.publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getOwnerApps',
          args: [query.owner as Address],
        })) as Hex[]
      }

      // Fetch details for each app
      const apps = await Promise.all(
        appIds.map(async (appId) => {
          const [app, stats] = await Promise.all([
            state.clients.publicClient?.readContract({
              address: registryAddr,
              abi: AppFeeRegistryABI,
              functionName: 'getApp',
              args: [appId],
            }),
            state.clients.publicClient?.readContract({
              address: registryAddr,
              abi: AppFeeRegistryABI,
              functionName: 'getAppStats',
              args: [appId],
            }),
          ])

          return {
            ...app,
            stats,
            appId: app.appId,
            agentId: app.agentId.toString(),
            createdAt: Number(app.createdAt),
            lastActivityAt: Number(app.lastActivityAt),
          }
        }),
      )

      return {
        success: true,
        apps,
        total: apps.length,
      }
    },
    {
      query: t.Object({
        daoId: t.Optional(t.String()),
        owner: t.Optional(t.String()),
      }),
    },
  )

  /**
   * GET /apps/:appId
   * Get app details by ID
   */
  .get(
    '/:appId',
    async ({ params }) => {
      const state = getSharedState()
      if (!state.clients.publicClient) {
        return { success: false, error: 'Public client not initialized' }
      }

      const registryAddr = getAppFeeRegistry()
      const distributorAddr = getFeeDistributor()

      const [app, stats] = await Promise.all([
        state.clients.publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getApp',
          args: [params.appId as Hex],
        }),
        state.clients.publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getAppStats',
          args: [params.appId as Hex],
        }),
      ])

      // Get pending earnings from FeeDistributor
      const pendingEarnings = await state.clients.publicClient.readContract({
        address: distributorAddr,
        abi: FeeDistributorABI,
        functionName: 'getEarnings',
        args: [app.feeRecipient],
      })

      return {
        success: true,
        app: {
          ...app,
          appId: app.appId,
          agentId: app.agentId.toString(),
          createdAt: Number(app.createdAt),
          lastActivityAt: Number(app.lastActivityAt),
        },
        stats: {
          totalTransactions: stats.totalTransactions.toString(),
          totalFeesEarned: stats.totalFeesEarned.toString(),
          totalFeesClaimed: stats.totalFeesClaimed.toString(),
          lastClaimAt: Number(stats.lastClaimAt),
          pendingEarnings: pendingEarnings.toString(),
        },
      }
    },
    {
      params: t.Object({
        appId: t.String(),
      }),
    },
  )

  /**
   * POST /apps/register
   * Register a new app for fee eligibility
   */
  .post(
    '/register',
    async ({ body }) => {
      const state = getSharedState()
      if (!state.clients.walletClient) {
        return {
          success: false,
          error: 'Wallet client not initialized - write operations unavailable',
        }
      }

      const registryAddr = getAppFeeRegistry()

      const daoIdBytes =
        body.daoId && body.daoId !== ''
          ? (body.daoId as Hex)
          : (`0x${'0'.repeat(64)}` as Hex)

      const hash = await state.clients.walletClient.writeContract({
        chain: null,
        account: null,
        address: registryAddr,
        abi: AppFeeRegistryABI,
        functionName: 'registerApp',
        args: [
          body.name,
          body.description,
          body.primaryContract as Address,
          body.feeRecipient as Address,
          daoIdBytes,
        ],
      })

      return {
        success: true,
        txHash: hash,
        message:
          'App registration submitted. Apps receive 45% of all network fees.',
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.String(),
        primaryContract: t.String(),
        feeRecipient: t.String(),
        daoId: t.Optional(t.String()),
      }),
    },
  )

  /**
   * POST /apps/:appId/contracts
   * Add additional contract to an app
   */
  .post(
    '/:appId/contracts',
    async ({ params, body }) => {
      const state = getSharedState()
      if (!state.clients.walletClient) {
        return {
          success: false,
          error: 'Wallet client not initialized',
        }
      }

      const registryAddr = getAppFeeRegistry()

      const hash = await state.clients.walletClient.writeContract({
        chain: null,
        account: null,
        address: registryAddr,
        abi: AppFeeRegistryABI,
        functionName: 'addAppContract',
        args: [params.appId as Hex, body.contractAddress as Address],
      })

      return {
        success: true,
        txHash: hash,
        message:
          'Contract added. Transactions from this contract will now earn fees.',
      }
    },
    {
      params: t.Object({
        appId: t.String(),
      }),
      body: t.Object({
        contractAddress: t.String(),
      }),
    },
  )

  /**
   * GET /apps/contract/:address
   * Check if a contract is registered and eligible for fees
   */
  .get(
    '/contract/:address',
    async ({ params }) => {
      const state = getSharedState()
      if (!state.clients.publicClient) {
        return { success: false, error: 'Public client not initialized' }
      }

      const registryAddr = getAppFeeRegistry()

      const [appId, isEligible] = await Promise.all([
        state.clients.publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getAppForContract',
          args: [params.address as Address],
        }),
        state.clients.publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'isEligibleForFees',
          args: [params.address as Address],
        }),
      ])

      const isRegistered = appId !== `0x${'0'.repeat(64)}`

      return {
        success: true,
        contractAddress: params.address,
        isRegistered,
        isEligible,
        appId: isRegistered ? appId : null,
      }
    },
    {
      params: t.Object({
        address: t.String(),
      }),
    },
  )

  /**
   * GET /apps/fees/summary
   * Get network-wide fee distribution summary
   */
  .get('/fees/summary', async () => {
    const state = getSharedState()
    if (!state.clients.publicClient) {
      return { success: false, error: 'Public client not initialized' }
    }

    const distributorAddr = getFeeDistributor()

    const [splits, stats] = await Promise.all([
      state.clients.publicClient.readContract({
        address: distributorAddr,
        abi: FeeDistributorABI,
        functionName: 'getCurrentFeeSplits',
      }),
      state.clients.publicClient.readContract({
        address: distributorAddr,
        abi: FeeDistributorABI,
        functionName: 'getStats',
      }),
    ])

    return {
      success: true,
      feeSplits: {
        appShare: `${Number(splits[0]) / 100}%`,
        lpShare: `${Number(splits[1]) / 100}%`,
        contributorShare: `${Number(splits[2]) / 100}%`,
        networkShare: '0%', // Core principle: network gets nothing
        ethLpShare: `${Number(splits[3]) / 100}% of LP`,
        tokenLpShare: `${Number(splits[4]) / 100}% of LP`,
      },
      networkStats: {
        totalDistributed: stats[0].toString(),
        totalAppEarnings: stats[1].toString(),
        totalLPEarnings: stats[2].toString(),
        totalContributorEarnings: stats[3].toString(),
        computeFeesCollected: stats[4].toString(),
        storageFeesCollected: stats[5].toString(),
        contributorPoolBalance: stats[6].toString(),
        currentPeriod: Number(stats[7]),
      },
      principle: 'Network gets 0% - all fees go to apps and community',
    }
  })

  /**
   * GET /apps/:appId/earnings
   * Get pending earnings for an app
   */
  .get(
    '/:appId/earnings',
    async ({ params }) => {
      const state = getSharedState()
      if (!state.clients.publicClient) {
        return { success: false, error: 'Public client not initialized' }
      }

      const registryAddr = getAppFeeRegistry()
      const distributorAddr = getFeeDistributor()

      const app = await state.clients.publicClient.readContract({
        address: registryAddr,
        abi: AppFeeRegistryABI,
        functionName: 'getApp',
        args: [params.appId as Hex],
      })

      const pendingEarnings = await state.clients.publicClient.readContract({
        address: distributorAddr,
        abi: FeeDistributorABI,
        functionName: 'getEarnings',
        args: [app.feeRecipient],
      })

      return {
        success: true,
        appId: params.appId,
        feeRecipient: app.feeRecipient,
        pendingEarnings: pendingEarnings.toString(),
        canClaim: pendingEarnings > 0n,
      }
    },
    {
      params: t.Object({
        appId: t.String(),
      }),
    },
  )

  /**
   * POST /apps/:appId/claim
   * Claim accumulated fees for an app
   */
  .post(
    '/:appId/claim',
    async ({ params: _params, body }) => {
      // Note: params.appId is available but claim is based on msg.sender (walletClient's account)
      const state = getSharedState()
      if (!state.clients.walletClient) {
        return {
          success: false,
          error: 'Wallet client not initialized',
        }
      }

      const distributorAddr = getFeeDistributor()

      let hash: Hash

      if (body?.recipient) {
        hash = await state.clients.walletClient.writeContract({
          chain: null,
          account: null,
          address: distributorAddr,
          abi: FeeDistributorABI,
          functionName: 'claimEarningsTo',
          args: [body.recipient as Address],
        })
      } else {
        hash = await state.clients.walletClient.writeContract({
          chain: null,
          account: null,
          address: distributorAddr,
          abi: FeeDistributorABI,
          functionName: 'claimEarnings',
          args: [],
        })
      }

      return {
        success: true,
        txHash: hash,
        message: 'Fee claim submitted.',
      }
    },
    {
      params: t.Object({
        appId: t.String(),
      }),
      body: t.Optional(
        t.Object({
          recipient: t.Optional(t.String()),
        }),
      ),
    },
  )

  /**
   * POST /apps/:appId/verify
   * Verify an app (only by DAO admin)
   */
  .post(
    '/:appId/verify',
    async ({ params }) => {
      const state = getSharedState()
      if (!state.clients.walletClient) {
        return {
          success: false,
          error: 'Wallet client not initialized',
        }
      }

      const registryAddr = getAppFeeRegistry()

      const hash = await state.clients.walletClient.writeContract({
        chain: null,
        account: null,
        address: registryAddr,
        abi: AppFeeRegistryABI,
        functionName: 'verifyApp',
        args: [params.appId as Hex],
      })

      return {
        success: true,
        txHash: hash,
        message: 'App verification submitted.',
      }
    },
    {
      params: t.Object({
        appId: t.String(),
      }),
    },
  )

  /**
   * POST /apps/:appId/link-agent
   * Link an ERC-8004 agent to the app
   */
  .post(
    '/:appId/link-agent',
    async ({ params, body }) => {
      const state = getSharedState()
      if (!state.clients.walletClient) {
        return {
          success: false,
          error: 'Wallet client not initialized',
        }
      }

      const registryAddr = getAppFeeRegistry()

      const hash = await state.clients.walletClient.writeContract({
        chain: null,
        account: null,
        address: registryAddr,
        abi: AppFeeRegistryABI,
        functionName: 'linkAgent',
        args: [params.appId as Hex, BigInt(body.agentId)],
      })

      return {
        success: true,
        txHash: hash,
        message: 'Agent linked to app.',
      }
    },
    {
      params: t.Object({
        appId: t.String(),
      }),
      body: t.Object({
        agentId: t.String(),
      }),
    },
  )

  /**
   * PUT /apps/:appId/fee-recipient
   * Update fee recipient for an app
   */
  .put(
    '/:appId/fee-recipient',
    async ({ params, body }) => {
      const state = getSharedState()
      if (!state.clients.walletClient) {
        return {
          success: false,
          error: 'Wallet client not initialized',
        }
      }

      const registryAddr = getAppFeeRegistry()

      const hash = await state.clients.walletClient.writeContract({
        chain: null,
        account: null,
        address: registryAddr,
        abi: AppFeeRegistryABI,
        functionName: 'setFeeRecipient',
        args: [params.appId as Hex, body.newRecipient as Address],
      })

      return {
        success: true,
        txHash: hash,
        message: 'Fee recipient updated.',
      }
    },
    {
      params: t.Object({
        appId: t.String(),
      }),
      body: t.Object({
        newRecipient: t.String(),
      }),
    },
  )
