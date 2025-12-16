/**
 * OAuth3 Proxy Route
 * 
 * Proxies requests to the OAuth3 TEE agent for authentication.
 * This allows DWS to serve as a unified API gateway.
 */

import { Hono, type Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';

const OAUTH3_AGENT_URL = process.env.OAUTH3_AGENT_URL || 'http://localhost:4200';

// Helper to proxy response with proper typing
async function proxyJsonResponse(c: Context, response: Response): Promise<Response> {
  const data = await response.json();
  return c.json(data, response.status as StatusCode);
}

export function createOAuth3Router(): Hono {
  const app = new Hono();

  // Health check
  app.get('/health', async (c) => {
    const response = await fetch(`${OAUTH3_AGENT_URL}/health`).catch((err: Error) => {
      console.warn(`[OAuth3] Health check failed: ${err.message}`);
      return null;
    });
    if (!response?.ok) {
      return c.json({ status: 'unhealthy', agent: OAUTH3_AGENT_URL }, 503);
    }
    const data = await response.json();
    return c.json({ status: 'healthy', agent: OAUTH3_AGENT_URL, ...data });
  });

  // Get TEE attestation
  app.get('/attestation', async (c) => {
    const response = await fetch(`${OAUTH3_AGENT_URL}/attestation`);
    if (!response.ok) {
      return c.json({ error: 'Failed to get attestation' }, response.status as StatusCode);
    }
    return c.json(await response.json());
  });

  // Initialize OAuth flow
  app.post('/auth/init', async (c) => {
    const body = await c.req.json();
    const response = await fetch(`${OAUTH3_AGENT_URL}/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return proxyJsonResponse(c, response);
  });

  // OAuth callback
  app.post('/auth/callback', async (c) => {
    const body = await c.req.json();
    const response = await fetch(`${OAUTH3_AGENT_URL}/auth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return proxyJsonResponse(c, response);
  });

  // Wallet auth
  app.post('/auth/wallet', async (c) => {
    const body = await c.req.json();
    const response = await fetch(`${OAUTH3_AGENT_URL}/auth/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return proxyJsonResponse(c, response);
  });

  // Farcaster auth
  app.post('/auth/farcaster', async (c) => {
    const body = await c.req.json();
    const response = await fetch(`${OAUTH3_AGENT_URL}/auth/farcaster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return proxyJsonResponse(c, response);
  });

  // Get session
  app.get('/session/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const response = await fetch(`${OAUTH3_AGENT_URL}/session/${sessionId}`);
    return proxyJsonResponse(c, response);
  });

  // Refresh session
  app.post('/session/:sessionId/refresh', async (c) => {
    const sessionId = c.req.param('sessionId');
    const response = await fetch(`${OAUTH3_AGENT_URL}/session/${sessionId}/refresh`, {
      method: 'POST',
    });
    return proxyJsonResponse(c, response);
  });

  // Delete session (logout)
  app.delete('/session/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const response = await fetch(`${OAUTH3_AGENT_URL}/session/${sessionId}`, {
      method: 'DELETE',
    });
    return proxyJsonResponse(c, response);
  });

  // Sign message
  app.post('/sign', async (c) => {
    const body = await c.req.json();
    const response = await fetch(`${OAUTH3_AGENT_URL}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return proxyJsonResponse(c, response);
  });

  // Issue credential
  app.post('/credential/issue', async (c) => {
    const body = await c.req.json();
    const response = await fetch(`${OAUTH3_AGENT_URL}/credential/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return proxyJsonResponse(c, response);
  });

  // Verify credential
  app.post('/credential/verify', async (c) => {
    const body = await c.req.json();
    const response = await fetch(`${OAUTH3_AGENT_URL}/credential/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return proxyJsonResponse(c, response);
  });

  // Infrastructure health
  app.get('/infrastructure/health', async (c) => {
    const response = await fetch(`${OAUTH3_AGENT_URL}/infrastructure/health`);
    if (!response.ok) {
      return c.json({ error: 'OAuth3 agent unavailable' }, 503);
    }
    return c.json(await response.json());
  });

  return app;
}
