/**
 * MCP Initialize Endpoint
 */

import { type NextRequest, NextResponse } from 'next/server'
import { getCORSHeaders, MCP_SERVER_INFO } from '@/lib/mcp/constants'

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin')
  return new NextResponse(null, { headers: getCORSHeaders(origin) })
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  return NextResponse.json(
    {
      protocolVersion: '2024-11-05',
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_INFO.capabilities,
    },
    { headers: getCORSHeaders(origin) },
  )
}
