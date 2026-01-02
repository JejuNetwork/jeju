/**
 * MCP Tools business logic
 * Shared between API routes and hooks
 */

import {
  AddressSchema,
  expect,
  expectPositive,
  expectValid,
  ZERO_ADDRESS,
} from '@jejunetwork/types'
import { type Address, encodeFunctionData, parseEther } from 'viem'
import { z } from 'zod'
import { JEJU_CHAIN_ID } from '../../config/chains'
import { getV4Contracts } from '../../config/contracts'

// Swap Router ABI for encoding calldata
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

import {
  getContractDetails,
  getLatestBlocks,
  getNetworkTokens,
  getTokenHolders,
  getTokenTransfers,
} from '../indexer-client'
import {
  type BanStatus,
  checkBanStatus,
  getModerationCase,
  getModerationCases,
  getModerationStats,
  getModeratorStats,
  type ModerationCase,
  type ModerationStats,
  type ModeratorProfile,
  prepareChallengeTransaction,
  prepareReportTransaction,
  prepareStakeTransaction,
  prepareVoteTransaction,
  type TransactionRequest,
} from '../moderation-api'

// Result data types for each tool
interface TokenInfo {
  address: string
  creator: string
  isERC20: boolean
}

interface BlockInfo {
  number: number
  hash: string
  timestamp: string
}

interface TokenListResult {
  tokens: TokenInfo[]
}

interface BlockListResult {
  blocks: BlockInfo[]
}

interface TokenDetailsResult {
  id: string
  address: string
  contractType: string
  isERC20: boolean
  isERC721: boolean
  isERC1155: boolean
  creator: { address: string }
  creationTransaction: { hash: string }
  creationBlock: { number: number; timestamp: string }
  firstSeenAt: string
  lastSeenAt: string
  topHolders: Array<{
    id: string
    balance: string
    account: { address: string; firstSeenBlock: number }
    lastUpdated: string
    transferCount: number
  }>
  recentTransfers: Array<{
    id: string
    tokenStandard: string
    from: { address: string }
    to: { address: string }
    value: string
    timestamp: string
    transaction: { hash: string }
    block: { number: number }
  }>
}

interface PoolContractsInfo {
  poolManager: string
  swapRouter: string | undefined
  positionManager: string | undefined
}

interface PoolInfoResult {
  pools: never[]
  note: string
  contracts: PoolContractsInfo | null
}

interface TransactionInfo {
  to: string
  data: string
}

interface SwapResult {
  action: 'sign-and-send'
  transaction: TransactionInfo
  value: string
  approvalRequired: boolean
  approvalToken: Address | undefined
  approvalAmount: string | undefined
  note: string
}

interface BanStatusResult extends BanStatus {
  summary: string
}

interface ModeratorStatsResult extends ModeratorProfile {
  summary: string
}

interface ModerationCasesResult {
  cases: ModerationCase[]
  count: number
}

interface ModerationCaseResult extends ModerationCase {
  summary: string
}

interface ModerationStatsResult extends ModerationStats {
  summary: string
}

interface TransactionResult {
  action: 'sign-and-send'
  transaction: TransactionRequest
}

// Union type for all possible result data shapes
type ToolResultData =
  | TokenListResult
  | BlockListResult
  | TokenDetailsResult
  | PoolInfoResult
  | SwapResult
  | BanStatusResult
  | ModeratorStatsResult
  | ModerationCasesResult
  | ModerationCaseResult
  | ModerationStatsResult
  | TransactionResult

// Tool argument schemas with runtime validation
const ListTokensArgsSchema = z.object({
  limit: z.number().optional(),
})

const GetLatestBlocksArgsSchema = z.object({
  limit: z.number().optional(),
})

const GetTokenDetailsArgsSchema = z.object({
  address: z.string(),
})

const GetPoolInfoArgsSchema = z.object({})

const SwapTokensArgsSchema = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.string(),
})

const CheckBanStatusArgsSchema = z.object({
  address: z.string(),
})

const GetModeratorStatsArgsSchema = z.object({
  address: z.string(),
})

const GetModerationCasesArgsSchema = z.object({
  activeOnly: z.boolean().optional(),
  resolvedOnly: z.boolean().optional(),
  limit: z.number().optional(),
})

const GetModerationCaseArgsSchema = z.object({
  caseId: z.string(),
})

const GetModerationStatsArgsSchema = z.object({})

const PrepareModerationStakeArgsSchema = z.object({
  stakeAmount: z.string(),
})

const PrepareReportUserArgsSchema = z.object({
  target: z.string(),
  reason: z.string(),
  evidenceHash: z.string(),
})

const PrepareVoteOnCaseArgsSchema = z.object({
  caseId: z.string(),
  voteYes: z.boolean(),
})

const PrepareChallengeArgsSchema = z.object({
  caseId: z.string(),
  stakeAmount: z.string(),
})

// Union type for all tool arguments
export type MCPToolArgs = Record<string, unknown>

export interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

function makeResult(data: ToolResultData, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  }
}

export async function callMCPTool(
  name: string,
  args: MCPToolArgs,
): Promise<ToolResult> {
  expect(name, 'Tool name is required')

  switch (name) {
    case 'list_tokens': {
      const { limit = 50 } = expectValid(
        ListTokensArgsSchema,
        args,
        'list_tokens args',
      )
      expectPositive(limit, 'Limit must be positive')
      const tokens = await getNetworkTokens({ limit })
      return makeResult({
        tokens: tokens.map((t) => ({
          address: t.address,
          creator: t.creator.address,
          isERC20: t.isERC20,
        })),
      })
    }

    case 'get_latest_blocks': {
      const { limit = 10 } = expectValid(
        GetLatestBlocksArgsSchema,
        args,
        'get_latest_blocks args',
      )
      expectPositive(limit, 'Limit must be positive')
      const blocks = await getLatestBlocks(limit)
      return makeResult({
        blocks: blocks.map((b) => ({
          number: b.number,
          hash: b.hash,
          timestamp: b.timestamp,
        })),
      })
    }

    case 'get_token_details': {
      const { address } = expectValid(
        GetTokenDetailsArgsSchema,
        args,
        'get_token_details args',
      )
      const validatedAddress = AddressSchema.parse(address) as Address
      const [details, holders, transfers] = await Promise.all([
        getContractDetails(validatedAddress),
        getTokenHolders(validatedAddress, 10),
        getTokenTransfers(validatedAddress, 10),
      ])
      return makeResult({
        ...details,
        topHolders: holders.slice(0, 10),
        recentTransfers: transfers.slice(0, 10),
      })
    }

    case 'get_pool_info': {
      expectValid(GetPoolInfoArgsSchema, args, 'get_pool_info args')
      const contracts = getV4Contracts(JEJU_CHAIN_ID)
      return makeResult({
        pools: [],
        note: 'Query Uniswap V4 contracts for pool data',
        contracts: contracts
          ? {
              poolManager: contracts.poolManager,
              swapRouter: contracts.swapRouter,
              positionManager: contracts.positionManager,
            }
          : null,
      })
    }

    case 'swap_tokens': {
      const { fromToken, toToken, amount } = expectValid(
        SwapTokensArgsSchema,
        args,
        'swap_tokens args',
      )
      const validatedFromToken = AddressSchema.parse(fromToken) as Address
      const validatedToToken = AddressSchema.parse(toToken) as Address
      expect(amount, 'amount is required')

      const contracts = expect(
        getV4Contracts(JEJU_CHAIN_ID),
        'V4 contracts not deployed on this chain',
      )
      const swapRouter = expect(
        contracts.swapRouter,
        'Swap router not deployed on this chain',
      )

      const calldata = encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: validatedFromToken,
            tokenOut: validatedToToken,
            fee: 3000, // 0.3% fee tier
            recipient: ZERO_ADDRESS as Address, // Will be replaced by caller
            amountIn: parseEther(amount),
            amountOutMinimum: 0n, // No slippage protection - caller should add
            sqrtPriceLimitX96: 0n,
          },
        ],
      })

      const isNativeInput =
        validatedFromToken.toLowerCase() === ZERO_ADDRESS.toLowerCase()

      return makeResult({
        action: 'sign-and-send',
        transaction: {
          to: swapRouter,
          data: calldata,
        },
        value: isNativeInput ? parseEther(amount).toString() : '0',
        approvalRequired: !isNativeInput,
        approvalToken: isNativeInput ? undefined : validatedFromToken,
        approvalAmount: isNativeInput ? undefined : amount,
        note: 'Swap transaction prepared. Caller should set recipient address.',
      })
    }

    case 'check_ban_status': {
      const { address } = expectValid(
        CheckBanStatusArgsSchema,
        args,
        'check_ban_status args',
      )
      const validatedAddress = AddressSchema.parse(address) as Address
      const result = await checkBanStatus(validatedAddress)
      return makeResult({
        ...result,
        summary: !result.isBanned
          ? 'Address is not banned'
          : `Address is ${result.isOnNotice ? 'on notice' : 'banned'}: ${result.reason ?? 'Unknown reason'}`,
      })
    }

    case 'get_moderator_stats': {
      const { address } = expectValid(
        GetModeratorStatsArgsSchema,
        args,
        'get_moderator_stats args',
      )
      const validatedAddress = AddressSchema.parse(address) as Address
      const stats = await getModeratorStats(validatedAddress)
      const validatedStats = expect(
        stats,
        `Could not fetch moderator stats for address: ${validatedAddress}`,
      )
      return makeResult({
        ...validatedStats,
        summary: validatedStats.isStaked
          ? `${validatedStats.tier} tier moderator with ${validatedStats.winRate}% win rate and ${validatedStats.netPnL} ETH P&L`
          : 'Not a staked moderator',
      })
    }

    case 'get_moderation_cases': {
      const { activeOnly, resolvedOnly, limit } = expectValid(
        GetModerationCasesArgsSchema,
        args,
        'get_moderation_cases args',
      )
      const cases = await getModerationCases({
        activeOnly,
        resolvedOnly,
        limit,
      })
      return makeResult({
        cases,
        count: cases.length,
      })
    }

    case 'get_moderation_case': {
      const { caseId } = expectValid(
        GetModerationCaseArgsSchema,
        args,
        'get_moderation_case args',
      )
      const caseData = await getModerationCase(caseId)
      const validatedCaseData = expect(caseData, 'Case not found')
      return makeResult({
        ...validatedCaseData,
        summary: `Case ${validatedCaseData.status}: ${validatedCaseData.target} reported by ${validatedCaseData.reporter}`,
      })
    }

    case 'get_moderation_stats': {
      expectValid(
        GetModerationStatsArgsSchema,
        args,
        'get_moderation_stats args',
      )
      const stats = await getModerationStats()
      return makeResult({
        ...stats,
        summary: `Total cases: ${stats.totalCases}, Active: ${stats.activeCases}, Resolved: ${stats.resolvedCases}`,
      })
    }

    case 'prepare_moderation_stake': {
      const { stakeAmount } = expectValid(
        PrepareModerationStakeArgsSchema,
        args,
        'prepare_moderation_stake args',
      )
      const tx = prepareStakeTransaction(stakeAmount)
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      })
    }

    case 'prepare_report_user': {
      const { target, reason, evidenceHash } = expectValid(
        PrepareReportUserArgsSchema,
        args,
        'prepare_report_user args',
      )
      AddressSchema.parse(target)
      const tx = prepareReportTransaction(target, reason, evidenceHash)
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      })
    }

    case 'prepare_vote_on_case': {
      const { caseId, voteYes } = expectValid(
        PrepareVoteOnCaseArgsSchema,
        args,
        'prepare_vote_on_case args',
      )
      const tx = prepareVoteTransaction(caseId, voteYes)
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      })
    }

    case 'prepare_challenge_ban': {
      const { caseId, stakeAmount } = expectValid(
        PrepareChallengeArgsSchema,
        args,
        'prepare_challenge_ban args',
      )
      const tx = prepareChallengeTransaction(caseId, stakeAmount)
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      })
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
