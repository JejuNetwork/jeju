/**
 * MCP Initialize Endpoint
 */

import { NextResponse } from 'next/server';
import { CORS_HEADERS, MCP_SERVER_INFO } from '@/lib/mcp/constants';

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
