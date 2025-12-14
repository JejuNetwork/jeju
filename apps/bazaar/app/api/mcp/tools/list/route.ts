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
  // ============ Token Tools ============
  {
    name: 'list_tokens',
    description: 'Get list of ERC20 tokens deployed on the network',
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
    description: 'Get recent blocks from the network blockchain',
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

  // ============ Moderation Tools ============
  {
    name: 'check_ban_status',
    description: 'Check if an address is banned or on notice in the moderation system',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address to check' },
      },
      required: ['address'],
    },
    tags: ['query', 'moderation', 'free'],
  },
  {
    name: 'get_moderator_stats',
    description: 'Get moderation statistics for an address including reputation, P&L, and win rate',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Moderator wallet address' },
      },
      required: ['address'],
    },
    tags: ['query', 'moderation', 'free'],
  },
  {
    name: 'get_moderation_cases',
    description: 'Get list of moderation cases (ban proposals) from the marketplace',
    inputSchema: {
      type: 'object',
      properties: {
        activeOnly: { type: 'boolean', description: 'Only show active/unresolved cases', default: false },
        resolvedOnly: { type: 'boolean', description: 'Only show resolved cases', default: false },
        limit: { type: 'number', description: 'Max cases to return', default: 20 },
      },
    },
    tags: ['query', 'moderation', 'free'],
  },
  {
    name: 'get_moderation_case',
    description: 'Get details of a specific moderation case by ID',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: 'Case ID (bytes32 hex string)' },
      },
      required: ['caseId'],
    },
    tags: ['query', 'moderation', 'free'],
  },
  {
    name: 'get_moderation_stats',
    description: 'Get overall moderation system statistics',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    tags: ['query', 'moderation', 'free'],
  },
  {
    name: 'prepare_moderation_stake',
    description: 'Prepare transaction to stake ETH and become a moderator',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string', description: 'Amount of ETH to stake (e.g., "0.1")' },
      },
      required: ['amount'],
    },
    tags: ['action', 'moderation', 'stake'],
  },
  {
    name: 'prepare_report_user',
    description: 'Prepare transaction to report a user for bad behavior',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Address of user to report' },
        reason: { type: 'string', description: 'Reason for the report' },
        evidenceHash: { type: 'string', description: 'IPFS hash of evidence (bytes32)' },
      },
      required: ['target', 'reason', 'evidenceHash'],
    },
    tags: ['action', 'moderation', 'report'],
  },
  {
    name: 'prepare_vote_on_case',
    description: 'Prepare transaction to vote on a moderation case',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: 'Case ID to vote on' },
        voteYes: { type: 'boolean', description: 'true to vote BAN, false to vote CLEAR' },
      },
      required: ['caseId', 'voteYes'],
    },
    tags: ['action', 'moderation', 'vote'],
  },
  {
    name: 'prepare_challenge_ban',
    description: 'Prepare transaction to challenge a ban decision',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string', description: 'Case ID to challenge' },
        stakeAmount: { type: 'string', description: 'ETH to stake for the challenge' },
      },
      required: ['caseId', 'stakeAmount'],
    },
    tags: ['action', 'moderation', 'challenge'],
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
