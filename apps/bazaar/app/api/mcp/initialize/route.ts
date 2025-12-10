/**
 * MCP Initialize Endpoint
 */

import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MCP_SERVER_INFO = {
  name: 'bazaar',
  version: '1.0.0',
  description: 'Jeju DeFi + NFT Marketplace',
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

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST() {
  return NextResponse.json({
    protocolVersion: '2024-11-05',
    serverInfo: MCP_SERVER_INFO,
    capabilities: MCP_SERVER_INFO.capabilities,
  }, { headers: CORS_HEADERS });
}
