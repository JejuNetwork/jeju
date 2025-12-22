/**
 * MCP Tools List Endpoint
 */

import { type NextRequest, NextResponse } from 'next/server'
import { getCORSHeaders, MCP_TOOLS } from '@/lib/mcp/constants'

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin')
  return new NextResponse(null, { headers: getCORSHeaders(origin) })
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  return NextResponse.json(
    {
      tools: MCP_TOOLS,
      nextCursor: null,
    },
    { headers: getCORSHeaders(origin) },
  )
}
