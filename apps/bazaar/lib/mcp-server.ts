import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { expectExists, expectValid } from '@/lib/validation'
import {
  MCPResourceReadRequestSchema,
  MCPToolCallRequestSchema,
} from '@/schemas/api'
import {
  getCORSHeaders,
  MCP_RESOURCES,
  MCP_SERVER_INFO,
  MCP_TOOLS,
} from './mcp/constants'
import { readMCPResource } from './mcp/resources'
import { callMCPTool } from './mcp/tools'

export async function handleMCPRequest(
  request: NextRequest,
  endpoint: string,
): Promise<NextResponse> {
  const origin = request.headers.get('origin')
  const headers = getCORSHeaders(origin)

  switch (endpoint) {
    case 'initialize':
      return NextResponse.json(
        {
          protocolVersion: '2024-11-05',
          serverInfo: MCP_SERVER_INFO,
          capabilities: MCP_SERVER_INFO.capabilities,
        },
        { headers },
      )

    case 'resources/list':
      return NextResponse.json({ resources: MCP_RESOURCES }, { headers })

    case 'resources/read': {
      const body = await request.json()
      const { uri } = expectValid(
        MCPResourceReadRequestSchema,
        body,
        'MCP resource read request',
      )

      const contents = await readMCPResource(uri)
      expectExists(contents, 'Resource not found')

      return NextResponse.json(
        {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(contents, null, 2),
            },
          ],
        },
        { headers },
      )
    }

    case 'tools/list':
      return NextResponse.json({ tools: MCP_TOOLS }, { headers })

    case 'tools/call': {
      const body = await request.json()
      const { name, arguments: args } = expectValid(
        MCPToolCallRequestSchema,
        body,
        'MCP tool call request',
      )

      const result = await callMCPTool(name, args || {})
      return NextResponse.json(result, { headers })
    }

    default:
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers })
  }
}

export function handleMCPInfo(): NextResponse {
  return NextResponse.json({
    server: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    description: MCP_SERVER_INFO.description,
    resources: MCP_RESOURCES,
    tools: MCP_TOOLS,
    capabilities: MCP_SERVER_INFO.capabilities,
  })
}
