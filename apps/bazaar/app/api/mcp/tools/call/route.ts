/**
 * MCP Tools Call Endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJejuTokens, getLatestBlocks, getTokenTransfers, getTokenHolders, getContractDetails } from '@/lib/indexer-client';

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
