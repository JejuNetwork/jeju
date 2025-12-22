/**
 * MCP Prompts List Endpoint
 */

import { NextResponse } from 'next/server';
import { CORS_HEADERS } from '@/lib/mcp/constants';

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST() {
  return NextResponse.json({
    prompts: [],
    nextCursor: null,
  }, { headers: CORS_HEADERS });
}
