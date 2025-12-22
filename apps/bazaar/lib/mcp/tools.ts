/**
 * MCP Tools business logic
 * Shared between API routes and hooks
 */

import { AddressSchema } from '@jejunetwork/types';
import { expect, expectPositive } from '@/lib/validation';
import { getNetworkTokens, getLatestBlocks, getTokenTransfers, getTokenHolders, getContractDetails } from '@/lib/indexer-client';
import {
  checkBanStatus,
  getModeratorStats,
  getModerationCases,
  getModerationCase,
  getModerationStats,
  prepareStakeTransaction,
  prepareReportTransaction,
  prepareVoteTransaction,
  prepareChallengeTransaction,
  type BanStatus,
  type ModeratorProfile,
  type ModerationCase,
  type ModerationStats,
  type TransactionRequest,
} from '@/lib/moderation-api';
import { getV4Contracts } from '@/config/contracts';
import { JEJU_CHAIN_ID } from '@/config/chains';

// Result data types for each tool
interface TokenInfo {
  address: string;
  creator: string;
  isERC20: boolean;
}

interface BlockInfo {
  number: number;
  hash: string;
  timestamp: string;
}

interface TokenListResult {
  tokens: TokenInfo[];
}

interface BlockListResult {
  blocks: BlockInfo[];
}

interface TokenDetailsResult {
  id: string;
  address: string;
  contractType: string;
  isERC20: boolean;
  isERC721: boolean;
  isERC1155: boolean;
  creator: { address: string };
  creationTransaction: { hash: string };
  creationBlock: { number: number; timestamp: string };
  firstSeenAt: string;
  lastSeenAt: string;
  topHolders: Array<{
    id: string;
    balance: string;
    account: { address: string; firstSeenBlock: number };
    lastUpdated: string;
    transferCount: number;
  }>;
  recentTransfers: Array<{
    id: string;
    tokenStandard: string;
    from: { address: string };
    to: { address: string };
    value: string;
    timestamp: string;
    transaction: { hash: string };
    block: { number: number };
  }>;
}

interface PoolContractsInfo {
  poolManager: string;
  swapRouter: string | undefined;
  positionManager: string | undefined;
}

interface PoolInfoResult {
  pools: never[];
  note: string;
  contracts: PoolContractsInfo | null;
}

interface TransactionInfo {
  to: string;
  data: string;
}

interface SwapResult {
  action: 'sign-and-send';
  transaction: TransactionInfo;
  note: string;
}

interface BanStatusResult extends BanStatus {
  summary: string;
}

interface ModeratorStatsResult extends ModeratorProfile {
  summary: string;
}

interface ModerationCasesResult {
  cases: ModerationCase[];
  count: number;
}

interface ModerationCaseResult extends ModerationCase {
  summary: string;
}

interface ModerationStatsResult extends ModerationStats {
  summary: string;
}

interface TransactionResult {
  action: 'sign-and-send';
  transaction: TransactionRequest;
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
  | TransactionResult;

// Tool argument types - discriminated by tool name
interface ListTokensArgs {
  limit?: number;
}

interface GetLatestBlocksArgs {
  limit?: number;
}

interface GetTokenDetailsArgs {
  address: string;
}

interface GetPoolInfoArgs {
  // No required args
}

interface SwapTokensArgs {
  fromToken: string;
  toToken: string;
  amount: string;
}

interface CheckBanStatusArgs {
  address: string;
}

interface GetModeratorStatsArgs {
  address: string;
}

interface GetModerationCasesArgs {
  activeOnly?: boolean;
  resolvedOnly?: boolean;
  limit?: number;
}

interface GetModerationCaseArgs {
  caseId: string;
}

interface GetModerationStatsArgs {
  // No required args
}

interface PrepareModerationStakeArgs {
  stakeAmount: string;
}

interface PrepareReportUserArgs {
  target: string;
  reason: string;
  evidenceHash: string;
}

interface PrepareVoteOnCaseArgs {
  caseId: string;
  voteYes: boolean;
}

interface PrepareChallengeArgs {
  caseId: string;
  stakeAmount: string;
}

// Union type for all tool arguments
export type MCPToolArgs =
  | ListTokensArgs
  | GetLatestBlocksArgs
  | GetTokenDetailsArgs
  | GetPoolInfoArgs
  | SwapTokensArgs
  | CheckBanStatusArgs
  | GetModeratorStatsArgs
  | GetModerationCasesArgs
  | GetModerationCaseArgs
  | GetModerationStatsArgs
  | PrepareModerationStakeArgs
  | PrepareReportUserArgs
  | PrepareVoteOnCaseArgs
  | PrepareChallengeArgs;

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function makeResult(data: ToolResultData, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

export async function callMCPTool(
  name: string,
  args: MCPToolArgs
): Promise<ToolResult> {
  expect(name, 'Tool name is required');

  switch (name) {
    case 'list_tokens': {
      const typedArgs = args as ListTokensArgs;
      const limit = typedArgs.limit ?? 50;
      expectPositive(limit, 'Limit must be positive');
      const tokens = await getNetworkTokens({ limit });
      return makeResult({
        tokens: tokens.map((t) => ({
          address: t.address,
          creator: t.creator.address,
          isERC20: t.isERC20,
        })),
      });
    }

    case 'get_latest_blocks': {
      const typedArgs = args as GetLatestBlocksArgs;
      const limit = typedArgs.limit ?? 10;
      expectPositive(limit, 'Limit must be positive');
      const blocks = await getLatestBlocks(limit);
      return makeResult({
        blocks: blocks.map((b) => ({
          number: b.number,
          hash: b.hash,
          timestamp: b.timestamp,
        })),
      });
    }

    case 'get_token_details': {
      const typedArgs = args as GetTokenDetailsArgs;
      const validatedAddress = AddressSchema.parse(typedArgs.address);
      const [details, holders, transfers] = await Promise.all([
        getContractDetails(validatedAddress),
        getTokenHolders(validatedAddress, 10),
        getTokenTransfers(validatedAddress, 10),
      ]);
      return makeResult({
        ...details,
        topHolders: holders.slice(0, 10),
        recentTransfers: transfers.slice(0, 10),
      });
    }

    case 'get_pool_info': {
      const contracts = getV4Contracts(JEJU_CHAIN_ID);
      return makeResult({
        pools: [],
        note: 'Query Uniswap V4 contracts for pool data',
        contracts: contracts ? {
          poolManager: contracts.poolManager,
          swapRouter: contracts.swapRouter,
          positionManager: contracts.positionManager,
        } : null,
      });
    }

    case 'swap_tokens': {
      const typedArgs = args as SwapTokensArgs;
      expect(typedArgs.fromToken, 'fromToken is required');
      expect(typedArgs.toToken, 'toToken is required');
      expect(typedArgs.amount, 'amount is required');
      AddressSchema.parse(typedArgs.fromToken);
      AddressSchema.parse(typedArgs.toToken);
      const contracts = getV4Contracts(JEJU_CHAIN_ID);
      return makeResult({
        action: 'sign-and-send',
        transaction: {
          to: contracts?.swapRouter || contracts?.poolManager || '0x',
          data: '0x...',
        },
        note: 'Swap transaction prepared',
      });
    }

    case 'check_ban_status': {
      const typedArgs = args as CheckBanStatusArgs;
      const validatedAddress = AddressSchema.parse(typedArgs.address);
      const result = await checkBanStatus(validatedAddress);
      return makeResult({
        ...result,
        summary: !result.isBanned ? 'Address is not banned' : `Address is ${result.isOnNotice ? 'on notice' : 'banned'}: ${result.reason || 'Unknown reason'}`,
      });
    }

    case 'get_moderator_stats': {
      const typedArgs = args as GetModeratorStatsArgs;
      const validatedAddress = AddressSchema.parse(typedArgs.address);
      const stats = await getModeratorStats(validatedAddress);
      const validatedStats = expect(stats, `Could not fetch moderator stats for address: ${validatedAddress}`);
      return makeResult({
        ...validatedStats,
        summary: validatedStats.isStaked
          ? `${validatedStats.tier} tier moderator with ${validatedStats.winRate}% win rate and ${validatedStats.netPnL} ETH P&L`
          : 'Not a staked moderator',
      });
    }

    case 'get_moderation_cases': {
      const typedArgs = args as GetModerationCasesArgs;
      const cases = await getModerationCases({
        activeOnly: typedArgs.activeOnly,
        resolvedOnly: typedArgs.resolvedOnly,
        limit: typedArgs.limit,
      });
      return makeResult({
        cases,
        count: cases.length,
      });
    }

    case 'get_moderation_case': {
      const typedArgs = args as GetModerationCaseArgs;
      expect(typedArgs.caseId, 'caseId is required');
      const caseData = await getModerationCase(typedArgs.caseId);
      const validatedCaseData = expect(caseData, `Case not found: ${typedArgs.caseId}`);
      return makeResult({
        ...validatedCaseData,
        summary: `Case ${validatedCaseData.status}: ${validatedCaseData.target} reported by ${validatedCaseData.reporter}`,
      });
    }

    case 'get_moderation_stats': {
      const stats = await getModerationStats();
      return makeResult({
        ...stats,
        summary: `Total cases: ${stats.totalCases}, Active: ${stats.activeCases}, Resolved: ${stats.resolvedCases}`,
      });
    }

    case 'prepare_moderation_stake': {
      const typedArgs = args as PrepareModerationStakeArgs;
      expect(typedArgs.stakeAmount, 'stakeAmount is required');
      const tx = prepareStakeTransaction(typedArgs.stakeAmount);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      });
    }

    case 'prepare_report_user': {
      const typedArgs = args as PrepareReportUserArgs;
      expect(typedArgs.target, 'target is required');
      expect(typedArgs.reason, 'reason is required');
      expect(typedArgs.evidenceHash, 'evidenceHash is required');
      AddressSchema.parse(typedArgs.target);
      const tx = prepareReportTransaction(typedArgs.target, typedArgs.reason, typedArgs.evidenceHash);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      });
    }

    case 'prepare_vote_on_case': {
      const typedArgs = args as PrepareVoteOnCaseArgs;
      expect(typedArgs.caseId, 'caseId is required');
      expect(typedArgs.voteYes !== undefined, 'voteYes is required');
      const tx = prepareVoteTransaction(typedArgs.caseId, typedArgs.voteYes);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      });
    }

    case 'prepare_challenge_ban': {
      const typedArgs = args as PrepareChallengeArgs;
      expect(typedArgs.caseId, 'caseId is required');
      expect(typedArgs.stakeAmount, 'stakeAmount is required');
      const tx = prepareChallengeTransaction(typedArgs.caseId, typedArgs.stakeAmount);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
