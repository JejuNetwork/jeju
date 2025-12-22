/**
 * Leaderboard → Funding Integration
 *
 * Syncs leaderboard scores to DeepFundingDistributor weights.
 * This creates the bridge between contribution tracking and funding distribution.
 *
 * Flow:
 * 1. Leaderboard tracks Git, NPM, and community contributions
 * 2. Scores are aggregated by contributor
 * 3. Contributor wallets are looked up from ContributorRegistry
 * 4. Weights are set on DeepFundingDistributor
 */

import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  leaderboardPreviewRequestSchema,
  leaderboardSyncRequestSchema,
} from '../../shared/schemas'

// ============ Types ============

interface LeaderboardEntry {
  username: string
  wallet?: string
  totalScore: number
  breakdown: {
    prScore: number
    issueScore: number
    reviewScore: number
    commitScore: number
  }
}

// ============ ABIs ============

const CONTRIBUTOR_REGISTRY_ABI = [
  {
    name: 'getContributorByWallet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [
      { type: 'bytes32' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint8' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bool' },
    ],
  },
  {
    name: 'getSocialLinks',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'contributorId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'platform', type: 'bytes32' },
          { name: 'handle', type: 'string' },
          { name: 'proofHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'verifiedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
        ],
      },
    ],
  },
] as const

const DEEP_FUNDING_DISTRIBUTOR_ABI = parseAbi([
  'function setContributorWeight(bytes32 daoId, bytes32 contributorId, uint256 weight) external',
])

// ============ Leaderboard Fetcher ============

async function fetchLeaderboard(
  limit: number = 50,
): Promise<LeaderboardEntry[]> {
  const leaderboardUrl = process.env.LEADERBOARD_URL || 'http://127.0.0.1:3002'

  const response = await fetch(
    `${leaderboardUrl}/api/leaderboard?limit=${limit}`,
  )
  if (!response.ok) {
    throw new Error(`Leaderboard fetch failed: ${response.status}`)
  }

  const data = (await response.json()) as { contributors: LeaderboardEntry[] }
  return data.contributors || []
}

// ============ Score to Weight Conversion ============

const MAX_WEIGHT = 10000 // Max basis points

function scoreToWeight(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0
  // Normalize to basis points, cap at 1000 (10% max for any single contributor)
  return Math.min(Math.floor((score / maxScore) * MAX_WEIGHT), 1000)
}

// ============ Sync Logic ============

async function syncLeaderboardToFunding(
  daoId: string,
  limit: number = 50,
): Promise<{ synced: number; errors: string[] }> {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:6546'
  const adminKey = process.env.DAO_ADMIN_PRIVATE_KEY
  const contributorRegistryAddress = process.env
    .CONTRIBUTOR_REGISTRY_ADDRESS as Address
  const distributorAddress = process.env
    .DEEP_FUNDING_DISTRIBUTOR_ADDRESS as Address

  if (!adminKey) {
    return { synced: 0, errors: ['DAO_ADMIN_PRIVATE_KEY not configured'] }
  }

  const account = privateKeyToAccount(adminKey as Hex)
  const publicClient = createPublicClient({ transport: http(rpcUrl) })
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  })

  const errors: string[] = []
  let synced = 0

  // Fetch leaderboard
  const leaderboard = await fetchLeaderboard(limit)
  if (leaderboard.length === 0) {
    return { synced: 0, errors: ['No leaderboard data'] }
  }

  const maxScore = Math.max(...leaderboard.map((e) => e.totalScore))

  for (const entry of leaderboard) {
    // Look up contributor by GitHub handle
    // First, we need to find contributors with verified GitHub matching this username
    // This is a simplified version - in production, you'd query by social link

    if (!entry.wallet) {
      continue // Skip if no wallet linked
    }

    // Get contributor ID from wallet
    const contributorData = (await publicClient.readContract({
      address: contributorRegistryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributorByWallet',
      args: [entry.wallet as Address],
    })) as [
      Hex,
      Address,
      bigint,
      number,
      string,
      bigint,
      bigint,
      bigint,
      boolean,
    ]

    const contributorId = contributorData[0]

    if (contributorId === `0x${'0'.repeat(64)}`) {
      continue // Not registered
    }

    // Calculate weight
    const weight = scoreToWeight(entry.totalScore, maxScore)

    if (weight < 10) {
      continue // Below minimum threshold
    }

    // Set weight on distributor
    await walletClient.writeContract({
      address: distributorAddress,
      abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
      functionName: 'setContributorWeight',
      args: [daoId as Hex, contributorId, BigInt(weight)],
    })

    synced++
    console.log(
      `[LeaderboardFunding] Set weight ${weight} for ${entry.username}`,
    )
  }

  return { synced, errors }
}

// ============ Router ============

export function createLeaderboardFundingRouter() {
  let router = new Elysia({
    name: 'leaderboard-funding',
    prefix: '/leaderboard-funding',
  })

  // Trigger sync
  router = router.post('/sync', async ({ body }) => {
    const validBody = expectValid(
      leaderboardSyncRequestSchema,
      body,
      'Leaderboard sync request',
    )

    const result = await syncLeaderboardToFunding(
      validBody.daoId,
      validBody.limit ?? 50,
    )
    return result
  })

  // Preview sync (dry run)
  router = router.post('/preview', async ({ body }) => {
    const validBody = expectValid(
      leaderboardPreviewRequestSchema,
      body,
      'Leaderboard preview request',
    )

    const leaderboard = await fetchLeaderboard(validBody.limit ?? 50)
    if (leaderboard.length === 0) {
      return { contributors: [], maxScore: 0 }
    }

    const maxScore = Math.max(...leaderboard.map((e) => e.totalScore))

    const preview = leaderboard.map((entry) => ({
      username: entry.username,
      wallet: entry.wallet,
      score: entry.totalScore,
      suggestedWeight: scoreToWeight(entry.totalScore, maxScore),
      hasWallet: !!entry.wallet,
    }))

    return {
      contributors: preview,
      maxScore,
      totalWithWallets: preview.filter((p) => p.hasWallet).length,
    }
  })

  // Health
  router = router.get('/health', async () => {
    const leaderboardUrl =
      process.env.LEADERBOARD_URL || 'http://127.0.0.1:3002'

    let leaderboardUp = false
    try {
      const response = await fetch(`${leaderboardUrl}/health`)
      leaderboardUp = response.ok
    } catch {
      // Leaderboard not reachable
    }

    return {
      leaderboardUrl,
      leaderboardUp,
      configured: !!process.env.DAO_ADMIN_PRIVATE_KEY,
    }
  })

  return router
}
