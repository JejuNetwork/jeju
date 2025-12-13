/**
 * Bazaar MCP Server
 * 
 * Model Context Protocol interface for the Jeju Bazaar marketplace.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// ============================================================================
// Server Configuration
// ============================================================================

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
];

// ============================================================================
// Request Handlers
// ============================================================================

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

