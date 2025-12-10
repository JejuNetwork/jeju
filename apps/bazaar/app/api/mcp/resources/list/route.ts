/**
 * MCP Resources List Endpoint
 */

import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MCP_RESOURCES = [
  { uri: 'bazaar://tokens', name: 'Token List', description: 'List of ERC20 tokens on Jeju', mimeType: 'application/json' },
  { uri: 'bazaar://blocks', name: 'Recent Blocks', description: 'Latest blockchain blocks', mimeType: 'application/json' },
  { uri: 'bazaar://pools', name: 'Liquidity Pools', description: 'Uniswap V4 pool information', mimeType: 'application/json' },
  { uri: 'bazaar://nfts', name: 'NFT Marketplace', description: 'NFT listings and collections', mimeType: 'application/json' },
];

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST() {
  return NextResponse.json({
    resources: MCP_RESOURCES,
    nextCursor: null,
  }, { headers: CORS_HEADERS });
}
