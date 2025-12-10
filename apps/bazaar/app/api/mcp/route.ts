/**
 * MCP Server Endpoint for Bazaar
 * 
 * Model Context Protocol integration for AI assistants.
 * Exposes the same capabilities as A2A but via MCP protocol.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJejuTokens, getLatestBlocks, getTokenTransfers, getTokenHolders, getContractDetails } from '@/lib/indexer-client';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Payment, X-Jeju-Address',
};

// ============================================================================
// MCP Server Info
// ============================================================================

const MCP_SERVER_INFO = {
  name: 'bazaar',
  version: '1.0.0',
  description: 'Jeju DeFi + NFT Marketplace - Token launchpad, Uniswap V4 swaps, liquidity pools, and NFT trading',
  capabilities: {
    resources: true,
    tools: true,
    prompts: false,
    experimental: {
      x402Payments: true,
      erc8004Integration: true,
    },
  },
};

// ============================================================================
// MCP Resources
// ============================================================================

const MCP_RESOURCES = [
  { uri: 'bazaar://tokens', name: 'Token List', description: 'List of ERC20 tokens on Jeju', mimeType: 'application/json' },
  { uri: 'bazaar://blocks', name: 'Recent Blocks', description: 'Latest blockchain blocks', mimeType: 'application/json' },
  { uri: 'bazaar://pools', name: 'Liquidity Pools', description: 'Uniswap V4 pool information', mimeType: 'application/json' },
  { uri: 'bazaar://nfts', name: 'NFT Marketplace', description: 'NFT listings and collections', mimeType: 'application/json' },
];

// ============================================================================
// MCP Tools
// ============================================================================

const MCP_TOOLS = [
  // Query tools (free)
  {
    name: 'list_tokens',
    description: 'Get list of ERC20 tokens deployed on Jeju',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max tokens to return', default: 50 },
      },
    },
    tags: ['query', 'tokens', 'free'],
  },
  {
    name: 'get_latest_blocks',
    description: 'Get recent blocks from Jeju blockchain',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of blocks', default: 10 },
      },
    },
    tags: ['query', 'blockchain', 'free'],
  },
  {
    name: 'get_token_details',
    description: 'Get detailed information about a specific token',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Token contract address' },
      },
      required: ['address'],
    },
    tags: ['query', 'tokens'],
  },
  {
    name: 'get_pool_info',
    description: 'Get Uniswap V4 liquidity pool information',
    inputSchema: {
      type: 'object',
      properties: {
        poolId: { type: 'string', description: 'Pool ID or token pair' },
      },
    },
    tags: ['query', 'defi', 'free'],
  },
  // Action tools (may require payment)
  {
    name: 'swap_tokens',
    description: 'Prepare a token swap transaction via Uniswap V4',
    inputSchema: {
      type: 'object',
      properties: {
        fromToken: { type: 'string', description: 'Input token address' },
        toToken: { type: 'string', description: 'Output token address' },
        amount: { type: 'string', description: 'Amount to swap (in wei)' },
        recipient: { type: 'string', description: 'Recipient address (optional)' },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
    tags: ['action', 'defi', 'swap', 'x402'],
  },
  {
    name: 'create_token',
    description: 'Prepare transaction to deploy a new ERC20 token',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Token name' },
        symbol: { type: 'string', description: 'Token symbol' },
        supply: { type: 'string', description: 'Initial supply' },
      },
      required: ['name', 'symbol'],
    },
    tags: ['action', 'tokens', 'deployment', 'x402'],
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

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

// ============================================================================
// Resource Handlers
// ============================================================================

async function readResource(uri: string): Promise<unknown | null> {
  switch (uri) {
    case 'bazaar://tokens': {
      const tokens = await getJejuTokens({ limit: 50 });
      return {
        tokens: tokens.map((t) => ({
          address: t.address,
          creator: t.creator.address,
          isERC20: t.isERC20,
        })),
      };
    }

    case 'bazaar://blocks': {
      const blocks = await getLatestBlocks(10);
      return {
        blocks: blocks.map((b) => ({
          number: b.number,
          hash: b.hash,
          timestamp: b.timestamp,
        })),
      };
    }

    case 'bazaar://pools':
      return { pools: [], note: 'Query Uniswap V4 for pool data' };

    case 'bazaar://nfts':
      return { nfts: [], note: 'NFT indexing coming soon' };

    default:
      return null;
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const endpoint = pathParts[pathParts.length - 1]; // Last part of path

  // Handle different MCP endpoints
  // Since Next.js routes, we handle based on request body or headers
  const body = await request.json().catch(() => ({}));

  // If body has specific MCP method indicators, route accordingly
  if (body.method === 'initialize' || endpoint === 'initialize') {
    return NextResponse.json({
      protocolVersion: '2024-11-05',
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_INFO.capabilities,
    }, { headers: CORS_HEADERS });
  }

  if (body.method === 'resources/list' || body.resources !== undefined) {
    return NextResponse.json({
      resources: MCP_RESOURCES,
      nextCursor: null,
    }, { headers: CORS_HEADERS });
  }

  if (body.method === 'resources/read' || body.uri) {
    const uri = body.uri as string;
    if (!uri) {
      return NextResponse.json({ error: 'URI required' }, { status: 400, headers: CORS_HEADERS });
    }
    const contents = await readResource(uri);
    if (contents === null) {
      return NextResponse.json({ error: `Resource not found: ${uri}` }, { status: 404, headers: CORS_HEADERS });
    }
    return NextResponse.json({
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(contents, null, 2),
      }],
    }, { headers: CORS_HEADERS });
  }

  if (body.method === 'tools/list' || body.tools !== undefined) {
    return NextResponse.json({
      tools: MCP_TOOLS,
      nextCursor: null,
    }, { headers: CORS_HEADERS });
  }

  if (body.method === 'tools/call' || body.name) {
    const name = body.name as string;
    const args = body.arguments || {};
    if (!name) {
      return NextResponse.json({ error: 'Tool name required' }, { status: 400, headers: CORS_HEADERS });
    }
    const result = await callTool(name, args);
    return NextResponse.json(result, { headers: CORS_HEADERS });
  }

  if (body.method === 'prompts/list') {
    return NextResponse.json({
      prompts: [],
      nextCursor: null,
    }, { headers: CORS_HEADERS });
  }

  // Default: return server info
  return NextResponse.json({
    server: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    description: MCP_SERVER_INFO.description,
    capabilities: MCP_SERVER_INFO.capabilities,
    resources: MCP_RESOURCES.length,
    tools: MCP_TOOLS.length,
  }, { headers: CORS_HEADERS });
}

// GET for discovery
export async function GET() {
  return NextResponse.json({
    server: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    description: MCP_SERVER_INFO.description,
    capabilities: MCP_SERVER_INFO.capabilities,
    resources: MCP_RESOURCES.length,
    tools: MCP_TOOLS.length,
    authentication: {
      schemes: ['x402'],
      headers: ['x-payment', 'x-jeju-address'],
    },
  }, { headers: CORS_HEADERS });
}
