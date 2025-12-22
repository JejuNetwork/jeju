/**
 * A2A Protocol Handler for VPN
 *
 * Enables agent-to-agent VPN access following the Jeju A2A protocol.
 * 
 * Uses fail-fast validation patterns
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Address } from 'viem';
import type { VPNServiceContext } from './types';
import { verifyAuth } from './auth';
import { verifyX402Payment } from './x402';
import {
  A2ARequestSchema,
  ProxyRequestSchema,
  expectValid,
  expect,
} from './schemas';
import {
  findBestNode,
  filterNodesByStatus,
  filterNodesByCountry,
  calculateNodeLoad,
} from './utils/nodes';
import {
  createSession,
  getSession,
  verifySessionOwnership,
  deleteSession,
  getSessionDuration,
  getSessionBytesTransferred,
} from './utils/sessions';
import {
  getOrCreateContribution,
  getQuotaRemaining,
  calculateContributionRatio,
} from './utils/contributions';
import type { z } from 'zod';

// Infer types from Zod schemas
type A2ARequest = z.infer<typeof A2ARequestSchema>;

// ============================================================================
// Router
// ============================================================================

export function createA2ARouter(ctx: VPNServiceContext): Hono {
  const router = new Hono();

  // Error handling middleware
  router.onError((err, c) => {
    console.error('A2A API error:', err);
    return c.json({
      jsonrpc: '2.0',
      id: 0,
      error: { code: -32603, message: err.message || 'Internal error' },
    }, 500);
  });

  /**
   * POST / - A2A JSON-RPC endpoint
   */
  router.post('/', async (c) => {
    const auth = await verifyAuth(c);
    const address = auth.valid ? auth.address as Address : null;
    
    const rawRequest = await c.req.json();
    const request = expectValid(A2ARequestSchema, rawRequest, 'A2A request');

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
          error: { code: -32601, message: `Method not found: ${request.method}` },
        });
    }
  });

  return router;
}

// ============================================================================
// Message Handler
// ============================================================================

async function handleMessage(
  c: Context,
  ctx: VPNServiceContext,
  request: A2ARequest,
  address: Address | null,
): Promise<Response> {
  const message = request.params.message;
  
  // Extract skill and params from message
  const dataPart = message.parts.find(p => p.kind === 'data');
  if (!dataPart || !dataPart.data) {
    throw new Error('Message must contain a data part with data object');
  }
  
  if (typeof dataPart.data !== 'object' || dataPart.data === null) {
    throw new Error('Data must be an object');
  }

  const skillId = dataPart.data.skillId as string;
  if (typeof skillId !== 'string' || skillId.length === 0) {
    throw new Error('skillId must be a non-empty string');
  }
  
  const params = dataPart.data.params as Record<string, unknown>;
  if (typeof params !== 'object' || params === null) {
    throw new Error('params must be an object');
  }

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
  c: Context,
  ctx: VPNServiceContext,
  request: A2ARequest,
  params: Record<string, unknown>,
  address: Address | null,
): Promise<Response> {
  if (!address) {
    throw new Error('Authentication required for VPN connection');
  }

  const countryCode = typeof params.countryCode === 'string' ? params.countryCode : undefined;
  const protocol = typeof params.protocol === 'string' ? params.protocol : 'wireguard';
  
  expect(['wireguard', 'socks5', 'http'].includes(protocol), `Invalid protocol: ${protocol}`);

  // Find best node using utility
  const node = findBestNode(ctx, countryCode);
  if (!node) {
    throw new Error('No available nodes matching criteria');
  }

  // Create session using utility
  const session = createSession(
    ctx,
    address,
    node.nodeId,
    protocol as 'wireguard' | 'socks5' | 'http'
  );

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
            connectionId: session.sessionId,
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
  c: Context,
  ctx: VPNServiceContext,
  request: A2ARequest,
  params: Record<string, unknown>,
  address: Address | null,
): Promise<Response> {
  const connectionId = typeof params.connectionId === 'string' ? params.connectionId : null;
  if (!connectionId || connectionId.length === 0) {
    throw new Error('connectionId must be a non-empty string');
  }
  
  if (!address) {
    throw new Error('Authentication required for disconnect');
  }
  
  const session = getSession(ctx, connectionId);
  verifySessionOwnership(session, address);

  const bytesTransferred = getSessionBytesTransferred(session);
  deleteSession(ctx, connectionId);

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
            duration: getSessionDuration(session),
          },
        },
      ],
    },
  });
}

async function handleGetNodes(
  c: Context,
  ctx: VPNServiceContext,
  request: A2ARequest,
  params: Record<string, unknown>,
): Promise<Response> {
  const countryCode = typeof params.countryCode === 'string' ? params.countryCode : undefined;
  
  let nodes = filterNodesByStatus(Array.from(ctx.nodes.values()), 'online');
  if (countryCode) {
    nodes = filterNodesByCountry(nodes, countryCode);
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
              load: calculateNodeLoad(n),
            })),
          },
        },
      ],
    },
  });
}

async function handleProxyRequest(
  c: Context,
  ctx: VPNServiceContext,
  request: A2ARequest,
  params: Record<string, unknown>,
): Promise<Response> {
  // Proxy requests require x402 payment
  const paymentHeader = c.req.header('x-payment');
  const paymentResult = await verifyX402Payment(
    paymentHeader || '',
    BigInt(ctx.config.pricing.pricePerRequest),
    'vpn:proxy',
    ctx.config,
  );

  expect(
    paymentResult.valid,
    paymentResult.error || 'Payment required. Include x-payment header with valid x402 payment.'
  );

  // Validate proxy request params
  const proxyRequest = expectValid(ProxyRequestSchema, params, 'proxy request params');

  const response = await fetch(proxyRequest.url, {
    method: proxyRequest.method,
    headers: proxyRequest.headers,
    body: proxyRequest.body,
  });

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
}

async function handleGetContribution(
  c: Context,
  ctx: VPNServiceContext,
  request: A2ARequest,
  address: Address | null,
): Promise<Response> {
  if (!address) {
    throw new Error('Authentication required for contribution status');
  }

  const contribution = getOrCreateContribution(ctx, address);
  const quotaRemaining = getQuotaRemaining(contribution);
  const contributionRatio = calculateContributionRatio(contribution);

  return c.json({
    jsonrpc: '2.0',
    id: request.id,
    result: {
      parts: [
        {
          kind: 'text',
          text: `You have used ${contribution.bytesUsed} bytes and contributed ${contribution.bytesContributed} bytes (${contributionRatio.toFixed(2)}x ratio)`,
        },
        {
          kind: 'data',
          data: {
            bytesUsed: contribution.bytesUsed.toString(),
            bytesContributed: contribution.bytesContributed.toString(),
            quotaRemaining: quotaRemaining.toString(),
            contributionRatio,
          },
        },
      ],
    },
  });
}

interface AgentCard {
  protocolVersion: string;
  name: string;
  url: string;
  skills: string[];
}

async function getAgentCard(ctx: VPNServiceContext): Promise<{ card: AgentCard }> {
  return {
    card: {
      protocolVersion: '1.0',
      name: 'Jeju VPN Agent',
      url: ctx.config.publicUrl,
      skills: ['vpn_connect', 'vpn_disconnect', 'get_nodes', 'proxy_request', 'get_contribution'],
    },
  };
}

