/**
 * MCP Tools business logic
 * Shared between API routes and hooks
 */

import { AddressSchema } from '@jejunetwork/types/contracts';
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
} from '@/lib/moderation-api';
import { getV4Contracts } from '@/config/contracts';
import { JEJU_CHAIN_ID } from '@/config/chains';

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function makeResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

export async function callMCPTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  expect(name, 'Tool name is required');

  switch (name) {
    case 'list_tokens': {
      const limit = (args.limit as number) || 50;
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
      const limit = (args.limit as number) || 10;
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
      const address = args.address as string;
      const validatedAddress = AddressSchema.parse(address);
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
      const { fromToken, toToken, amount } = args as { fromToken: string; toToken: string; amount: string };
      expect(fromToken, 'fromToken is required');
      expect(toToken, 'toToken is required');
      expect(amount, 'amount is required');
      AddressSchema.parse(fromToken);
      AddressSchema.parse(toToken);
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
      const address = args.address as string;
      const validatedAddress = AddressSchema.parse(address);
      const result = await checkBanStatus(validatedAddress);
      return makeResult({
        ...result,
        summary: !result.isBanned ? 'Address is not banned' : `Address is ${result.isOnNotice ? 'on notice' : 'banned'}: ${result.reason || 'Unknown reason'}`,
      });
    }

    case 'get_moderator_stats': {
      const address = args.address as string;
      const validatedAddress = AddressSchema.parse(address);
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
      const cases = await getModerationCases({
        activeOnly: args.activeOnly as boolean,
        resolvedOnly: args.resolvedOnly as boolean,
        limit: args.limit as number,
      });
      return makeResult({
        cases,
        count: cases.length,
      });
    }

    case 'get_moderation_case': {
      const caseId = args.caseId as string;
      expect(caseId, 'caseId is required');
      const caseData = await getModerationCase(caseId);
      const validatedCaseData = expect(caseData, `Case not found: ${caseId}`);
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
      const { stakeAmount } = args as { stakeAmount: string };
      expect(stakeAmount, 'stakeAmount is required');
      const tx = prepareStakeTransaction(stakeAmount);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      });
    }

    case 'prepare_report_user': {
      const { target, reason, evidenceHash } = args as { target: string; reason: string; evidenceHash: string };
      expect(target, 'target is required');
      expect(reason, 'reason is required');
      expect(evidenceHash, 'evidenceHash is required');
      AddressSchema.parse(target);
      const tx = prepareReportTransaction(target, reason, evidenceHash);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      });
    }

    case 'prepare_vote_on_case': {
      const { caseId, voteYes } = args as { caseId: string; voteYes: boolean };
      expect(caseId, 'caseId is required');
      expect(voteYes !== undefined, 'voteYes is required');
      const tx = prepareVoteTransaction(caseId, voteYes);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      });
    }

    case 'prepare_challenge_ban': {
      const { caseId, stakeAmount } = args as { caseId: string; stakeAmount: string };
      expect(caseId, 'caseId is required');
      expect(stakeAmount, 'stakeAmount is required');
      const tx = prepareChallengeTransaction(caseId, stakeAmount);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
