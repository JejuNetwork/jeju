/**
 * A2A Protocol Handler for VPN
 *
 * Enables agent-to-agent VPN access following the Jeju A2A protocol.
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import type { VPNServiceContext, ProxyRequest } from './types';
import { verifyAuth, getAuthAddress } from './auth';
import { verifyX402Payment } from './x402';

// ============================================================================
// Types
// ============================================================================

interface A2AMessage {
  role: 'user' | 'agent';
  parts: Array<{
    kind: 'text' | 'data';
    text?: string;
    data?: Record<string, unknown>;
  }>;
  messageId: string;
}

interface A2ARequest {
  jsonrpc: '2.0';
  method: string;
  params: {
    message: A2AMessage;
  };
  id: number;
}

interface A2AResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    parts: Array<{
      kind: 'text' | 'data';
      text?: string;
      data?: Record<string, unknown>;
    }>;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ============================================================================
// Router
// ============================================================================

export function createA2ARouter(ctx: VPNServiceContext): Hono {
  const router = new Hono();

  /**
   * POST / - A2A JSON-RPC endpoint
   */
  router.post('/', async (c) => {
    const auth = await verifyAuth(c);
    const address = auth.valid ? auth.address as Address : null;
    
    const request = await c.req.json() as A2ARequest;
    
    if (request.jsonrpc !== '2.0') {
      return c.json({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32600, message: 'Invalid JSON-RPC version' },
      });
    }

    // Route based on method
    switch (request.method) {
      case 'message/send':
        return handleMessage(c, ctx, request, address);
      
      case 'agent/card':
        return c.json({
          jsonrpc: '2.0',
          id: request.id,
          result: await getAgentCard(ctx),
        });
      
      default:
        return c.json({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Method not found' },
        });
    }
  });

  return router;
}

// ============================================================================
// Message Handler
// ============================================================================

async function handleMessage(
  c: any,
  ctx: VPNServiceContext,
  request: A2ARequest,
  address: Address | null,
): Promise<Response> {
  const message = request.params.message;
  
  // Extract skill and params from message
  const dataPart = message.parts.find(p => p.kind === 'data');
  if (!dataPart?.data) {
    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32602, message: 'Missing skill data' },
    });
  }

  const skillId = dataPart.data.skillId as string;
  const params = dataPart.data.params as Record<string, unknown>;

  // Handle each skill
  switch (skillId) {
    case 'vpn_connect':
      return handleConnect(c, ctx, request, params, address);
    
    case 'vpn_disconnect':
      return handleDisconnect(c, ctx, request, params, address);
    
    case 'get_nodes':
      return handleGetNodes(c, ctx, request, params);
    
    case 'proxy_request':
      return handleProxyRequest(c, ctx, request, params);
    
    case 'get_contribution':
      return handleGetContribution(c, ctx, request, address);
    
    default:
      return c.json({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Unknown skill: ${skillId}` },
      });
  }
}

// ============================================================================
// Skill Handlers
// ============================================================================

async function handleConnect(
  c: any,
  ctx: VPNServiceContext,
  request: A2ARequest,
  params: Record<string, unknown>,
  address: Address | null,
): Promise<Response> {
  if (!address) {
    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: 401, message: 'Authentication required' },
    });
  }

  const countryCode = params.countryCode as string | undefined;
  const protocol = (params.protocol as string) || 'wireguard';

  // Find best node
  let nodes = Array.from(ctx.nodes.values()).filter(n => n.status === 'online');
  if (countryCode) {
    nodes = nodes.filter(n => n.countryCode === countryCode.toUpperCase());
  }

  if (nodes.length === 0) {
    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: 503, message: 'No available nodes' },
    });
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

  return c.json({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: `Connected to VPN node in ${node.countryCode}`,
        },
        {
          kind: 'data',
          data: {
            connectionId: sessionId,
            endpoint: node.endpoint,
            publicKey: node.wireguardPubKey,
            countryCode: node.countryCode,
          },
        },
      ],
    },
  });
}

async function handleDisconnect(
  c: any,
  ctx: VPNServiceContext,
  request: A2ARequest,
  params: Record<string, unknown>,
  address: Address | null,
): Promise<Response> {
  const connectionId = params.connectionId as string;
  const session = ctx.sessions.get(connectionId);

  if (!session) {
    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: 404, message: 'Session not found' },
    });
  }

  const bytesTransferred = session.bytesUp + session.bytesDown;
  ctx.sessions.delete(connectionId);

  return c.json({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: 'VPN disconnected successfully',
        },
        {
          kind: 'data',
          data: {
            success: true,
            bytesTransferred: bytesTransferred.toString(),
            duration: Date.now() - session.startTime,
          },
        },
      ],
    },
  });
}

async function handleGetNodes(
  c: any,
  ctx: VPNServiceContext,
  request: A2ARequest,
  params: Record<string, unknown>,
): Promise<Response> {
  const countryCode = params.countryCode as string | undefined;
  
  let nodes = Array.from(ctx.nodes.values()).filter(n => n.status === 'online');
  if (countryCode) {
    nodes = nodes.filter(n => n.countryCode === countryCode.toUpperCase());
  }

  return c.json({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: `Found ${nodes.length} available VPN nodes`,
        },
        {
          kind: 'data',
          data: {
            nodes: nodes.map(n => ({
              nodeId: n.nodeId,
              countryCode: n.countryCode,
              status: n.status,
              load: Math.round((n.activeConnections / n.maxConnections) * 100),
            })),
          },
        },
      ],
    },
  });
}

async function handleProxyRequest(
  c: any,
  ctx: VPNServiceContext,
  request: A2ARequest,
  params: Record<string, unknown>,
): Promise<Response> {
  // Proxy requests require x402 payment
  const paymentHeader = c.req.header('x-payment');
  const paymentResult = await verifyX402Payment(
    paymentHeader || '',
    ctx.config.pricing.pricePerRequest,
    'vpn:proxy',
    ctx.config,
  );

  if (!paymentResult.valid) {
    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: 402,
        message: 'Payment required',
        data: {
          amount: ctx.config.pricing.pricePerRequest.toString(),
          recipient: ctx.config.paymentRecipient,
          resource: 'vpn:proxy',
        },
      },
    });
  }

  const url = params.url as string;
  const method = (params.method as string) || 'GET';
  const headers = params.headers as Record<string, string> | undefined;
  const body = params.body as string | undefined;

  try {
    const response = await fetch(url, { method, headers, body });
    const responseBody = await response.text();

    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        parts: [
          {
            kind: 'text',
            text: `Proxy request completed: ${response.status} ${response.statusText}`,
          },
          {
            kind: 'data',
            data: {
              status: response.status,
              body: responseBody.slice(0, 10000), // Limit response size
            },
          },
        ],
      },
    });
  } catch (error) {
    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: 502,
        message: error instanceof Error ? error.message : 'Proxy request failed',
      },
    });
  }
}

async function handleGetContribution(
  c: any,
  ctx: VPNServiceContext,
  request: A2ARequest,
  address: Address | null,
): Promise<Response> {
  if (!address) {
    return c.json({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: 401, message: 'Authentication required' },
    });
  }

  const contribution = ctx.contributions.get(address);

  return c.json({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: contribution 
            ? `You have used ${contribution.bytesUsed} bytes and contributed ${contribution.bytesContributed} bytes`
            : 'No contribution data yet - start using VPN to track usage',
        },
        {
          kind: 'data',
          data: contribution ? {
            bytesUsed: contribution.bytesUsed.toString(),
            bytesContributed: contribution.bytesContributed.toString(),
            quotaRemaining: (contribution.cap - contribution.bytesContributed).toString(),
          } : {
            bytesUsed: '0',
            bytesContributed: '0',
            quotaRemaining: '0',
          },
        },
      ],
    },
  });
}

async function getAgentCard(ctx: VPNServiceContext): Promise<{ card: unknown }> {
  return {
    card: {
      protocolVersion: '1.0',
      name: 'Jeju VPN Agent',
      url: ctx.config.publicUrl,
      skills: ['vpn_connect', 'vpn_disconnect', 'get_nodes', 'proxy_request', 'get_contribution'],
    },
  };
}

