/**
 * MCP Tools Call Endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJejuTokens, getLatestBlocks, getTokenTransfers, getTokenHolders, getContractDetails } from '@/lib/indexer-client';
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Payment',
};

async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const makeResult = (data: unknown, isError = false) => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  });

  switch (name) {
    // ============ Token Tools ============
    case 'list_tokens': {
      const limit = (args.limit as number) || 50;
      const tokens = await getJejuTokens({ limit });
      return makeResult({
        tokens: tokens.map((t) => ({
          address: t.address,
          creator: t.creator.address,
          firstSeen: t.firstSeenAt,
          isERC20: t.isERC20,
        })),
        count: tokens.length,
      });
    }

    case 'get_latest_blocks': {
      const limit = (args.limit as number) || 10;
      const blocks = await getLatestBlocks(limit);
      return makeResult({
        blocks: blocks.map((b) => ({
          number: b.number,
          hash: b.hash,
          timestamp: b.timestamp,
          txCount: b.transactionCount,
        })),
      });
    }

    case 'get_token_details': {
      const address = args.address as string;
      if (!address) {
        return makeResult({ error: 'Token address required' }, true);
      }

      const [details, holders, transfers] = await Promise.all([
        getContractDetails(address),
        getTokenHolders(address, 10),
        getTokenTransfers(address, 10),
      ]);

      return makeResult({
        contract: details,
        topHolders: holders.map(h => ({
          address: h.account.address,
          balance: h.balance,
        })),
        recentTransfers: transfers.map(t => ({
          from: t.from.address,
          to: t.to.address,
          amount: t.value,
          timestamp: t.timestamp,
          txHash: t.transaction.hash,
        })),
      });
    }

    case 'get_pool_info': {
      return makeResult({
        pools: [],
        note: 'Query Uniswap V4 PoolManager for pool data',
        instructions: 'View pools at /pools',
      });
    }

    case 'swap_tokens': {
      const { getV4Contracts } = await import('@/config/contracts');
      const { JEJU_CHAIN_ID } = await import('@/config/chains');
      const v4Contracts = getV4Contracts(JEJU_CHAIN_ID);

      return makeResult({
        action: 'contract-call',
        contract: v4Contracts.swapRouter || v4Contracts.poolManager,
        function: 'swap',
        parameters: {
          tokenIn: args.fromToken,
          tokenOut: args.toToken,
          amountIn: args.amount,
          amountOutMinimum: '0',
          recipient: args.recipient || '{{USER_ADDRESS}}',
          deadline: Math.floor(Date.now() / 1000) + 600,
        },
        estimatedGas: '300000',
        instructions: 'Sign and execute this swap transaction',
      });
    }

    case 'create_token': {
      return makeResult({
        action: 'deploy-contract',
        contractType: 'ERC20',
        parameters: {
          name: args.name || 'New Token',
          symbol: args.symbol || 'TKN',
          initialSupply: args.supply || '1000000',
        },
        estimatedGas: '2000000',
        instructions: 'Sign and broadcast this transaction to deploy your token',
      });
    }

    // ============ Moderation Tools ============
    case 'check_ban_status': {
      const address = args.address as string;
      if (!address) {
        return makeResult({ error: 'Address required' }, true);
      }
      const status = await checkBanStatus(address);
      return makeResult({
        ...status,
        summary: status.isBanned 
          ? `Address is ${status.isOnNotice ? 'on notice' : 'banned'}: ${status.reason}`
          : 'Address is not banned',
      });
    }

    case 'get_moderator_stats': {
      const address = args.address as string;
      if (!address) {
        return makeResult({ error: 'Address required' }, true);
      }
      const stats = await getModeratorStats(address);
      if (!stats) {
        return makeResult({ error: 'Could not fetch moderator stats', address }, true);
      }
      return makeResult({
        ...stats,
        summary: stats.isStaked 
          ? `${stats.tier} tier moderator with ${stats.winRate}% win rate and ${stats.netPnL} ETH P&L`
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
        summary: `Found ${cases.length} moderation cases`,
      });
    }

    case 'get_moderation_case': {
      const caseId = args.caseId as string;
      if (!caseId) {
        return makeResult({ error: 'Case ID required' }, true);
      }
      const caseData = await getModerationCase(caseId);
      if (!caseData) {
        return makeResult({ error: 'Case not found', caseId }, true);
      }
      return makeResult({
        ...caseData,
        summary: `Case ${caseData.status}: ${caseData.target} reported by ${caseData.reporter}`,
      });
    }

    case 'get_moderation_stats': {
      const stats = await getModerationStats();
      return makeResult({
        ...stats,
        summary: `${stats.totalCases} total cases (${stats.activeCases} active), ${stats.totalStaked} ETH staked`,
      });
    }

    case 'prepare_moderation_stake': {
      const amount = args.amount as string;
      if (!amount) {
        return makeResult({ error: 'Stake amount required' }, true);
      }
      const tx = prepareStakeTransaction(amount);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
        instructions: 'Sign this transaction to stake and become a moderator. You need to wait 24h after staking before you can vote.',
      });
    }

    case 'prepare_report_user': {
      const { target, reason, evidenceHash } = args as { target: string; reason: string; evidenceHash: string };
      if (!target || !reason || !evidenceHash) {
        return makeResult({ error: 'target, reason, and evidenceHash are required' }, true);
      }
      const tx = prepareReportTransaction(target, reason, evidenceHash);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
        warning: 'Your stake is at risk if the community votes to clear the target',
        instructions: 'Sign this transaction to submit your report',
      });
    }

    case 'prepare_vote_on_case': {
      const { caseId, voteYes } = args as { caseId: string; voteYes: boolean };
      if (!caseId || voteYes === undefined) {
        return makeResult({ error: 'caseId and voteYes are required' }, true);
      }
      const tx = prepareVoteTransaction(caseId, voteYes);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
        note: voteYes ? 'Voting YES means you support banning the target' : 'Voting NO means you support clearing the target',
        instructions: 'Sign this transaction to cast your vote',
      });
    }

    case 'prepare_challenge_ban': {
      const { caseId, stakeAmount } = args as { caseId: string; stakeAmount: string };
      if (!caseId || !stakeAmount) {
        return makeResult({ error: 'caseId and stakeAmount are required' }, true);
      }
      const tx = prepareChallengeTransaction(caseId, stakeAmount);
      return makeResult({
        action: 'sign-and-send',
        transaction: tx,
        warning: 'Challenge stake will be at risk if the ban is upheld',
        instructions: 'Sign this transaction to challenge the ban decision',
      });
    }

    default:
      return makeResult({ error: `Tool not found: ${name}` }, true);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, arguments: args } = body;

  if (!name) {
    return NextResponse.json(
      { error: { code: -32602, message: 'Missing required parameter: name' } },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const result = await callTool(name, args || {});
  return NextResponse.json(result, { headers: CORS_HEADERS });
}
