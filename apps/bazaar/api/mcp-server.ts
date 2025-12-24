import { expect as expectExists, expectValid } from '@jejunetwork/types'
import {
  MCPResourceReadRequestSchema,
  MCPToolCallRequestSchema,
} from '../schemas/api'
import {
  getCORSHeaders,
  MCP_RESOURCES,
  MCP_SERVER_INFO,
  MCP_TOOLS,
} from './mcp/constants'
import { readMCPResource } from './mcp/resources'
import { callMCPTool } from './mcp/tools'

function jsonResponse(
  data: Record<string, unknown>,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

export async function handleMCPRequest(
  request: Request,
  endpoint: string,
): Promise<Response> {
  const origin = request.headers.get('origin')
  const headers = getCORSHeaders(origin)

  switch (endpoint) {
    case 'initialize':
      return jsonResponse(
        {
          protocolVersion: '2024-11-05',
          serverInfo: MCP_SERVER_INFO,
          capabilities: MCP_SERVER_INFO.capabilities,
        },
        headers,
      )

    case 'resources/list':
      return jsonResponse({ resources: MCP_RESOURCES }, headers)

    case 'resources/read': {
      const body = await request.json()
      const { uri } = expectValid(
        MCPResourceReadRequestSchema,
        body,
        'MCP resource read request',
      )

      const contents = await readMCPResource(uri)
      expectExists(contents, 'Resource not found')

      return jsonResponse(
        {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(contents, null, 2),
            },
          ],
        },
        headers,
      )
    }

    case 'tools/list':
      return jsonResponse({ tools: MCP_TOOLS }, headers)

    case 'tools/call': {
      const body = await request.json()
      const { name, arguments: args } = expectValid(
        MCPToolCallRequestSchema,
        body,
        'MCP tool call request',
      )

      const result = await callMCPTool(name, args || {})
      return jsonResponse(result, headers)
    }

    default:
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
  }
}

export function handleMCPInfo(): Response {
  return Response.json({
    server: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    description: MCP_SERVER_INFO.description,
    resources: MCP_RESOURCES,
    tools: MCP_TOOLS,
    capabilities: MCP_SERVER_INFO.capabilities,
  })
}
