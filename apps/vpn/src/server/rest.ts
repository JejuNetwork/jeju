/**
 * REST API for VPN operations
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import type { VPNServiceContext, ProxyRequest } from './types';
import { verifyAuth, getAuthAddress } from './auth';
import { verifyX402Payment } from './x402';

export function createRESTRouter(ctx: VPNServiceContext): Hono {
  const router = new Hono();

  // ========== Public Endpoints ==========

  /**
   * GET /nodes - List available VPN nodes
   */
  router.get('/nodes', async (c) => {
    const countryCode = c.req.query('country');
    const capability = c.req.query('capability');
    
    let nodes = Array.from(ctx.nodes.values());
    
    if (countryCode) {
      nodes = nodes.filter(n => n.countryCode === countryCode.toUpperCase());
    }
    
    if (capability) {
      // Filter by capability if needed
    }
    
    // Sort by status and connections
    nodes.sort((a, b) => {
      if (a.status === 'online' && b.status !== 'online') return -1;
      if (a.status !== 'online' && b.status === 'online') return 1;
      return a.activeConnections - b.activeConnections;
    });

    return c.json({
      nodes: nodes.map(n => ({
        nodeId: n.nodeId,
        countryCode: n.countryCode,
        endpoint: n.endpoint,
        status: n.status,
        load: Math.round((n.activeConnections / n.maxConnections) * 100),
      })),
      total: nodes.length,
    });
  });

  /**
   * GET /nodes/:nodeId - Get node details
   */
  router.get('/nodes/:nodeId', async (c) => {
    const nodeId = c.req.param('nodeId');
    const node = ctx.nodes.get(nodeId);
    
    if (!node) {
      return c.json({ error: 'Node not found' }, 404);
    }

    return c.json({ node });
  });

  /**
   * GET /countries - List available countries
   */
  router.get('/countries', async (c) => {
    const countries = new Map<string, number>();
    
    for (const node of ctx.nodes.values()) {
      const count = countries.get(node.countryCode) || 0;
      countries.set(node.countryCode, count + 1);
    }

    return c.json({
      countries: Array.from(countries.entries()).map(([code, count]) => ({
        code,
        nodeCount: count,
      })),
    });
  });

  /**
   * GET /pricing - Get VPN pricing
   */
  router.get('/pricing', (c) => {
    return c.json({
      freeTier: {
        description: 'Unlimited VPN with fair contribution',
        contributionRequired: '10% bandwidth, capped at 3x usage',
        features: ['Unlimited VPN', 'All countries', 'WireGuard & SOCKS5'],
      },
      paidTier: {
        pricePerGB: ctx.config.pricing.pricePerGB.toString(),
        pricePerHour: ctx.config.pricing.pricePerHour.toString(),
        pricePerRequest: ctx.config.pricing.pricePerRequest.toString(),
        features: ['Priority routing', 'No contribution required', 'Higher speeds'],
        paymentTokens: ctx.config.pricing.supportedTokens,
      },
    });
  });

  // ========== Authenticated Endpoints ==========

  /**
   * POST /connect - Establish VPN connection
   */
  router.post('/connect', async (c) => {
    const auth = await verifyAuth(c);
    if (!auth.valid) {
      return c.json({ error: auth.error }, 401);
    }

    const body = await c.req.json() as {
      nodeId?: string;
      countryCode?: string;
      protocol?: 'wireguard' | 'socks5';
    };

    // Find best node
    let targetNode = body.nodeId 
      ? ctx.nodes.get(body.nodeId)
      : findBestNode(ctx, body.countryCode);

    if (!targetNode) {
      return c.json({ error: 'No available nodes' }, 503);
    }

    // Create session
    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = {
      sessionId,
      clientAddress: auth.address as Address,
      nodeId: targetNode.nodeId,
      protocol: body.protocol || 'wireguard',
      startTime: Date.now(),
      bytesUp: BigInt(0),
      bytesDown: BigInt(0),
      isPaid: false,
      paymentAmount: BigInt(0),
    };

    ctx.sessions.set(sessionId, session);

    // Return connection details
    return c.json({
      sessionId,
      node: {
        nodeId: targetNode.nodeId,
        countryCode: targetNode.countryCode,
        endpoint: targetNode.endpoint,
        publicKey: targetNode.wireguardPubKey,
      },
      protocol: session.protocol,
      // For WireGuard, return config
      wireguardConfig: session.protocol === 'wireguard' ? {
        endpoint: targetNode.endpoint,
        publicKey: targetNode.wireguardPubKey,
        allowedIPs: ['0.0.0.0/0', '::/0'],
        persistentKeepalive: 25,
      } : undefined,
      // For SOCKS5, return proxy details
      socks5Config: session.protocol === 'socks5' ? {
        host: targetNode.endpoint.split(':')[0],
        port: 1080,
        username: sessionId,
        password: auth.address,
      } : undefined,
    });
  });

  /**
   * POST /disconnect - End VPN session
   */
  router.post('/disconnect', async (c) => {
    const auth = await verifyAuth(c);
    if (!auth.valid) {
      return c.json({ error: auth.error }, 401);
    }

    const body = await c.req.json() as { sessionId: string };
    const session = ctx.sessions.get(body.sessionId);

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    if (session.clientAddress !== auth.address) {
      return c.json({ error: 'Not your session' }, 403);
    }

    // End session
    ctx.sessions.delete(body.sessionId);

    return c.json({
      success: true,
      duration: Date.now() - session.startTime,
      bytesUp: session.bytesUp.toString(),
      bytesDown: session.bytesDown.toString(),
    });
  });

  /**
   * GET /session/:sessionId - Get session status
   */
  router.get('/session/:sessionId', async (c) => {
    const auth = await verifyAuth(c);
    if (!auth.valid) {
      return c.json({ error: auth.error }, 401);
    }

    const sessionId = c.req.param('sessionId');
    const session = ctx.sessions.get(sessionId);

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    if (session.clientAddress !== auth.address) {
      return c.json({ error: 'Not your session' }, 403);
    }

    return c.json({
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      protocol: session.protocol,
      startTime: session.startTime,
      duration: Date.now() - session.startTime,
      bytesUp: session.bytesUp.toString(),
      bytesDown: session.bytesDown.toString(),
      isPaid: session.isPaid,
    });
  });

  /**
   * POST /proxy - Make a proxied HTTP request (requires x402 payment)
   */
  router.post('/proxy', async (c) => {
    const paymentHeader = c.req.header('x-payment');
    
    // Verify x402 payment for proxy requests
    const paymentResult = await verifyX402Payment(
      paymentHeader || '',
      ctx.config.pricing.pricePerRequest,
      'vpn:proxy',
      ctx.config,
    );

    if (!paymentResult.valid) {
      // Return 402 Payment Required
      return c.json({
        error: 'Payment required',
        paymentDetails: {
          amount: ctx.config.pricing.pricePerRequest.toString(),
          recipient: ctx.config.paymentRecipient,
          resource: 'vpn:proxy',
          tokens: ctx.config.pricing.supportedTokens,
        },
      }, 402);
    }

    const body = await c.req.json() as ProxyRequest;

    // Validate URL
    try {
      new URL(body.url);
    } catch {
      return c.json({ error: 'Invalid URL' }, 400);
    }

    // Find exit node
    const exitNode = findBestNode(ctx, body.countryCode);
    if (!exitNode) {
      return c.json({ error: 'No available nodes' }, 503);
    }

    // Make proxied request
    const startTime = Date.now();
    try {
      const response = await fetch(body.url, {
        method: body.method || 'GET',
        headers: body.headers,
        body: body.body,
      });

      const responseBody = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });

      return c.json({
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
        exitNode: exitNode.nodeId,
        exitCountry: exitNode.countryCode,
        latencyMs: Date.now() - startTime,
      });
    } catch (error) {
      return c.json({
        error: 'Proxy request failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 502);
    }
  });

  /**
   * GET /contribution - Get contribution status
   */
  router.get('/contribution', async (c) => {
    const auth = await verifyAuth(c);
    if (!auth.valid) {
      return c.json({ error: auth.error }, 401);
    }

    const contribution = ctx.contributions.get(auth.address as string);
    
    if (!contribution) {
      // New user, no contribution yet
      return c.json({
        bytesUsed: '0',
        bytesContributed: '0',
        cap: '0',
        quotaRemaining: '0',
        periodStart: Date.now(),
        periodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
        isNewUser: true,
      });
    }

    return c.json({
      bytesUsed: contribution.bytesUsed.toString(),
      bytesContributed: contribution.bytesContributed.toString(),
      cap: contribution.cap.toString(),
      quotaRemaining: (contribution.cap - contribution.bytesContributed).toString(),
      periodStart: contribution.periodStart,
      periodEnd: contribution.periodEnd,
      contributionRatio: Number(contribution.bytesContributed) / Math.max(1, Number(contribution.bytesUsed)),
    });
  });

  /**
   * POST /contribution/settings - Update contribution settings
   */
  router.post('/contribution/settings', async (c) => {
    const auth = await verifyAuth(c);
    if (!auth.valid) {
      return c.json({ error: auth.error }, 401);
    }

    const body = await c.req.json() as {
      enabled?: boolean;
      maxBandwidthPercent?: number;
      shareCDN?: boolean;
      shareVPNRelay?: boolean;
      earningMode?: boolean;
    };

    // Store settings (would persist to DB in production)
    return c.json({
      success: true,
      settings: body,
    });
  });

  return router;
}

function findBestNode(ctx: VPNServiceContext, countryCode?: string): VPNNodeState | undefined {
  let nodes = Array.from(ctx.nodes.values()).filter(n => n.status === 'online');
  
  if (countryCode) {
    nodes = nodes.filter(n => n.countryCode === countryCode.toUpperCase());
  }

  if (nodes.length === 0) return undefined;

  // Sort by load
  nodes.sort((a, b) => {
    const loadA = a.activeConnections / a.maxConnections;
    const loadB = b.activeConnections / b.maxConnections;
    return loadA - loadB;
  });

  return nodes[0];
}

