import '@jejunetwork/config'
import {
  expect,
  getOptionalString,
  getString,
  validateOrThrow,
  ZERO_ADDRESS,
} from '@jejunetwork/types'
import { type Address, encodeFunctionData, parseEther } from 'viem'
import { z } from 'zod'

const SkillIdSchema = z
  .object({
    skillId: z.string().min(1),
  })
  .passthrough()

import { CONTRACTS, NETWORK_NAME } from '../config'
import { JEJU_CHAIN_ID } from '../config/chains'
import { getV4Contracts } from '../config/contracts'
import {
  fetchMarketStats,
  fetchNewTokens,
  fetchPredictionMarkets,
  fetchTokenDetails,
  fetchTokensWithMarketData,
  fetchTopGainers,
  fetchTopLosers,
  fetchTrendingTokens,
  type Token,
} from '../lib/data-client'
import type { A2ARequest as A2ARequestType } from '../schemas/api'
import {
  checkBanStatus,
  getModerationCase,
  getModerationCases,
  getModerationStats,
  getModeratorStats,
  prepareChallengeTransaction,
  prepareReportTransaction,
  prepareStakeTransaction,
  prepareVoteTransaction,
} from './moderation-api'

// ABIs for transaction encoding
const SWAP_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

const NFT_MARKETPLACE_ABI = [
  {
    inputs: [{ name: 'listingId', type: 'uint256' }],
    name: 'buyListing',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'nftContract', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'price', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'createListing',
    outputs: [{ name: 'listingId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const PREDICTION_MARKET_ABI = [
  {
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'buyYes', type: 'bool' },
    ],
    name: 'buy',
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

// SkillResult type - use unknown to allow any structured data
export interface SkillResult {
  message: string
  data: unknown
}

// Helper to format token for response
function formatTokenResponse(token: Token) {
  return {
    address: token.address,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    priceUSD: token.priceUSD,
    priceChange24h: token.priceChange24h,
    volume24h: token.volume24h?.toString(),
    liquidityUSD: token.liquidityUSD,
    verified: token.verified,
    createdAt: token.createdAt.toISOString(),
  }
}

function createAgentCard(options: {
  name: string
  description: string
  url?: string
  version?: string
  skills?: Array<{
    id: string
    name: string
    description: string
    tags?: string[]
  }>
}) {
  return {
    protocolVersion: '0.3.0',
    name: `${NETWORK_NAME} ${options.name}`,
    description: options.description,
    url: options.url ?? '/api/a2a',
    preferredTransport: 'http',
    provider: {
      organization: NETWORK_NAME,
      url: 'https://jejunetwork.org',
    },
    version: options.version ?? '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: options.skills ?? [],
  }
}

const BAZAAR_SKILLS = [
  // Token Query Skills
  {
    id: 'list-tokens',
    name: 'List Tokens',
    description: 'Get list of tokens with market data',
    tags: ['query', 'tokens'],
  },
  {
    id: 'get-token',
    name: 'Get Token Details',
    description: 'Get details of a specific token',
    tags: ['query', 'tokens'],
  },
  {
    id: 'get-trending',
    name: 'Get Trending Tokens',
    description: 'Get trending tokens by volume',
    tags: ['query', 'tokens', 'trending'],
  },
  {
    id: 'get-gainers',
    name: 'Get Top Gainers',
    description: 'Get tokens with highest 24h gains',
    tags: ['query', 'tokens'],
  },
  {
    id: 'get-losers',
    name: 'Get Top Losers',
    description: 'Get tokens with highest 24h losses',
    tags: ['query', 'tokens'],
  },
  {
    id: 'get-new-tokens',
    name: 'Get New Tokens',
    description: 'Get recently launched tokens',
    tags: ['query', 'tokens'],
  },

  // Market Stats
  {
    id: 'get-market-stats',
    name: 'Get Market Stats',
    description: 'Get overall marketplace statistics',
    tags: ['query', 'stats'],
  },

  // Prediction Markets
  {
    id: 'list-prediction-markets',
    name: 'List Prediction Markets',
    description: 'Get active prediction markets',
    tags: ['query', 'predictions'],
  },
  {
    id: 'prepare-prediction-buy',
    name: 'Prepare Prediction Buy',
    description: 'Prepare transaction to buy prediction shares',
    tags: ['action', 'predictions'],
  },

  // Token Swap Skills
  {
    id: 'prepare-swap',
    name: 'Prepare Swap',
    description: 'Prepare transaction for token swap',
    tags: ['action', 'swap'],
  },

  // NFT Marketplace Skills
  {
    id: 'prepare-list-nft',
    name: 'Prepare NFT Listing',
    description: 'Prepare transaction to list an NFT for sale',
    tags: ['action', 'nft'],
  },
  {
    id: 'prepare-buy-nft',
    name: 'Prepare NFT Purchase',
    description: 'Prepare transaction to buy an NFT',
    tags: ['action', 'nft'],
  },

  // Moderation Skills
  {
    id: 'check-ban-status',
    name: 'Check Ban Status',
    description: 'Check if an address is banned',
    tags: ['query', 'moderation'],
  },
  {
    id: 'get-moderator-stats',
    name: 'Get Moderator Stats',
    description: 'Get stats for a moderator address',
    tags: ['query', 'moderation'],
  },
  {
    id: 'get-moderation-cases',
    name: 'Get Moderation Cases',
    description: 'Get list of moderation cases',
    tags: ['query', 'moderation'],
  },
  {
    id: 'get-moderation-case',
    name: 'Get Moderation Case',
    description: 'Get details of a specific case',
    tags: ['query', 'moderation'],
  },
  {
    id: 'get-moderation-stats',
    name: 'Get Moderation Stats',
    description: 'Get overall moderation statistics',
    tags: ['query', 'moderation'],
  },
  {
    id: 'prepare-moderation-stake',
    name: 'Prepare Moderation Stake',
    description: 'Prepare transaction to stake as moderator',
    tags: ['action', 'moderation'],
  },
  {
    id: 'prepare-report-user',
    name: 'Prepare Report User',
    description: 'Prepare transaction to report a user',
    tags: ['action', 'moderation'],
  },
  {
    id: 'prepare-vote-on-case',
    name: 'Prepare Vote',
    description: 'Prepare transaction to vote on a case',
    tags: ['action', 'moderation'],
  },
  {
    id: 'prepare-challenge-ban',
    name: 'Prepare Challenge',
    description: 'Prepare transaction to challenge a ban',
    tags: ['action', 'moderation'],
  },
]

export const BAZAAR_AGENT_CARD = createAgentCard({
  name: 'Bazaar',
  description:
    'Decentralized marketplace for token launches, ICOs, and NFT trading',
  skills: BAZAAR_SKILLS,
})

async function executeSkill(
  skillId: string,
  params: Record<string, unknown>,
): Promise<SkillResult> {
  switch (skillId) {
    // Token Query Skills - Real Data
    case 'list-tokens': {
      const limit = params.limit ? Number(params.limit) : 50
      const tokens = await fetchTokensWithMarketData({ limit })
      return {
        message: `Found ${tokens.length} tokens`,
        data: {
          tokens: tokens.map(formatTokenResponse),
          count: tokens.length,
        },
      }
    }

    case 'get-token': {
      const address = getString(params, 'address') as Address
      const token = await fetchTokenDetails(address)
      return {
        message: `Token details for ${token.symbol}`,
        data: formatTokenResponse(token),
      }
    }

    case 'get-trending': {
      const limit = params.limit ? Number(params.limit) : 10
      const tokens = await fetchTrendingTokens({ limit })
      return {
        message: `Top ${tokens.length} trending tokens`,
        data: {
          tokens: tokens.map(formatTokenResponse),
        },
      }
    }

    case 'get-gainers': {
      const limit = params.limit ? Number(params.limit) : 10
      const tokens = await fetchTopGainers({ limit })
      return {
        message: `Top ${tokens.length} gainers`,
        data: {
          tokens: tokens.map(formatTokenResponse),
        },
      }
    }

    case 'get-losers': {
      const limit = params.limit ? Number(params.limit) : 10
      const tokens = await fetchTopLosers({ limit })
      return {
        message: `Top ${tokens.length} losers`,
        data: {
          tokens: tokens.map(formatTokenResponse),
        },
      }
    }

    case 'get-new-tokens': {
      const limit = params.limit ? Number(params.limit) : 20
      const hours = params.hours ? Number(params.hours) : 24
      const tokens = await fetchNewTokens({ limit, hours })
      return {
        message: `${tokens.length} new tokens in last ${hours}h`,
        data: {
          tokens: tokens.map(formatTokenResponse),
        },
      }
    }

    // Market Stats - Real Data
    case 'get-market-stats': {
      const stats = await fetchMarketStats()
      return {
        message: 'Market statistics',
        data: {
          totalTokens: stats.totalTokens,
          activeTokens24h: stats.activeTokens24h,
          totalPools: stats.totalPools,
          totalVolumeUSD24h: stats.totalVolumeUSD24h,
          totalLiquidityUSD: stats.totalLiquidityUSD,
          totalSwaps24h: stats.totalSwaps24h,
        },
      }
    }

    // Prediction Markets - Real Data
    case 'list-prediction-markets': {
      const limit = params.limit ? Number(params.limit) : 20
      const markets = await fetchPredictionMarkets({ limit })
      return {
        message: `Found ${markets.length} prediction markets`,
        data: {
          markets: markets.map((m) => ({
            id: m.id,
            question: m.question,
            yesPrice: m.yesPrice,
            noPrice: m.noPrice,
            totalVolume: m.totalVolume.toString(),
            liquidity: m.liquidity.toString(),
            resolved: m.resolved,
            outcome: m.outcome,
            createdAt: m.createdAt.toISOString(),
          })),
        },
      }
    }

    case 'prepare-prediction-buy': {
      const marketId = getString(params, 'marketId')
      const amount = getString(params, 'amount')
      const buyYes = params.buyYes === true

      const calldata = encodeFunctionData({
        abi: PREDICTION_MARKET_ABI,
        functionName: 'buy',
        args: [marketId as `0x${string}`, parseEther(amount), buyYes],
      })

      return {
        message: `Prepare ${buyYes ? 'YES' : 'NO'} buy for ${amount} ETH`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: CONTRACTS.predictionMarket,
            data: calldata,
            value: parseEther(amount).toString(),
          },
        },
      }
    }

    // Swap - Real Calldata
    case 'prepare-swap': {
      const tokenIn = getString(params, 'tokenIn') as Address
      const tokenOut = getString(params, 'tokenOut') as Address
      const amountIn = getString(params, 'amountIn')
      const recipient = getOptionalString(params, 'recipient') as
        | Address
        | undefined

      const v4Contracts = getV4Contracts(JEJU_CHAIN_ID)
      const swapRouter = expect(
        v4Contracts.swapRouter,
        'Swap router not deployed',
      )

      const calldata = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn,
            tokenOut,
            fee: 3000, // 0.3%
            recipient: recipient ?? (ZERO_ADDRESS as Address),
            amountIn: parseEther(amountIn),
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n,
          },
        ],
      })

      const isNativeInput = tokenIn.toLowerCase() === ZERO_ADDRESS.toLowerCase()

      return {
        message: 'Swap transaction prepared',
        data: {
          action: 'sign-and-send',
          transaction: {
            to: swapRouter,
            data: calldata,
            value: isNativeInput ? parseEther(amountIn).toString() : '0',
          },
          approvalRequired: !isNativeInput,
          approvalToken: isNativeInput ? undefined : tokenIn,
          approvalAmount: isNativeInput ? undefined : amountIn,
        },
      }
    }

    // NFT Marketplace - Real Calldata
    case 'prepare-list-nft': {
      const nftContract = getString(params, 'nftContract') as Address
      const tokenId = getString(params, 'tokenId')
      const price = getString(params, 'price')
      const durationDays = params.durationDays ? Number(params.durationDays) : 7

      const marketplace = expect(
        CONTRACTS.nftMarketplace,
        'NFT marketplace not deployed',
      )

      const calldata = encodeFunctionData({
        abi: NFT_MARKETPLACE_ABI,
        functionName: 'createListing',
        args: [
          nftContract,
          BigInt(tokenId),
          parseEther(price),
          BigInt(durationDays * 24 * 60 * 60),
        ],
      })

      return {
        message: `Prepare listing for token ${tokenId}`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: marketplace,
            data: calldata,
            value: '0',
          },
          approvalRequired: true,
          approvalContract: nftContract,
          approvalTokenId: tokenId,
        },
      }
    }

    case 'prepare-buy-nft': {
      const listingId = getString(params, 'listingId')
      const price = getString(params, 'price')

      const marketplace = expect(
        CONTRACTS.nftMarketplace,
        'NFT marketplace not deployed',
      )

      const calldata = encodeFunctionData({
        abi: NFT_MARKETPLACE_ABI,
        functionName: 'buyListing',
        args: [BigInt(listingId)],
      })

      return {
        message: `Prepare purchase of listing ${listingId}`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: marketplace,
            data: calldata,
            value: parseEther(price).toString(),
          },
        },
      }
    }

    // Moderation - Real Data
    case 'check-ban-status': {
      const address = getString(params, 'address') as Address
      const status = await checkBanStatus(address)
      return {
        message: status.isBanned
          ? `Address is ${status.isOnNotice ? 'on notice' : 'banned'}`
          : 'Address is not banned',
        data: status,
      }
    }

    case 'get-moderator-stats': {
      const address = getString(params, 'address') as Address
      const stats = await getModeratorStats(address)
      const validatedStats = expect(stats, 'Could not fetch moderator stats')
      return {
        message: validatedStats.isStaked
          ? `${validatedStats.tier} moderator`
          : 'Not a staked moderator',
        data: validatedStats,
      }
    }

    case 'get-moderation-cases': {
      const activeOnly = params.activeOnly === true
      const resolvedOnly = params.resolvedOnly === true
      const limit = params.limit ? Number(params.limit) : 20
      const cases = await getModerationCases({
        activeOnly,
        resolvedOnly,
        limit,
      })
      return {
        message: `Found ${cases.length} moderation cases`,
        data: { cases, count: cases.length },
      }
    }

    case 'get-moderation-case': {
      const caseId = getString(params, 'caseId')
      const caseData = await getModerationCase(caseId)
      const validatedCase = expect(caseData, 'Case not found')
      return {
        message: `Case ${validatedCase.status}`,
        data: validatedCase,
      }
    }

    case 'get-moderation-stats': {
      const stats = await getModerationStats()
      return {
        message: `Total: ${stats.totalCases}, Active: ${stats.activeCases}`,
        data: stats,
      }
    }

    case 'prepare-moderation-stake': {
      const amount = getString(params, 'amount')
      const tx = prepareStakeTransaction(amount)
      return {
        message: 'Stake transaction prepared',
        data: { action: 'sign-and-send', transaction: tx },
      }
    }

    case 'prepare-report-user': {
      const target = getString(params, 'target')
      const reason = getString(params, 'reason')
      const evidenceHash = getString(params, 'evidenceHash')
      const tx = prepareReportTransaction(target, reason, evidenceHash)
      return {
        message: 'Report transaction prepared',
        data: { action: 'sign-and-send', transaction: tx },
      }
    }

    case 'prepare-vote-on-case': {
      const caseId = getString(params, 'caseId')
      const voteYes = params.voteYes === true
      const tx = prepareVoteTransaction(caseId, voteYes)
      return {
        message: `Vote ${voteYes ? 'BAN' : 'CLEAR'} transaction prepared`,
        data: { action: 'sign-and-send', transaction: tx },
      }
    }

    case 'prepare-challenge-ban': {
      const caseId = getString(params, 'caseId')
      const stakeAmount = getString(params, 'stakeAmount')
      const tx = prepareChallengeTransaction(caseId, stakeAmount)
      return {
        message: 'Challenge transaction prepared',
        data: { action: 'sign-and-send', transaction: tx },
      }
    }

    default:
      return {
        message: 'Unknown skill',
        data: {
          error: `Skill '${skillId}' not found`,
          availableSkills: BAZAAR_AGENT_CARD.skills.map((s) => s.id),
        },
      }
  }
}

export async function handleA2ARequest(
  _request: Request,
  validatedBody: A2ARequestType,
): Promise<Response> {
  if (validatedBody.method !== 'message/send') {
    throw new Error(`Method not found: ${validatedBody.method}`)
  }

  const message = expect(validatedBody.params?.message, 'Message is required')
  const parts = expect(message.parts, 'Message parts are required')

  type MessagePart = {
    kind: string
    text?: string
    data?: Record<string, unknown>
  }
  const dataPart = expect(
    parts.find((p: MessagePart) => p.kind === 'data'),
    'Data part is required',
  )
  const dataPartData = expect(dataPart.data, 'Data part data is required')

  const { skillId } = validateOrThrow(SkillIdSchema, dataPartData, 'Skill data')
  const result = await executeSkill(skillId, dataPartData)

  return Response.json({
    jsonrpc: '2.0',
    id: validatedBody.id,
    result: {
      role: 'agent',
      parts: [
        { kind: 'text', text: result.message },
        { kind: 'data', data: result.data },
      ],
      messageId: message.messageId,
      kind: 'message',
    },
  })
}

export function handleAgentCard(): Response {
  return Response.json(BAZAAR_AGENT_CARD)
}
