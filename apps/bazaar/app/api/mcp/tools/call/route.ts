/**
 * MCP Tools Call Endpoint
 */

import { type NextRequest, NextResponse } from 'next/server'
import { CORS_HEADERS } from '@/lib/mcp/constants'
import { callMCPTool } from '@/lib/mcp/tools'
import { expectValid } from '@/lib/validation'
import {
  MCPToolCallRequestSchema,
  MCPToolCallResponseSchema,
} from '@/schemas/api'

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, arguments: args } = expectValid(
    MCPToolCallRequestSchema,
    body,
    'MCP tool call request',
  )

  const result = await callMCPTool(name, args || {})
  const validatedResult = expectValid(
    MCPToolCallResponseSchema,
    result,
    'MCP tool call response',
  )
  return NextResponse.json(validatedResult, { headers: CORS_HEADERS })
}
