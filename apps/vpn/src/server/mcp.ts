/**
 * MCP (Model Context Protocol) Handler for VPN
 *
 * Enables AI agents (Claude, GPT, etc.) to:
 * - Connect to VPN
 * - Make proxied requests
 * - Query VPN status
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import type { VPNServiceContext } from './types';
import { verifyAuth } from './auth';
import { verifyX402Payment } from './x402';

// ============================================================================
// Types
// ============================================================================

interface MCPServerInfo {
  name: string;
  version: string;
  description: string;
  capabilities: {
    resources: boolean;
    tools: boolean;
    prompts: boolean;
  };
}

interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

interface MCPPrompt {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}

// ============================================================================
// Server Info
// ============================================================================

const MCP_SERVER_INFO: MCPServerInfo = {
  name: 'jeju-vpn-mcp',
  version: '1.0.0',
  description: 'Jeju VPN MCP Server - Decentralized VPN and proxy services',
  capabilities: {
    resources: true,
    tools: true,
    prompts: true,
  },
};

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
];

const MCP_TOOLS: MCPTool[] = [
  {
    name: 'vpn_connect',
    description: 'Connect to a VPN exit node. Returns connection details including WireGuard config.',
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
    description: 'Make an HTTP request through the VPN network. Requires x402 payment.',
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
];

const MCP_PROMPTS: MCPPrompt[] = [
  {
    name: 'setup_vpn',
    description: 'Walk through VPN setup and connection',
    arguments: [
      { name: 'countryCode', description: 'Preferred exit country', required: false },
    ],
  },
  {
    name: 'scrape_webpage',
    description: 'Scrape content from a webpage through VPN',
    arguments: [
      { name: 'url', description: 'URL to scrape', required: true },
      { name: 'countryCode', description: 'Exit country for geo-specific content', required: false },
    ],
  },
];

// ============================================================================
// Router
// ============================================================================

export function createMCPRouter(ctx: VPNServiceContext): Hono {
  const router = new Hono();

  /**
   * POST /initialize - Initialize MCP session
   */
  router.post('/initialize', (c) => {
    return c.json({
      protocolVersion: '2024-11-05',
      serverInfo: MCP_SERVER_INFO,
      capabilities: MCP_SERVER_INFO.capabilities,
    });
  });

  /**
   * POST /resources/list - List available resources
   */
  router.post('/resources/list', (c) => {
    return c.json({ resources: MCP_RESOURCES });
  });

  /**
   * POST /resources/read - Read a resource
   */
  router.post('/resources/read', async (c) => {
    const auth = await verifyAuth(c);
    const address = auth.valid ? auth.address : null;

    const { uri } = await c.req.json() as { uri: string };

    const content = await readResource(ctx, uri, address as Address | null);
    const resource = MCP_RESOURCES.find(r => r.uri === uri);

    return c.json({
      contents: [{
        uri,
        mimeType: resource?.mimeType || 'application/json',
        text: JSON.stringify(content, null, 2),
      }],
    });
  });

  /**
   * POST /tools/list - List available tools
   */
  router.post('/tools/list', (c) => {
    return c.json({ tools: MCP_TOOLS });
  });

  /**
   * POST /tools/call - Call a tool
   */
  router.post('/tools/call', async (c) => {
    const auth = await verifyAuth(c);
    const address = auth.valid ? auth.address : null;

    const { name, arguments: args } = await c.req.json() as { 
      name: string; 
      arguments: Record<string, unknown>;
    };

    const result = await callTool(ctx, c, name, args, address as Address | null);

    return c.json({
      content: [{
        type: 'text',
        text: JSON.stringify(result.result, null, 2),
      }],
      isError: result.isError,
    });
  });

  /**
   * POST /prompts/list - List available prompts
   */
  router.post('/prompts/list', (c) => {
    return c.json({ prompts: MCP_PROMPTS });
  });

  /**
   * POST /prompts/get - Get a prompt
   */
  router.post('/prompts/get', async (c) => {
    const { name, arguments: args } = await c.req.json() as {
      name: string;
      arguments: Record<string, string>;
    };

    const prompt = await getPrompt(ctx, name, args);

    return c.json({
      description: prompt.description,
      messages: prompt.messages,
    });
  });

  return router;
}

// ============================================================================
// Resource Reader
// ============================================================================

async function readResource(
  ctx: VPNServiceContext,
  uri: string,
  address: Address | null,
): Promise<unknown> {
  switch (uri) {
    case 'vpn://nodes':
      return {
        nodes: Array.from(ctx.nodes.values()).map(n => ({
          nodeId: n.nodeId,
          countryCode: n.countryCode,
          status: n.status,
          load: Math.round((n.activeConnections / n.maxConnections) * 100),
        })),
      };

    case 'vpn://countries':
      const countries = new Map<string, number>();
      for (const node of ctx.nodes.values()) {
        countries.set(node.countryCode, (countries.get(node.countryCode) || 0) + 1);
      }
      return {
        countries: Array.from(countries.entries()).map(([code, count]) => ({
          code,
          nodeCount: count,
        })),
      };

    case 'vpn://status':
      if (!address) return { connected: false, message: 'Not authenticated' };
      const sessions = Array.from(ctx.sessions.values())
        .filter(s => s.clientAddress === address);
      return {
        connected: sessions.length > 0,
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          nodeId: s.nodeId,
          protocol: s.protocol,
          duration: Date.now() - s.startTime,
        })),
      };

    case 'vpn://contribution':
      if (!address) return { error: 'Authentication required' };
      const contribution = ctx.contributions.get(address);
      return contribution ? {
        bytesUsed: contribution.bytesUsed.toString(),
        bytesContributed: contribution.bytesContributed.toString(),
        cap: contribution.cap.toString(),
        quotaRemaining: (contribution.cap - contribution.bytesContributed).toString(),
      } : {
        bytesUsed: '0',
        bytesContributed: '0',
        cap: '0',
        quotaRemaining: '0',
      };

    case 'vpn://pricing':
      return {
        pricePerGB: ctx.config.pricing.pricePerGB.toString(),
        pricePerHour: ctx.config.pricing.pricePerHour.toString(),
        pricePerRequest: ctx.config.pricing.pricePerRequest.toString(),
        supportedTokens: ctx.config.pricing.supportedTokens,
      };

    default:
      return { error: 'Resource not found' };
  }
}

// ============================================================================
// Tool Caller
// ============================================================================

async function callTool(
  ctx: VPNServiceContext,
  c: any,
  name: string,
  args: Record<string, unknown>,
  address: Address | null,
): Promise<{ result: unknown; isError: boolean }> {
  switch (name) {
    case 'vpn_connect': {
      if (!address) {
        return { result: { error: 'Authentication required' }, isError: true };
      }

      const countryCode = args.countryCode as string | undefined;
      const protocol = (args.protocol as string) || 'wireguard';

      let nodes = Array.from(ctx.nodes.values()).filter(n => n.status === 'online');
      if (countryCode) {
        nodes = nodes.filter(n => n.countryCode === countryCode.toUpperCase());
      }

      if (nodes.length === 0) {
        return { result: { error: 'No available nodes' }, isError: true };
      }

      const node = nodes[0];
      const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      ctx.sessions.set(sessionId, {
        sessionId,
        clientAddress: address,
        nodeId: node.nodeId,
        protocol: protocol as 'wireguard' | 'socks5' | 'http',
        startTime: Date.now(),
        bytesUp: BigInt(0),
        bytesDown: BigInt(0),
        isPaid: false,
        paymentAmount: BigInt(0),
      });

      return {
        result: {
          connectionId: sessionId,
          endpoint: node.endpoint,
          publicKey: node.wireguardPubKey,
          countryCode: node.countryCode,
        },
        isError: false,
      };
    }

    case 'vpn_disconnect': {
      const connectionId = args.connectionId as string;
      const session = ctx.sessions.get(connectionId);
      
      if (!session) {
        return { result: { error: 'Session not found' }, isError: true };
      }

      ctx.sessions.delete(connectionId);
      return {
        result: {
          success: true,
          bytesTransferred: (session.bytesUp + session.bytesDown).toString(),
        },
        isError: false,
      };
    }

    case 'get_vpn_nodes': {
      const countryCode = args.countryCode as string | undefined;
      
      let nodes = Array.from(ctx.nodes.values());
      if (countryCode) {
        nodes = nodes.filter(n => n.countryCode === countryCode.toUpperCase());
      }

      return {
        result: {
          nodes: nodes.map(n => ({
            nodeId: n.nodeId,
            countryCode: n.countryCode,
            status: n.status,
            load: Math.round((n.activeConnections / n.maxConnections) * 100),
          })),
        },
        isError: false,
      };
    }

    case 'proxy_request': {
      const paymentHeader = c.req.header('x-payment');
      const paymentResult = await verifyX402Payment(
        paymentHeader || '',
        ctx.config.pricing.pricePerRequest,
        'vpn:proxy',
        ctx.config,
      );

      if (!paymentResult.valid) {
        return {
          result: {
            error: 'Payment required',
            paymentDetails: {
              amount: ctx.config.pricing.pricePerRequest.toString(),
              recipient: ctx.config.paymentRecipient,
              resource: 'vpn:proxy',
            },
          },
          isError: true,
        };
      }

      const url = args.url as string;
      const method = (args.method as string) || 'GET';
      const headers = args.headers as Record<string, string> | undefined;
      const body = args.body as string | undefined;

      try {
        const response = await fetch(url, { method, headers, body });
        const responseBody = await response.text();

        return {
          result: {
            status: response.status,
            body: responseBody.slice(0, 10000),
          },
          isError: false,
        };
      } catch (error) {
        return {
          result: { error: error instanceof Error ? error.message : 'Request failed' },
          isError: true,
        };
      }
    }

    case 'get_contribution_status': {
      if (!address) {
        return { result: { error: 'Authentication required' }, isError: true };
      }

      const contribution = ctx.contributions.get(address);
      return {
        result: contribution ? {
          bytesUsed: contribution.bytesUsed.toString(),
          bytesContributed: contribution.bytesContributed.toString(),
          quotaRemaining: (contribution.cap - contribution.bytesContributed).toString(),
        } : {
          bytesUsed: '0',
          bytesContributed: '0',
          quotaRemaining: '0',
        },
        isError: false,
      };
    }

    default:
      return { result: { error: 'Unknown tool' }, isError: true };
  }
}

// ============================================================================
// Prompt Generator
// ============================================================================

async function getPrompt(
  ctx: VPNServiceContext,
  name: string,
  args: Record<string, string>,
): Promise<{ description: string; messages: Array<{ role: string; content: string }> }> {
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
      };

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
      };

    default:
      return {
        description: 'Unknown prompt',
        messages: [],
      };
  }
}

