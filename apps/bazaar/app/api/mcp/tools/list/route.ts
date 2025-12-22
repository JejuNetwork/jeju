/**
 * MCP Tools List Endpoint
 */

import { NextResponse } from 'next/server';
import { CORS_HEADERS, MCP_TOOLS } from '@/lib/mcp/constants';

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST() {
  return NextResponse.json({
    tools: MCP_TOOLS,
    nextCursor: null,
  }, { headers: CORS_HEADERS });
}
