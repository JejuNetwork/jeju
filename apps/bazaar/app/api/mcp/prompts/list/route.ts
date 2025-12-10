/**
 * MCP Prompts List Endpoint
 */

import { NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST() {
  return NextResponse.json({
    prompts: [],
    nextCursor: null,
  }, { headers: CORS_HEADERS });
}
