/**
 * MCP Resources List Endpoint
 */

import { NextResponse } from 'next/server'
import { CORS_HEADERS, MCP_RESOURCES } from '@/lib/mcp/constants'

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}

export async function POST() {
  return NextResponse.json(
    {
      resources: MCP_RESOURCES,
      nextCursor: null,
    },
    { headers: CORS_HEADERS },
  )
}
