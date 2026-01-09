import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { formatEther } from 'viem'
import { getSharedState } from '../shared-state'

// AppFeeRegistry ABI (minimal for read/write operations)
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
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOwnerApps',
    inputs: [{ name: 'ownerAddr', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAppCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isEligibleForFees',
    inputs: [{ name: 'contractAddr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFeeRecipient',
    inputs: [{ name: 'contractAddr', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'contractToApp',
    inputs: [{ name: 'contractAddr', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
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
] as const

// FeeDistributor ABI (for claiming and stats)
const FeeDistributorABI = [
  {
    type: 'function',
    name: 'appEarnings',
    inputs: [{ name: 'appAddress', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalAppEarnings',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalLPEarnings',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalContributorEarnings',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalDistributed',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'contributorPoolBalance',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'claimAppFees',
    inputs: [{ name: 'appAddress', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

function getAppFeeRegistry(): Address {
  const state = getSharedState()
  return state.contracts.appFeeRegistry
}

function getFeeDistributor(): Address {
  const state = getSharedState()
  return state.contracts.feeDistributor
}

export const appsRoutes = new Elysia({ prefix: '/apps' })
  /**
   * GET /apps
   * List all apps, optionally filtered by DAO or owner
   */
  .get(
    '/',
    async ({ query }) => {
      const state = getSharedState()
      const publicClient = state.clients.publicClient
      if (!publicClient) {
        return { success: false, error: 'Public client not initialized' }
      }

      const registryAddr = getAppFeeRegistry()
      if (registryAddr === '0x0000000000000000000000000000000000000000') {
        return { success: false, error: 'AppFeeRegistry not configured' }
      }

      let appIds: Hex[] = []

      if (query.daoId) {
        appIds = (await publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getDAOApps',
          args: [query.daoId as Hex],
        })) as Hex[]
      } else if (query.owner) {
        appIds = (await publicClient.readContract({
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
            publicClient.readContract({
              address: registryAddr,
              abi: AppFeeRegistryABI,
              functionName: 'getApp',
              args: [appId],
            }),
            publicClient.readContract({
              address: registryAddr,
              abi: AppFeeRegistryABI,
              functionName: 'getAppStats',
              args: [appId],
            }),
          ])

          return {
            ...app,
            stats: {
              totalTransactions: stats.totalTransactions.toString(),
              totalFeesEarned: formatEther(stats.totalFeesEarned),
              totalFeesClaimed: formatEther(stats.totalFeesClaimed),
              lastClaimAt: Number(stats.lastClaimAt),
            },
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
   * Get details for a specific app
   */
  .get(
    '/:appId',
    async ({ params }) => {
      const state = getSharedState()
      const publicClient = state.clients.publicClient
      if (!publicClient) {
        return { success: false, error: 'Public client not initialized' }
      }

      const registryAddr = getAppFeeRegistry()
      if (registryAddr === '0x0000000000000000000000000000000000000000') {
        return { success: false, error: 'AppFeeRegistry not configured' }
      }

      const [app, stats] = await Promise.all([
        publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getApp',
          args: [params.appId as Hex],
        }),
        publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getAppStats',
          args: [params.appId as Hex],
        }),
      ])

      if (app.createdAt === 0n) {
        return { success: false, error: 'App not found' }
      }

      return {
        success: true,
        app: {
          ...app,
          stats: {
            totalTransactions: stats.totalTransactions.toString(),
            totalFeesEarned: formatEther(stats.totalFeesEarned),
            totalFeesClaimed: formatEther(stats.totalFeesClaimed),
            unclaimedFees: formatEther(
              stats.totalFeesEarned - stats.totalFeesClaimed,
            ),
            lastClaimAt: Number(stats.lastClaimAt),
          },
          agentId: app.agentId.toString(),
          createdAt: Number(app.createdAt),
          lastActivityAt: Number(app.lastActivityAt),
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
   * GET /apps/contract/:address
   * Get app info for a contract address
   */
  .get(
    '/contract/:address',
    async ({ params }) => {
      const state = getSharedState()
      const publicClient = state.clients.publicClient
      if (!publicClient) {
        return { success: false, error: 'Public client not initialized' }
      }

      const registryAddr = getAppFeeRegistry()
      if (registryAddr === '0x0000000000000000000000000000000000000000') {
        return { success: false, error: 'AppFeeRegistry not configured' }
      }

      const appId = await publicClient.readContract({
        address: registryAddr,
        abi: AppFeeRegistryABI,
        functionName: 'contractToApp',
        args: [params.address as Address],
      })

      if (
        appId ===
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ) {
        return { success: false, error: 'Contract not registered to any app' }
      }

      const [app, isEligible, feeRecipient] = await Promise.all([
        publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getApp',
          args: [appId],
        }),
        publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'isEligibleForFees',
          args: [params.address as Address],
        }),
        publicClient.readContract({
          address: registryAddr,
          abi: AppFeeRegistryABI,
          functionName: 'getFeeRecipient',
          args: [params.address as Address],
        }),
      ])

      return {
        success: true,
        appId,
        app: {
          name: app.name,
          isActive: app.isActive,
          isVerified: app.isVerified,
        },
        isEligible,
        feeRecipient,
      }
    },
    {
      params: t.Object({
        address: t.String(),
      }),
    },
  )

  /**
   * GET /apps/stats
   * Get network-wide fee distribution stats
   */
  .get('/stats', async () => {
    const state = getSharedState()
    const publicClient = state.clients.publicClient
    if (!publicClient) {
      return { success: false, error: 'Public client not initialized' }
    }

    const registryAddr = getAppFeeRegistry()
    const distributorAddr = getFeeDistributor()

    const appCount =
      registryAddr !== '0x0000000000000000000000000000000000000000'
        ? await publicClient.readContract({
            address: registryAddr,
            abi: AppFeeRegistryABI,
            functionName: 'getAppCount',
          })
        : 0n

    let stats = {
      totalDistributed: '0',
      totalAppEarnings: '0',
      totalLPEarnings: '0',
      totalContributorEarnings: '0',
      contributorPoolBalance: '0',
    }

    if (distributorAddr !== '0x0000000000000000000000000000000000000000') {
      const [
        totalDistributed,
        totalAppEarnings,
        totalLPEarnings,
        totalContributorEarnings,
        contributorPoolBalance,
      ] = await Promise.all([
        publicClient.readContract({
          address: distributorAddr,
          abi: FeeDistributorABI,
          functionName: 'totalDistributed',
        }),
        publicClient.readContract({
          address: distributorAddr,
          abi: FeeDistributorABI,
          functionName: 'totalAppEarnings',
        }),
        publicClient.readContract({
          address: distributorAddr,
          abi: FeeDistributorABI,
          functionName: 'totalLPEarnings',
        }),
        publicClient.readContract({
          address: distributorAddr,
          abi: FeeDistributorABI,
          functionName: 'totalContributorEarnings',
        }),
        publicClient.readContract({
          address: distributorAddr,
          abi: FeeDistributorABI,
          functionName: 'contributorPoolBalance',
        }),
      ])

      stats = {
        totalDistributed: formatEther(totalDistributed),
        totalAppEarnings: formatEther(totalAppEarnings),
        totalLPEarnings: formatEther(totalLPEarnings),
        totalContributorEarnings: formatEther(totalContributorEarnings),
        contributorPoolBalance: formatEther(contributorPoolBalance),
      }
    }

    return {
      success: true,
      registeredApps: Number(appCount),
      feeSplit: {
        apps: '45%',
        liquidityProviders: '45%',
        contributors: '10%',
        network: '0%',
      },
      ...stats,
    }
  })

  /**
   * GET /apps/:appId/earnings
   * Get unclaimed earnings for an app
   */
  .get(
    '/:appId/earnings',
    async ({ params }) => {
      const state = getSharedState()
      const publicClient = state.clients.publicClient
      if (!publicClient) {
        return { success: false, error: 'Public client not initialized' }
      }

      const registryAddr = getAppFeeRegistry()
      const distributorAddr = getFeeDistributor()

      if (registryAddr === '0x0000000000000000000000000000000000000000') {
        return { success: false, error: 'AppFeeRegistry not configured' }
      }

      // Get app to find the primary contract
      const app = await publicClient.readContract({
        address: registryAddr,
        abi: AppFeeRegistryABI,
        functionName: 'getApp',
        args: [params.appId as Hex],
      })

      if (app.createdAt === 0n) {
        return { success: false, error: 'App not found' }
      }

      // Get earnings from FeeDistributor
      let earnings = 0n
      if (distributorAddr !== '0x0000000000000000000000000000000000000000') {
        earnings = await publicClient.readContract({
          address: distributorAddr,
          abi: FeeDistributorABI,
          functionName: 'appEarnings',
          args: [app.primaryContract],
        })
      }

      return {
        success: true,
        appId: params.appId,
        appName: app.name,
        primaryContract: app.primaryContract,
        feeRecipient: app.feeRecipient,
        unclaimedEarnings: formatEther(earnings),
        unclaimedEarningsWei: earnings.toString(),
      }
    },
    {
      params: t.Object({
        appId: t.String(),
      }),
    },
  )
