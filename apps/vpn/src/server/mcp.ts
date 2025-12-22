/**
 * MCP (Model Context Protocol) Handler for VPN
 *
 * Enables AI agents (Claude, GPT, etc.) to:
 * - Connect to VPN
 * - Make proxied requests
 * - Query VPN status
 *
 * Uses fail-fast validation patterns.
 *
 * Proxy Strategy:
 * - proxy_request tool: Proxies AI agent requests to external URLs (keep fetch)
 *   Uses raw fetch to proxy user-submitted requests to external services.
 *   Cannot use Eden as target URLs are user-provided and external.
 */

import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { verifyAuth } from './auth'
import {
  expect,
  expectValid,
  MCPPromptGetSchema,
  MCPResourceReadSchema,
  MCPToolCallSchema,
  ProxyRequestSchema,
} from './schemas'
import type { VPNServiceContext } from './types'
import {
  calculateContributionRatio,
  getOrCreateContribution,
  getQuotaRemaining,
} from './utils/contributions'
import {
  calculateNodeLoad,
  filterNodesByCountry,
  findBestNode,
  getNodesByCountry,
} from './utils/nodes'
import { validateProxyUrlWithDNS } from './utils/proxy-validation'
import { readResponseBody } from './utils/response-reader'
import {
  createSession,
  deleteSession,
  getSession,
  getSessionBytesTransferred,
  getSessionDuration,
  getSessionsForAddress,
  verifySessionOwnership,
} from './utils/sessions'
import { verifyX402Payment } from './x402'

export interface MCPServerInfo {
  name: string
  version: string
  description: string
  capabilities: {
    resources: boolean
    tools: boolean
    prompts: boolean
  }
}

export interface MCPResource {
  uri: string
  name: string
  description: string
  mimeType: string
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<
      string,
      { type: string; description: string; enum?: string[] }
    >
    required?: string[]
  }
}

export interface MCPPrompt {
  name: string
  description: string
  arguments?: Array<{ name: string; description: string; required?: boolean }>
}

// Resource response types
interface NodeInfo {
  nodeId: string
  countryCode: string
  status: string
  load: number
}

interface NodesResource {
  nodes: NodeInfo[]
}

interface CountriesResource {
  countries: Array<{ code: string; nodeCount: number }>
}

interface VPNStatusResource {
  connected: boolean
  message?: string
  sessions?: Array<{
    sessionId: string
    nodeId: string
    protocol: string
    duration: number
  }>
}

interface ContributionResource {
  error?: string
  bytesUsed?: string
  bytesContributed?: string
  cap?: string
  quotaRemaining?: string
  contributionRatio?: number
}

interface PricingResource {
  pricePerGB: string
  pricePerHour: string
  pricePerRequest: string
  supportedTokens: string[]
}

interface ErrorResource {
  error: string
}

type MCPResourceResult =
  | NodesResource
  | CountriesResource
  | VPNStatusResource
  | ContributionResource
  | PricingResource
  | ErrorResource

// Tool result types
interface VPNConnectResult {
  connectionId: string
  endpoint: string
  publicKey: string
  countryCode: string
}

interface VPNDisconnectResult {
  success: boolean
  bytesTransferred: string
}

interface GetNodesResult {
  nodes: NodeInfo[]
}

interface ProxyRequestResult {
  status: number
  body: string
}

interface ContributionStatusResult {
  bytesUsed: string
  bytesContributed: string
  quotaRemaining: string
  contributionRatio: number
}

interface ToolErrorResult {
  error: string
}

type MCPToolResult =
  | VPNConnectResult
  | VPNDisconnectResult
  | GetNodesResult
  | ProxyRequestResult
  | ContributionStatusResult
  | ToolErrorResult

const MCP_SERVER_INFO: MCPServerInfo = {
  name: 'jeju-vpn-mcp',
  version: '1.0.0',
  description: 'Jeju VPN MCP Server - Decentralized VPN and proxy services',
  capabilities: {
    resources: true,
    tools: true,
    prompts: true,
  },
}

const MCP_RESOURCES: MCPResource[] = [
  {
    uri: 'vpn://nodes',
    name: 'VPN Nodes',
    description: 'List of available VPN exit nodes',
    mimeType: 'application/json',
  },
  {
    uri: 'vpn://countries',
    name: 'Available Countries',
    description: 'Countries with VPN exit nodes',
    mimeType: 'application/json',
  },
  {
    uri: 'vpn://status',
    name: 'VPN Status',
    description: 'Current VPN connection status',
    mimeType: 'application/json',
  },
  {
    uri: 'vpn://contribution',
    name: 'Contribution Status',
    description: 'Your fair contribution quota',
    mimeType: 'application/json',
  },
  {
    uri: 'vpn://pricing',
    name: 'Pricing',
    description: 'VPN pricing for premium tier',
    mimeType: 'application/json',
  },
]

const MCP_TOOLS: MCPTool[] = [
  {
    name: 'vpn_connect',
    description:
      'Connect to a VPN exit node. Returns connection details including WireGuard config.',
    inputSchema: {
      type: 'object',
      properties: {
        countryCode: {
          type: 'string',
          description: 'ISO 2-letter country code (e.g., US, NL, JP)',
        },
        protocol: {
          type: 'string',
          description: 'VPN protocol to use',
          enum: ['wireguard', 'socks5'],
        },
      },
    },
  },
  {
    name: 'vpn_disconnect',
    description: 'Disconnect from current VPN session',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'Connection ID to disconnect',
        },
      },
      required: ['connectionId'],
    },
  },
  {
    name: 'get_vpn_nodes',
    description: 'List available VPN exit nodes',
    inputSchema: {
      type: 'object',
      properties: {
        countryCode: {
          type: 'string',
          description: 'Filter by country code',
        },
      },
    },
  },
  {
    name: 'proxy_request',
    description:
      'Make an HTTP request through the VPN network. Requires x402 payment.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Target URL to request',
        },
        method: {
          type: 'string',
          description: 'HTTP method',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        },
        headers: {
          type: 'object',
          description: 'Request headers (JSON object)',
        },
        body: {
          type: 'string',
          description: 'Request body for POST/PUT',
        },
        countryCode: {
          type: 'string',
          description: 'Exit node country',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_contribution_status',
    description: 'Get your fair contribution quota and usage',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

const MCP_PROMPTS: MCPPrompt[] = [
  {
    name: 'setup_vpn',
    description: 'Walk through VPN setup and connection',
    arguments: [
      {
        name: 'countryCode',
        description: 'Preferred exit country',
        required: false,
      },
    ],
  },
  {
    name: 'scrape_webpage',
    description: 'Scrape content from a webpage through VPN',
    arguments: [
      { name: 'url', description: 'URL to scrape', required: true },
      {
        name: 'countryCode',
        description: 'Exit country for geo-specific content',
        required: false,
      },
    ],
  },
]

// ============================================================================
// Router
// ============================================================================

export function createMCPRouter(ctx: VPNServiceContext) {
  const router = new Elysia({ prefix: '/mcp' })
    // Error handling middleware
    .onError(({ error, set }) => {
      console.error('MCP API error:', error)
      set.status = 500
      const message =
        error instanceof Error ? error.message : 'Internal server error'
      return { error: message }
    })

    .post('/initialize', () => {
      return {
        protocolVersion: '2024-11-05',
        serverInfo: MCP_SERVER_INFO,
        capabilities: MCP_SERVER_INFO.capabilities,
      }
    })

    /**
     * POST /resources/list - List available resources
     */
    .post('/resources/list', () => {
      return { resources: MCP_RESOURCES }
    })

    .post('/resources/read', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      // auth.address is already validated as Address by verifyAuth when valid
      const address = auth.valid && auth.address ? auth.address : null

      const validatedBody = expectValid(
        MCPResourceReadSchema,
        body,
        'resource read request',
      )

      const content = await readResource(ctx, validatedBody.uri, address)
      const resource = MCP_RESOURCES.find((r) => r.uri === validatedBody.uri)
      if (!resource) {
        throw new Error(`Resource not found: ${validatedBody.uri}`)
      }

      return {
        contents: [
          {
            uri: validatedBody.uri,
            mimeType: resource.mimeType,
            text: JSON.stringify(content, null, 2),
          },
        ],
      }
    })

    /**
     * POST /tools/list - List available tools
     */
    .post('/tools/list', () => {
      return { tools: MCP_TOOLS }
    })

    .post('/tools/call', async ({ request, body }) => {
      const auth = await verifyAuth(request)
      // auth.address is already validated as Address by verifyAuth when valid
      const address = auth.valid && auth.address ? auth.address : null

      const validatedBody = expectValid(
        MCPToolCallSchema,
        body,
        'tool call request',
      )

      const result = await callTool(
        ctx,
        request,
        validatedBody.name,
        validatedBody.arguments,
        address,
      )

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.result, null, 2),
          },
        ],
        isError: result.isError,
      }
    })

    /**
     * POST /prompts/list - List available prompts
     */
    .post('/prompts/list', () => {
      return { prompts: MCP_PROMPTS }
    })

    .post('/prompts/get', async ({ body }) => {
      const validatedBody = expectValid(
        MCPPromptGetSchema,
        body,
        'prompt get request',
      )

      const prompt = await getPrompt(
        ctx,
        validatedBody.name,
        validatedBody.arguments ?? {},
      )

      return {
        description: prompt.description,
        messages: prompt.messages,
      }
    })

  return router
}

async function readResource(
  ctx: VPNServiceContext,
  uri: string,
  address: Address | null,
): Promise<MCPResourceResult> {
  switch (uri) {
    case 'vpn://nodes': {
      return {
        nodes: Array.from(ctx.nodes.values()).map((n) => ({
          nodeId: n.nodeId,
          countryCode: n.countryCode,
          status: n.status,
          load: calculateNodeLoad(n),
        })),
      }
    }

    case 'vpn://countries': {
      const countries = getNodesByCountry(ctx)
      return {
        countries: Array.from(countries.entries()).map(([code, count]) => ({
          code,
          nodeCount: count,
        })),
      }
    }

    case 'vpn://status': {
      if (!address) return { connected: false, message: 'Not authenticated' }
      const sessions = getSessionsForAddress(ctx, address)
      return {
        connected: sessions.length > 0,
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          nodeId: s.nodeId,
          protocol: s.protocol,
          duration: getSessionDuration(s),
        })),
      }
    }

    case 'vpn://contribution': {
      if (!address) return { error: 'Authentication required' }
      const contribution = getOrCreateContribution(ctx, address)
      const quotaRemaining = getQuotaRemaining(contribution)
      const contributionRatio = calculateContributionRatio(contribution)
      return {
        bytesUsed: contribution.bytesUsed.toString(),
        bytesContributed: contribution.bytesContributed.toString(),
        cap: contribution.cap.toString(),
        quotaRemaining: quotaRemaining.toString(),
        contributionRatio,
      }
    }

    case 'vpn://pricing': {
      return {
        pricePerGB: ctx.config.pricing.pricePerGB.toString(),
        pricePerHour: ctx.config.pricing.pricePerHour.toString(),
        pricePerRequest: ctx.config.pricing.pricePerRequest.toString(),
        supportedTokens: ctx.config.pricing.supportedTokens,
      }
    }

    default:
      return { error: 'Resource not found' }
  }
}

// ============================================================================
// Tool Caller
// ============================================================================

async function callTool(
  ctx: VPNServiceContext,
  request: Request,
  name: string,
  args: Record<string, unknown>,
  address: Address | null,
): Promise<{ result: MCPToolResult; isError: boolean }> {
  switch (name) {
    case 'vpn_connect': {
      if (!address) {
        throw new Error('Authentication required for VPN connection')
      }

      const countryCode =
        typeof args.countryCode === 'string' ? args.countryCode : undefined
      const protocol =
        typeof args.protocol === 'string' ? args.protocol : 'wireguard'

      expect(
        ['wireguard', 'socks5', 'http'].includes(protocol),
        `Invalid protocol: ${protocol}`,
      )

      const node = findBestNode(ctx, countryCode)
      if (!node) {
        throw new Error('No available nodes matching criteria')
      }

      const session = createSession(
        ctx,
        address,
        node.nodeId,
        protocol as 'wireguard' | 'socks5' | 'http',
      )

      return {
        result: {
          connectionId: session.sessionId,
          endpoint: node.endpoint,
          publicKey: node.wireguardPubKey,
          countryCode: node.countryCode,
        },
        isError: false,
      }
    }

    case 'vpn_disconnect': {
      if (!address) {
        throw new Error('Authentication required for disconnect')
      }

      const connectionId =
        typeof args.connectionId === 'string' ? args.connectionId : null
      if (!connectionId || connectionId.length === 0) {
        throw new Error('connectionId must be a non-empty string')
      }

      const session = getSession(ctx, connectionId)
      verifySessionOwnership(session, address)

      deleteSession(ctx, connectionId)
      return {
        result: {
          success: true,
          bytesTransferred: getSessionBytesTransferred(session).toString(),
        },
        isError: false,
      }
    }

    case 'get_vpn_nodes': {
      const countryCode =
        typeof args.countryCode === 'string' ? args.countryCode : undefined

      let nodes = Array.from(ctx.nodes.values())
      if (countryCode) {
        nodes = filterNodesByCountry(nodes, countryCode)
      }

      return {
        result: {
          nodes: nodes.map((n) => ({
            nodeId: n.nodeId,
            countryCode: n.countryCode,
            status: n.status,
            load: calculateNodeLoad(n),
          })),
        },
        isError: false,
      }
    }

    case 'proxy_request': {
      const paymentHeader = request.headers.get('x-payment')
      const paymentResult = await verifyX402Payment(
        paymentHeader || '',
        BigInt(ctx.config.pricing.pricePerRequest),
        'vpn:proxy',
        ctx.config,
      )

      expect(
        paymentResult.valid,
        paymentResult.error ||
          'Payment required. Include x-payment header with valid x402 payment.',
      )

      const proxyRequest = expectValid(
        ProxyRequestSchema,
        args,
        'proxy request params',
      )

      // SECURITY: Validate URL with DNS resolution to prevent SSRF and DNS rebinding attacks
      await validateProxyUrlWithDNS(proxyRequest.url)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const response = await fetch(proxyRequest.url, {
        method: proxyRequest.method,
        headers: proxyRequest.headers,
        body: proxyRequest.body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))

      const MCP_MAX_RESPONSE_SIZE = 10 * 1024 * 1024
      const responseBody = await readResponseBody(
        response,
        MCP_MAX_RESPONSE_SIZE,
      )

      return {
        result: {
          status: response.status,
          body: responseBody.slice(0, 10000),
        },
        isError: false,
      }
    }

    case 'get_contribution_status': {
      if (!address) {
        throw new Error('Authentication required for contribution status')
      }

      const contribution = getOrCreateContribution(ctx, address)
      const quotaRemaining = getQuotaRemaining(contribution)
      const contributionRatio = calculateContributionRatio(contribution)

      return {
        result: {
          bytesUsed: contribution.bytesUsed.toString(),
          bytesContributed: contribution.bytesContributed.toString(),
          quotaRemaining: quotaRemaining.toString(),
          contributionRatio,
        },
        isError: false,
      }
    }

    default:
      return { result: { error: 'Unknown tool' }, isError: true }
  }
}

async function getPrompt(
  _ctx: VPNServiceContext,
  name: string,
  args: Record<string, string>,
): Promise<{
  description: string
  messages: Array<{ role: string; content: string }>
}> {
  switch (name) {
    case 'setup_vpn':
      return {
        description: 'Guide for setting up VPN connection',
        messages: [
          {
            role: 'user',
            content: `I want to connect to a VPN${args.countryCode ? ` in ${args.countryCode}` : ''}. Please help me set up the connection.`,
          },
          {
            role: 'assistant',
            content: `I'll help you connect to the Jeju VPN network. First, let me check available nodes${args.countryCode ? ` in ${args.countryCode}` : ''}...

Use the \`get_vpn_nodes\` tool to see available exit nodes, then use \`vpn_connect\` to establish a connection.

The free tier includes unlimited VPN usage with fair contribution - you contribute up to 3x what you use in bandwidth sharing.`,
          },
        ],
      }

    case 'scrape_webpage':
      return {
        description: 'Guide for scraping a webpage through VPN',
        messages: [
          {
            role: 'user',
            content: `I want to scrape content from ${args.url}${args.countryCode ? ` using an exit node in ${args.countryCode}` : ''}.`,
          },
          {
            role: 'assistant',
            content: `I can help you scrape that webpage through the VPN network. This requires a small x402 payment for the proxy request.

Use the \`proxy_request\` tool with:
- url: ${args.url}
- method: GET
${args.countryCode ? `- countryCode: ${args.countryCode}` : ''}

The request will be routed through a VPN exit node, and you'll receive the page content.`,
          },
        ],
      }

    default:
      return {
        description: 'Unknown prompt',
        messages: [],
      }
  }
}
