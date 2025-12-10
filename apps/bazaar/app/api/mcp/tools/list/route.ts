/**
 * MCP Tools List Endpoint
 */

import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MCP_TOOLS = [
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
      properties: {},
    },
    tags: ['query', 'defi', 'free'],
  },
  {
    name: 'swap_tokens',
    description: 'Prepare a token swap transaction via Uniswap V4',
    inputSchema: {
      type: 'object',
      properties: {
        fromToken: { type: 'string', description: 'Input token address' },
        toToken: { type: 'string', description: 'Output token address' },
        amount: { type: 'string', description: 'Amount to swap (in wei)' },
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

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST() {
  return NextResponse.json({
    tools: MCP_TOOLS,
    nextCursor: null,
  }, { headers: CORS_HEADERS });
}
