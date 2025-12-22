/**
 * REST API for VPN operations
 * 
 * All endpoints use Zod validation and fail-fast patterns
 */

import { Hono } from 'hono';
import type { VPNServiceContext, VPNNodeState } from './types';
import { verifyAuth } from './auth';
import { verifyX402Payment } from './x402';
import {
  ConnectRequestSchema,
  DisconnectRequestSchema,
  ProxyRequestSchema,
  ContributionSettingsRequestSchema,
  NodesQuerySchema,
  expectValid,
  expect,
} from './schemas';
import {
  findBestNode,
  sortNodesByStatusAndLoad,
  getNodesByCountry,
  calculateNodeLoad,
  getNodeById,
} from './utils/nodes';
import {
  createSession,
  getSession,
  verifySessionOwnership,
  deleteSession,
  getSessionDuration,
} from './utils/sessions';
import {
  getOrCreateContribution,
  getQuotaRemaining,
  calculateContributionRatio,
  isContributionPeriodExpired,
  resetContributionPeriod,
} from './utils/contributions';

export function createRESTRouter(ctx: VPNServiceContext): Hono {
  const router = new Hono();

  // Error handling middleware
  router.onError((err, c) => {
    console.error('REST API error:', err);
    return c.json({ error: err.message || 'Internal server error' }, 500);
  });

  // ========== Public Endpoints ==========

  /**
   * GET /nodes - List available VPN nodes
   */
  router.get('/nodes', async (c) => {
    // Hono query() returns Record<string, string | string[] | undefined>
    // Convert to plain object for Zod validation
    const queryParams: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(c.req.query())) {
      queryParams[key] = Array.isArray(value) ? value[0] : value;
    }
    const query = expectValid(NodesQuerySchema, queryParams, 'nodes query params');
    
    let nodes = Array.from(ctx.nodes.values());
    
    if (query.country) {
      nodes = nodes.filter(n => n.countryCode === query.country);
    }
    
    // Sort by status and connections
    nodes = sortNodesByStatusAndLoad(nodes);

    return c.json({
      nodes: nodes.map(n => ({
        nodeId: n.nodeId,
        countryCode: n.countryCode,
        endpoint: n.endpoint,
        status: n.status,
        load: calculateNodeLoad(n),
      })),
      total: nodes.length,
    });
  });

  /**
   * GET /nodes/:nodeId - Get node details
   */
  router.get('/nodes/:nodeId', async (c) => {
    const nodeId = c.req.param('nodeId');
    if (!nodeId || nodeId.length === 0) {
      throw new Error('Node ID required');
    }
    
    const node = getNodeById(ctx, nodeId);
    return c.json({ node });
  });

  /**
   * GET /countries - List available countries
   */
  router.get('/countries', async (c) => {
    const countries = getNodesByCountry(ctx);

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
    expect(auth.valid, auth.error || 'Authentication required');
    if (!auth.address) {
      throw new Error('Authentication address missing');
    }

    const rawBody = await c.req.json();
    const body = expectValid(ConnectRequestSchema, rawBody, 'connect request');

    // Find best node
    let targetNode: VPNNodeState | undefined;
    if (body.nodeId) {
      targetNode = getNodeById(ctx, body.nodeId);
    } else {
      targetNode = findBestNode(ctx, body.countryCode);
    }

    expect(targetNode !== undefined, 'No available nodes matching criteria');

    // Create session using utility
    const session = createSession(
      ctx,
      auth.address,
      targetNode.nodeId,
      body.protocol || 'wireguard'
    );

    // Return connection details
    return c.json({
      sessionId: session.sessionId,
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
        username: session.sessionId,
        password: auth.address,
      } : undefined,
    });
  });

  /**
   * POST /disconnect - End VPN session
   */
  router.post('/disconnect', async (c) => {
    const auth = await verifyAuth(c);
    expect(auth.valid, auth.error || 'Authentication required');
    if (!auth.address) {
      throw new Error('Authentication address missing');
    }

    const rawBody = await c.req.json();
    const body = expectValid(DisconnectRequestSchema, rawBody, 'disconnect request');
    
    const session = getSession(ctx, body.sessionId);
    verifySessionOwnership(session, auth.address);

    // End session
    deleteSession(ctx, body.sessionId);

    return c.json({
      success: true,
      duration: getSessionDuration(session),
      bytesUp: session.bytesUp.toString(),
      bytesDown: session.bytesDown.toString(),
    });
  });

  /**
   * GET /session/:sessionId - Get session status
   */
  router.get('/session/:sessionId', async (c) => {
    const auth = await verifyAuth(c);
    expect(auth.valid, auth.error || 'Authentication required');
    if (!auth.address) {
      throw new Error('Authentication address missing');
    }

    const sessionIdParam = c.req.param('sessionId');
    if (!sessionIdParam || sessionIdParam.length === 0) {
      throw new Error('Session ID required');
    }
    
    const session = getSession(ctx, sessionIdParam);
    verifySessionOwnership(session, auth.address);

    return c.json({
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      protocol: session.protocol,
      startTime: session.startTime,
      duration: getSessionDuration(session),
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
      BigInt(ctx.config.pricing.pricePerRequest),
      'vpn:proxy',
      ctx.config,
    );

    expect(
      paymentResult.valid,
      paymentResult.error || 'Payment required. Include x-payment header with valid x402 payment.'
    );

    const rawBody = await c.req.json();
    const body = expectValid(ProxyRequestSchema, rawBody, 'proxy request');

    // Find exit node
    const exitNode = findBestNode(ctx, body.countryCode);
    expect(exitNode !== undefined, 'No available nodes matching criteria');

    // Make proxied request
    const startTime = Date.now();
    const response = await fetch(body.url, {
      method: body.method,
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
  });

  /**
   * GET /contribution - Get contribution status
   */
  router.get('/contribution', async (c) => {
    const auth = await verifyAuth(c);
    expect(auth.valid, auth.error || 'Authentication required');
    if (!auth.address) {
      throw new Error('Authentication address missing');
    }

    const contribution = getOrCreateContribution(ctx, auth.address);
    
    // Check if this is a new user (no usage yet)
    if (contribution.bytesUsed === BigInt(0) && contribution.bytesContributed === BigInt(0)) {
      const now = Date.now();
      const periodEnd = now + 30 * 24 * 60 * 60 * 1000;
      return c.json({
        bytesUsed: '0',
        bytesContributed: '0',
        cap: '0',
        quotaRemaining: '0',
        periodStart: now,
        periodEnd,
        isNewUser: true,
      });
    }

    // Check if period expired and reset if needed
    if (isContributionPeriodExpired(contribution)) {
      resetContributionPeriod(contribution);
    }

    const quotaRemaining = getQuotaRemaining(contribution);
    const contributionRatio = calculateContributionRatio(contribution);

    return c.json({
      bytesUsed: contribution.bytesUsed.toString(),
      bytesContributed: contribution.bytesContributed.toString(),
      cap: contribution.cap.toString(),
      quotaRemaining: quotaRemaining.toString(),
      periodStart: contribution.periodStart,
      periodEnd: contribution.periodEnd,
      contributionRatio,
    });
  });

  /**
   * POST /contribution/settings - Update contribution settings
   */
  router.post('/contribution/settings', async (c) => {
    const auth = await verifyAuth(c);
    expect(auth.valid, auth.error || 'Authentication required');
    if (!auth.address) {
      throw new Error('Authentication address missing');
    }

    const rawBody = await c.req.json();
    const body = expectValid(ContributionSettingsRequestSchema, rawBody, 'contribution settings');

    // Store settings (would persist to DB in production)
    return c.json({
      success: true,
      settings: body,
    });
  });

  return router;
}

