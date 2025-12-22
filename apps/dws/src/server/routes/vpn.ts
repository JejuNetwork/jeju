/**
 * VPN/Proxy Service Routes
 * Residential proxy network integration
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import { validateBody, validateParams, validateQuery, validateHeaders, jejuAddressHeaderSchema, vpnNodeRegistrationSchema, vpnNodeHeartbeatSchema, vpnSessionRequestSchema, vpnNodeParamsSchema, vpnSessionParamsSchema, vpnNodesQuerySchema, z } from '../../shared';

interface ProxyNode {
  id: string;
  operator: Address;
  endpoint: string;
  region: string;
  country: string;
  city?: string;
  type: 'residential' | 'datacenter' | 'mobile';
  protocol: 'http' | 'https' | 'socks5';
  port: number;
  bandwidth: number; // Mbps
  latency: number;   // ms
  uptime: number;    // percentage
  lastSeen: number;
  status: 'active' | 'inactive' | 'maintenance';
  metadata: Record<string, string>;
}

interface ProxySession {
  id: string;
  user: Address;
  nodeId: string;
  startedAt: number;
  expiresAt: number;
  bytesTransferred: number;
  requestCount: number;
  status: 'active' | 'expired' | 'terminated';
}

const proxyNodes = new Map<string, ProxyNode>();
const sessions = new Map<string, ProxySession>();

// Supported regions
const REGIONS = [
  { code: 'us-east', name: 'US East', country: 'US' },
  { code: 'us-west', name: 'US West', country: 'US' },
  { code: 'eu-west', name: 'EU West', country: 'GB' },
  { code: 'eu-central', name: 'EU Central', country: 'DE' },
  { code: 'asia-east', name: 'Asia East', country: 'JP' },
  { code: 'asia-south', name: 'Asia South', country: 'SG' },
];

export function createVPNRouter(): Hono {
  const router = new Hono();

  // ============================================================================
  // Health & Info
  // ============================================================================

  router.get('/health', (c) => {
    const activeNodes = Array.from(proxyNodes.values())
      .filter(n => n.status === 'active').length;
    const activeSessions = Array.from(sessions.values())
      .filter(s => s.status === 'active').length;

    return c.json({
      status: 'healthy',
      service: 'dws-vpn',
      nodes: {
        total: proxyNodes.size,
        active: activeNodes,
      },
      sessions: {
        total: sessions.size,
        active: activeSessions,
      },
      regions: REGIONS.length,
    });
  });

  // Get available regions
  router.get('/regions', (c) => {
    const regionStats = REGIONS.map(region => {
      const nodes = Array.from(proxyNodes.values())
        .filter(n => n.region === region.code && n.status === 'active');
      
      return {
        ...region,
        nodeCount: nodes.length,
        avgLatency: nodes.length > 0 
          ? nodes.reduce((sum, n) => sum + n.latency, 0) / nodes.length 
          : 0,
        totalBandwidth: nodes.reduce((sum, n) => sum + n.bandwidth, 0),
      };
    });

    return c.json({ regions: regionStats });
  });

  // ============================================================================
  // Node Management (for operators)
  // ============================================================================

  // Register proxy node
  router.post('/nodes', async (c) => {
    const { 'x-jeju-address': operator } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(vpnNodeRegistrationSchema, c);

    const id = crypto.randomUUID();
    const node: ProxyNode = {
      id,
      operator,
      endpoint: body.endpoint,
      region: body.region,
      country: body.country,
      city: body.city,
      type: body.type,
      protocol: body.protocol,
      port: body.port,
      bandwidth: body.bandwidth,
      latency: 0,
      uptime: 100,
      lastSeen: Date.now(),
      status: 'active',
      metadata: body.metadata ?? {},
    };

    proxyNodes.set(id, node);

    return c.json({
      nodeId: id,
      status: 'registered',
    }, 201);
  });

  // List nodes
  router.get('/nodes', (c) => {
    const { region, country, type, status } = validateQuery(vpnNodesQuerySchema, c);

    let nodes = Array.from(proxyNodes.values());
    
    if (region) nodes = nodes.filter(n => n.region === region);
    if (country) nodes = nodes.filter(n => n.country === country);
    if (type) nodes = nodes.filter(n => n.type === type);
    if (status) nodes = nodes.filter(n => n.status === status);

    return c.json({
      nodes: nodes.map(n => ({
        id: n.id,
        region: n.region,
        country: n.country,
        city: n.city,
        type: n.type,
        protocol: n.protocol,
        latency: n.latency,
        uptime: n.uptime,
        status: n.status,
      })),
    });
  });

  // Node heartbeat
  router.post('/nodes/:id/heartbeat', async (c) => {
    const { id } = validateParams(vpnNodeParamsSchema, c);
    const node = proxyNodes.get(id);
    if (!node) {
      throw new Error('Node not found');
    }

    const body = await validateBody(vpnNodeHeartbeatSchema, c);

    node.lastSeen = Date.now();
    if (body.latency !== undefined) node.latency = body.latency;
    if (body.bandwidth !== undefined) node.bandwidth = body.bandwidth;

    return c.json({ success: true });
  });

  // ============================================================================
  // Proxy Sessions (for users)
  // ============================================================================

  // Create proxy session
  router.post('/sessions', async (c) => {
    const { 'x-jeju-address': user } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(vpnSessionRequestSchema, c);

    // Find best available node
    let candidates = Array.from(proxyNodes.values())
      .filter(n => n.status === 'active');

    if (body.region) candidates = candidates.filter(n => n.region === body.region);
    if (body.country) candidates = candidates.filter(n => n.country === body.country);
    if (body.type) candidates = candidates.filter(n => n.type === body.type);

    // Sort by latency
    candidates.sort((a, b) => a.latency - b.latency);

    const node = candidates[0];
    if (!node) {
      throw new Error('No available proxy nodes');
    }

    const sessionId = crypto.randomUUID();
    const duration = body.duration ?? 3600; // 1 hour default
    
    const session: ProxySession = {
      id: sessionId,
      user,
      nodeId: node.id,
      startedAt: Date.now(),
      expiresAt: Date.now() + duration * 1000,
      bytesTransferred: 0,
      requestCount: 0,
      status: 'active',
    };

    sessions.set(sessionId, session);

    return c.json({
      sessionId,
      proxy: {
        host: node.endpoint,
        port: node.port,
        protocol: node.protocol,
        region: node.region,
        country: node.country,
      },
      expiresAt: session.expiresAt,
      credentials: {
        username: `session-${sessionId.slice(0, 8)}`,
        password: sessionId.slice(-16),
      },
    }, 201);
  });

  // Get session status
  router.get('/sessions/:sessionId', (c) => {
    const { sessionId } = validateParams(vpnSessionParamsSchema, c);
    const session = sessions.get(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    const node = proxyNodes.get(session.nodeId);

    return c.json({
      sessionId: session.id,
      status: session.status,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      bytesTransferred: session.bytesTransferred,
      requestCount: session.requestCount,
      node: node ? {
        region: node.region,
        country: node.country,
        type: node.type,
      } : null,
    });
  });

  // Terminate session
  router.delete('/sessions/:sessionId', (c) => {
    const { 'x-jeju-address': user } = validateHeaders(z.object({ 'x-jeju-address': z.string().optional() }), c);
    const { sessionId } = validateParams(vpnSessionParamsSchema, c);
    const session = sessions.get(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }
    if (!user || session.user.toLowerCase() !== user) {
      throw new Error('Not authorized');
    }

    session.status = 'terminated';
    return c.json({ success: true });
  });

  // ============================================================================
  // Proxy Request (HTTP proxy endpoint)
  // ============================================================================

  router.all('/proxy/:sessionId/*', async (c) => {
    const { sessionId } = validateParams(vpnSessionParamsSchema, c);
    const session = sessions.get(sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('Invalid or expired session');
    }

    if (Date.now() > session.expiresAt) {
      session.status = 'expired';
      throw new Error('Session expired');
    }

    const node = proxyNodes.get(session.nodeId);
    if (!node || node.status !== 'active') {
      throw new Error('Proxy node unavailable');
    }

    // Get target URL
    const url = new URL(c.req.url);
    const targetPath = url.pathname.replace(`/vpn/proxy/${session.id}`, '');
    const targetUrl = `${targetPath}${url.search}`;

    try {
      // Forward request through proxy node
      const response = await fetch(`${node.protocol}://${node.endpoint}:${node.port}${targetUrl}`, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.method !== 'GET' && c.req.method !== 'HEAD' 
          ? await c.req.arrayBuffer() 
          : undefined,
      });

      // Track usage
      const contentLength = parseInt(response.headers.get('content-length') ?? '0');
      session.bytesTransferred += contentLength;
      session.requestCount++;

      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Proxy request failed');
    }
  });

  return router;
}

