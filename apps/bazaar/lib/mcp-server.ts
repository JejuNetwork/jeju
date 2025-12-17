import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const SERVER_INFO = {
  name: 'jeju-bazaar',
  version: '1.0.0',
  description: 'Decentralized marketplace for token launches, ICOs, and NFT trading',
  capabilities: { resources: true, tools: true, prompts: false },
};

const RESOURCES = [
  { uri: 'bazaar://launches', name: 'Token Launches', description: 'Active and upcoming token launches', mimeType: 'application/json' },
  { uri: 'bazaar://launches/active', name: 'Active Launches', description: 'Currently active token launches', mimeType: 'application/json' },
  { uri: 'bazaar://ico/tiers', name: 'ICO Tiers', description: 'Available ICO participation tiers', mimeType: 'application/json' },
  { uri: 'bazaar://collections', name: 'NFT Collections', description: 'All NFT collections on marketplace', mimeType: 'application/json' },
  { uri: 'bazaar://stats', name: 'Market Stats', description: 'Overall marketplace statistics', mimeType: 'application/json' },
  { uri: 'bazaar://trending', name: 'Trending', description: 'Trending tokens and collections', mimeType: 'application/json' },
  // TFMM Resources
  { uri: 'bazaar://tfmm/pools', name: 'Smart Pools', description: 'All TFMM auto-rebalancing pools', mimeType: 'application/json' },
  { uri: 'bazaar://tfmm/strategies', name: 'TFMM Strategies', description: 'Available rebalancing strategies', mimeType: 'application/json' },
  { uri: 'bazaar://tfmm/oracles', name: 'Oracle Status', description: 'Price oracle status (Pyth, Chainlink, TWAP)', mimeType: 'application/json' },
  // Perps Resources
  { uri: 'bazaar://perps/markets', name: 'Perp Markets', description: 'All perpetual futures markets', mimeType: 'application/json' },
  { uri: 'bazaar://perps/funding', name: 'Funding Rates', description: 'Current funding rates', mimeType: 'application/json' },
  // Charts Resources
  { uri: 'bazaar://charts/top', name: 'Top Tokens', description: 'Top tokens by volume', mimeType: 'application/json' },
];

const TOOLS = [
  // Launch Tools
  {
    name: 'get_launch',
    description: 'Get details of a token launch',
    inputSchema: {
      type: 'object',
      properties: {
        launchId: { type: 'string', description: 'Launch ID' },
      },
      required: ['launchId'],
    },
  },
  {
    name: 'check_eligibility',
    description: 'Check if address is eligible to participate in launch',
    inputSchema: {
      type: 'object',
      properties: {
        launchId: { type: 'string', description: 'Launch ID' },
        address: { type: 'string', description: 'Wallet address' },
      },
      required: ['launchId', 'address'],
    },
  },
  {
    name: 'prepare_participate',
    description: 'Prepare transaction to participate in a launch',
    inputSchema: {
      type: 'object',
      properties: {
        launchId: { type: 'string', description: 'Launch ID' },
        amount: { type: 'string', description: 'Amount to contribute' },
        address: { type: 'string', description: 'Wallet address' },
      },
      required: ['launchId', 'amount', 'address'],
    },
  },
  // ICO Tools
  {
    name: 'get_ico_allocation',
    description: 'Get ICO allocation for an address',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'prepare_ico_claim',
    description: 'Prepare transaction to claim vested ICO tokens',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address' },
      },
      required: ['address'],
    },
  },
  // NFT Tools
  {
    name: 'get_collection',
    description: 'Get NFT collection details',
    inputSchema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string', description: 'Collection ID' },
      },
      required: ['collectionId'],
    },
  },
  {
    name: 'list_nfts',
    description: 'List NFTs with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string', description: 'Filter by collection' },
        owner: { type: 'string', description: 'Filter by owner address' },
        listed: { type: 'boolean', description: 'Only show listed NFTs' },
        limit: { type: 'number', description: 'Max results' },
      },
    },
  },
  {
    name: 'prepare_buy_nft',
    description: 'Prepare transaction to buy an NFT',
    inputSchema: {
      type: 'object',
      properties: {
        nftId: { type: 'string', description: 'NFT ID' },
        collectionId: { type: 'string', description: 'Collection ID' },
      },
      required: ['nftId', 'collectionId'],
    },
  },
  // Swap Tools
  {
    name: 'get_swap_quote',
    description: 'Get quote for token swap',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string', description: 'Input token address or symbol' },
        tokenOut: { type: 'string', description: 'Output token address or symbol' },
        amountIn: { type: 'string', description: 'Amount of input token' },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
    },
  },
  {
    name: 'prepare_swap',
    description: 'Prepare transaction for token swap',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string', description: 'Input token' },
        tokenOut: { type: 'string', description: 'Output token' },
        amountIn: { type: 'string', description: 'Amount' },
        slippage: { type: 'number', description: 'Slippage tolerance (percent)' },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
    },
  },
  // Portfolio Tools
  {
    name: 'get_portfolio',
    description: 'Get portfolio holdings for an address',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address' },
      },
      required: ['address'],
    },
  },
  // TFMM / Smart Pool Tools
  {
    name: 'list_tfmm_pools',
    description: 'List all TFMM auto-rebalancing pools',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_tfmm_pool',
    description: 'Get details of a specific TFMM pool',
    inputSchema: {
      type: 'object',
      properties: {
        poolAddress: { type: 'string', description: 'Pool contract address' },
      },
      required: ['poolAddress'],
    },
  },
  {
    name: 'get_tfmm_strategies',
    description: 'Get available TFMM strategies',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'prepare_tfmm_deposit',
    description: 'Prepare transaction to deposit into a TFMM pool',
    inputSchema: {
      type: 'object',
      properties: {
        poolAddress: { type: 'string', description: 'Pool address' },
        amounts: { type: 'object', description: 'Token amounts to deposit' },
      },
      required: ['poolAddress', 'amounts'],
    },
  },
  {
    name: 'prepare_tfmm_withdraw',
    description: 'Prepare transaction to withdraw from a TFMM pool',
    inputSchema: {
      type: 'object',
      properties: {
        poolAddress: { type: 'string', description: 'Pool address' },
        shares: { type: 'string', description: 'LP shares to withdraw' },
      },
      required: ['poolAddress', 'shares'],
    },
  },
  // Perpetuals Tools
  {
    name: 'list_perp_markets',
    description: 'List all perpetual futures markets',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_perp_market',
    description: 'Get details of a perpetual market',
    inputSchema: {
      type: 'object',
      properties: {
        marketId: { type: 'string', description: 'Market ID (e.g., BTC-PERP)' },
      },
      required: ['marketId'],
    },
  },
  {
    name: 'get_perp_position',
    description: 'Get position details',
    inputSchema: {
      type: 'object',
      properties: {
        positionId: { type: 'string', description: 'Position ID' },
        address: { type: 'string', description: 'Trader address' },
      },
    },
  },
  {
    name: 'prepare_perp_open',
    description: 'Prepare transaction to open a perpetual position',
    inputSchema: {
      type: 'object',
      properties: {
        marketId: { type: 'string', description: 'Market ID' },
        side: { type: 'string', description: 'long or short' },
        size: { type: 'string', description: 'Position size' },
        leverage: { type: 'number', description: 'Leverage (1-50)' },
        margin: { type: 'string', description: 'Margin amount' },
      },
      required: ['marketId', 'side', 'size', 'leverage', 'margin'],
    },
  },
  {
    name: 'prepare_perp_close',
    description: 'Prepare transaction to close a position',
    inputSchema: {
      type: 'object',
      properties: {
        positionId: { type: 'string', description: 'Position ID to close' },
      },
      required: ['positionId'],
    },
  },
  // Charts & Analytics Tools
  {
    name: 'get_token_chart',
    description: 'Get price chart data for a token',
    inputSchema: {
      type: 'object',
      properties: {
        tokenAddress: { type: 'string', description: 'Token contract address' },
        interval: { type: 'string', description: '1m, 5m, 15m, 1h, 4h, 1d' },
        limit: { type: 'number', description: 'Number of candles' },
      },
      required: ['tokenAddress'],
    },
  },
  {
    name: 'get_top_tokens',
    description: 'Get top tokens by volume or market cap',
    inputSchema: {
      type: 'object',
      properties: {
        sortBy: { type: 'string', description: 'volume, mcap, or change' },
        limit: { type: 'number', description: 'Number of results' },
      },
    },
  },
];

export async function handleMCPRequest(request: NextRequest, endpoint: string): Promise<NextResponse> {
  switch (endpoint) {
    case 'initialize':
      return NextResponse.json({
        protocolVersion: '2024-11-05',
        serverInfo: SERVER_INFO,
        capabilities: SERVER_INFO.capabilities,
      });

    case 'resources/list':
      return NextResponse.json({ resources: RESOURCES });

    case 'resources/read': {
      const body = await request.json() as { uri: string };
      return handleResourceRead(body.uri);
    }

    case 'tools/list':
      return NextResponse.json({ tools: TOOLS });

    case 'tools/call': {
      const body = await request.json() as { name: string; arguments: Record<string, unknown> };
      return handleToolCall(body.name, body.arguments);
    }

    default:
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

async function handleResourceRead(uri: string): Promise<NextResponse> {
  let contents: unknown;

  switch (uri) {
    case 'bazaar://launches':
    case 'bazaar://launches/active':
      contents = {
        launches: [
          {
            id: 'jeju-main',
            name: 'JEJU Token',
            symbol: 'JEJU',
            status: 'active',
            raised: '2500000',
            target: '5000000',
          },
        ],
      };
      break;

    case 'bazaar://ico/tiers':
      contents = {
        tiers: [
          { name: 'Community', minCommit: '10', discount: 0 },
          { name: 'Supporter', minCommit: '1000', discount: 5 },
          { name: 'Backer', minCommit: '5000', discount: 10 },
          { name: 'Builder', minCommit: '25000', discount: 15 },
        ],
      };
      break;

    case 'bazaar://collections':
      contents = {
        collections: [
          { id: 'jeju-genesis', name: 'Jeju Genesis', items: 10000 },
          { id: 'jeju-agents', name: 'Jeju Agents', items: 5000 },
        ],
      };
      break;

    case 'bazaar://stats':
      contents = {
        totalVolume24h: '1500000',
        activeUsers: 2500,
        launches: { active: 3, completed: 15 },
      };
      break;

    case 'bazaar://trending':
      contents = {
        tokens: [{ symbol: 'JEJU', change: 15.5 }],
        collections: [{ name: 'Jeju Agents', change: 250 }],
      };
      break;

    default:
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
  }

  return NextResponse.json({
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(contents, null, 2),
    }],
  });
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<NextResponse> {
  let result: unknown;
  let isError = false;

  switch (name) {
    case 'get_launch':
      result = {
        id: args.launchId,
        name: 'JEJU Token',
        symbol: 'JEJU',
        status: 'active',
        price: '0.05',
        minContribution: '10',
        maxContribution: '10000',
      };
      break;

    case 'check_eligibility':
      result = {
        eligible: true,
        tier: 'standard',
        maxAllocation: '10000',
      };
      break;

    case 'prepare_participate':
      result = {
        action: 'sign-and-send',
        transaction: {
          to: process.env.NEXT_PUBLIC_LAUNCH_CONTRACT,
          data: '0x...',
        },
        approvalRequired: true,
      };
      break;

    case 'get_ico_allocation':
      result = {
        committed: '5000',
        tier: 'Supporter',
        tokens: '105000',
        claimable: '0',
      };
      break;

    case 'get_collection':
      result = {
        id: args.collectionId,
        name: 'Jeju Genesis',
        items: 10000,
        floorPrice: '0.1',
      };
      break;

    case 'list_nfts':
      result = {
        nfts: [
          { id: '1', name: 'Genesis #1', price: '0.15' },
          { id: '2', name: 'Genesis #2', price: '0.12' },
        ],
      };
      break;

    case 'prepare_buy_nft':
      result = {
        action: 'sign-and-send',
        transaction: {
          to: process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT,
          data: '0x...',
        },
      };
      break;

    case 'get_swap_quote':
      result = {
        amountIn: args.amountIn,
        amountOut: '100.5',
        priceImpact: 0.5,
      };
      break;

    case 'prepare_swap':
      result = {
        action: 'sign-and-send',
        transaction: {
          to: process.env.NEXT_PUBLIC_ROUTER_CONTRACT,
          data: '0x...',
        },
      };
      break;

    case 'get_portfolio':
      result = {
        tokens: [
          { symbol: 'JEJU', balance: '10000', value: '500' },
          { symbol: 'ETH', balance: '2.5', value: '5000' },
        ],
        totalValue: '5500',
      };
      break;

    default:
      result = { error: 'Tool not found' };
      isError = true;
  }

  return NextResponse.json({
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError,
  });
}

export function handleMCPInfo(): NextResponse {
  return NextResponse.json({
    server: SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: SERVER_INFO.description,
    resources: RESOURCES,
    tools: TOOLS,
    capabilities: SERVER_INFO.capabilities,
  });
}


