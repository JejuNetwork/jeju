/**
 * Leaderboard → Funding Integration
 */

import { cors } from '@elysiajs/cors'
import { Elysia, t } from 'elysia'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

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

const MAX_WEIGHT = 10000

async function fetchLeaderboard(
  limit: number = 50,
): Promise<LeaderboardEntry[]> {
  const leaderboardUrl = process.env.LEADERBOARD_URL || 'http://127.0.0.1:3002'

  const response = await fetch(
    `${leaderboardUrl}/api/leaderboard?limit=${limit}`,
  )
  if (!response.ok) return []

  const data = (await response.json()) as { contributors: LeaderboardEntry[] }
  return data.contributors || []
}

function scoreToWeight(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0
  return Math.min(Math.floor((score / maxScore) * MAX_WEIGHT), 1000)
}

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
  const walletClient = createWalletClient({ account, transport: http(rpcUrl) })

  const errors: string[] = []
  let synced = 0

  const leaderboard = await fetchLeaderboard(limit)
  if (leaderboard.length === 0) {
    return { synced: 0, errors: ['No leaderboard data'] }
  }

  const maxScore = Math.max(...leaderboard.map((e) => e.totalScore))

  for (const entry of leaderboard) {
    if (!entry.wallet) continue

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
    if (contributorId === `0x${'0'.repeat(64)}`) continue

    const weight = scoreToWeight(entry.totalScore, maxScore)
    if (weight < 10) continue

    await walletClient
      .writeContract({
        address: distributorAddress,
        abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
        functionName: 'setContributorWeight',
        args: [daoId as Hex, contributorId, BigInt(weight)],
        chain: walletClient.chain ?? null,
        account: walletClient.account ?? null,
      })
      .catch((err) => {
        errors.push(
          `${entry.username}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        )
      })

    synced++
  }

  return { synced, errors }
}

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'

export function createLeaderboardFundingRouter() {
  return new Elysia()
    .use(
      cors({
        origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
        credentials: true,
      }),
    )
    .post(
      '/sync',
      async ({ body }) => {
        const result = await syncLeaderboardToFunding(
          body.daoId,
          body.limit || 50,
        )
        return result
      },
      { body: t.Object({ daoId: t.String(), limit: t.Optional(t.Number()) }) },
    )
    .post(
      '/preview',
      async ({ body }) => {
        const leaderboard = await fetchLeaderboard(body.limit || 50)
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
      },
      { body: t.Object({ limit: t.Optional(t.Number()) }) },
    )
    .get('/health', async () => {
      const leaderboardUrl =
        process.env.LEADERBOARD_URL || 'http://127.0.0.1:3002'

      const response = await fetch(`${leaderboardUrl}/health`)
      const leaderboardUp = response.ok

      return {
        leaderboardUrl,
        leaderboardUp,
        configured: !!process.env.DAO_ADMIN_PRIVATE_KEY,
      }
    })
}
