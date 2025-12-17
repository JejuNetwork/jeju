/**
 * OAuth3/Auth Routes for DWS
 * 
 * Integrated authentication service supporting:
 * - Wallet-based auth (SIWE - Sign In With Ethereum)
 * - Session management
 * - User vault for secrets (integrated with KMS)
 * 
 * Can also proxy to external OAuth3 TEE agent if configured.
 */

import { Hono, type Context } from 'hono';
import type { Address, Hex } from 'viem';
import { getAuthService } from '../../auth';

const OAUTH3_AGENT_URL = process.env.OAUTH3_AGENT_URL;

// Helper to proxy response with proper typing
async function proxyJsonResponse(c: Context, response: Response): Promise<Response> {
  const data = await response.json();
  return c.json(data, response.status as 200 | 400 | 401 | 403 | 404 | 500 | 502 | 503);
}

// Check if external agent is available
async function isExternalAgentAvailable(): Promise<boolean> {
  if (!OAUTH3_AGENT_URL) return false;
  
  const response = await fetch(`${OAUTH3_AGENT_URL}/health`).catch(() => null);
  return response?.ok ?? false;
}

export function createOAuth3Router(): Hono {
  const router = new Hono();
  const auth = getAuthService();

  // Health check - always returns 200 with integrated auth
  router.get('/health', async (c) => {
    const externalAvailable = await isExternalAgentAvailable();
    const stats = auth.getStats();
    
    return c.json({
      status: 'healthy',
      service: 'dws-auth',
      mode: externalAvailable ? 'hybrid' : 'integrated',
      externalAgent: OAUTH3_AGENT_URL || null,
      externalAvailable,
      stats,
    });
  });

  // ============================================================================
  // Wallet Authentication (SIWE)
  // ============================================================================

  // Get challenge for wallet signature
  router.post('/auth/challenge', async (c) => {
    const { address } = await c.req.json<{ address: string }>();
    
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return c.json({ error: 'Invalid address' }, 400);
    }

    const { challenge, expiresAt } = auth.generateChallenge(address as Address);
    
    return c.json({
      challenge,
      expiresAt,
      message: 'Sign this message with your wallet to authenticate',
    });
  });

  // Verify wallet signature and create session
  router.post('/auth/wallet', async (c) => {
    const { address, signature, message } = await c.req.json<{
      address: string;
      signature: string;
      message: string;
    }>();

    if (!address || !signature || !message) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Try external agent first if available
    if (OAUTH3_AGENT_URL) {
      const externalResponse = await fetch(`${OAUTH3_AGENT_URL}/auth/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, message }),
      }).catch(() => null);

      if (externalResponse?.ok) {
        return proxyJsonResponse(c, externalResponse);
      }
    }

    // Use integrated auth
    const valid = await auth.verifySignature(address as Address, signature as Hex, message);
    
    if (!valid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const session = auth.createSession(address as Address, {
      authMethod: 'wallet',
      userAgent: c.req.header('User-Agent') || 'unknown',
    });

    return c.json({
      sessionId: session.sessionId,
      address: session.address,
      expiresAt: session.expiresAt,
    });
  });

  // ============================================================================
  // Session Management
  // ============================================================================

  // Get session info
  router.get('/session/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    
    // Try external agent first
    if (OAUTH3_AGENT_URL) {
      const response = await fetch(`${OAUTH3_AGENT_URL}/session/${sessionId}`).catch(() => null);
      if (response?.ok) {
        return proxyJsonResponse(c, response);
      }
    }

    const session = auth.getSession(sessionId);
    
    if (!session) {
      return c.json({ error: 'Session not found or expired' }, 404);
    }

    return c.json({
      sessionId: session.sessionId,
      address: session.address,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastActivityAt: session.lastActivityAt,
    });
  });

  // Refresh session
  router.post('/session/:sessionId/refresh', async (c) => {
    const sessionId = c.req.param('sessionId');

    // Try external agent first
    if (OAUTH3_AGENT_URL) {
      const response = await fetch(`${OAUTH3_AGENT_URL}/session/${sessionId}/refresh`, {
        method: 'POST',
      }).catch(() => null);
      if (response?.ok) {
        return proxyJsonResponse(c, response);
      }
    }

    const session = auth.refreshSession(sessionId);
    
    if (!session) {
      return c.json({ error: 'Session not found or expired' }, 404);
    }

    return c.json({
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    });
  });

  // Delete session (logout)
  router.delete('/session/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');

    // Try external agent
    if (OAUTH3_AGENT_URL) {
      await fetch(`${OAUTH3_AGENT_URL}/session/${sessionId}`, {
        method: 'DELETE',
      }).catch(() => null);
    }

    auth.deleteSession(sessionId);
    return c.json({ success: true });
  });

  // Get user's sessions
  router.get('/sessions', async (c) => {
    const address = c.req.header('x-jeju-address') as Address;
    
    if (!address) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const sessions = auth.getSessionsByAddress(address);
    
    return c.json({
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastActivityAt: s.lastActivityAt,
      })),
    });
  });

  // ============================================================================
  // User Vault (Secrets Management)
  // ============================================================================

  // List user's secrets
  router.get('/vault/secrets', async (c) => {
    const address = c.req.header('x-jeju-address') as Address;
    
    if (!address) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const secrets = auth.listSecrets(address);
    
    return c.json({ secrets });
  });

  // Store a secret
  router.post('/vault/secrets', async (c) => {
    const address = c.req.header('x-jeju-address') as Address;
    
    if (!address) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const { name, value } = await c.req.json<{ name: string; value: string }>();
    
    if (!name || !value) {
      return c.json({ error: 'Missing name or value' }, 400);
    }

    const secret = auth.storeSecret(address, name, value);
    
    return c.json({
      id: secret.id,
      name: secret.name,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    }, 201);
  });

  // Get a secret
  router.get('/vault/secrets/:name', async (c) => {
    const address = c.req.header('x-jeju-address') as Address;
    
    if (!address) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const name = c.req.param('name');
    const value = auth.getSecret(address, name);
    
    if (value === null) {
      return c.json({ error: 'Secret not found' }, 404);
    }

    return c.json({ name, value });
  });

  // Delete a secret
  router.delete('/vault/secrets/:name', async (c) => {
    const address = c.req.header('x-jeju-address') as Address;
    
    if (!address) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const name = c.req.param('name');
    const deleted = auth.deleteSecret(address, name);
    
    if (!deleted) {
      return c.json({ error: 'Secret not found' }, 404);
    }

    return c.json({ success: true });
  });

  // ============================================================================
  // OAuth Proxy Routes (when external agent is configured)
  // ============================================================================

  if (OAUTH3_AGENT_URL) {
    // Get TEE attestation
    router.get('/attestation', async (c) => {
      const response = await fetch(`${OAUTH3_AGENT_URL}/attestation`).catch(() => null);
      if (!response?.ok) {
        return c.json({ error: 'Attestation not available (no external agent)' }, 503);
      }
      return proxyJsonResponse(c, response);
    });

    // Initialize OAuth flow
    router.post('/auth/init', async (c) => {
      const body = await c.req.json();
      const response = await fetch(`${OAUTH3_AGENT_URL}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      
      if (!response) {
        return c.json({ error: 'External agent unavailable' }, 503);
      }
      return proxyJsonResponse(c, response);
    });

    // OAuth callback
    router.post('/auth/callback', async (c) => {
      const body = await c.req.json();
      const response = await fetch(`${OAUTH3_AGENT_URL}/auth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);

      if (!response) {
        return c.json({ error: 'External agent unavailable' }, 503);
      }
      return proxyJsonResponse(c, response);
    });

    // Farcaster auth
    router.post('/auth/farcaster', async (c) => {
      const body = await c.req.json();
      const response = await fetch(`${OAUTH3_AGENT_URL}/auth/farcaster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);

      if (!response) {
        return c.json({ error: 'External agent unavailable' }, 503);
      }
      return proxyJsonResponse(c, response);
    });

    // Sign message (TEE)
    router.post('/sign', async (c) => {
      const body = await c.req.json();
      const response = await fetch(`${OAUTH3_AGENT_URL}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);

      if (!response) {
        return c.json({ error: 'External agent unavailable' }, 503);
      }
      return proxyJsonResponse(c, response);
    });

    // Issue credential
    router.post('/credential/issue', async (c) => {
      const body = await c.req.json();
      const response = await fetch(`${OAUTH3_AGENT_URL}/credential/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);

      if (!response) {
        return c.json({ error: 'External agent unavailable' }, 503);
      }
      return proxyJsonResponse(c, response);
    });

    // Verify credential
    router.post('/credential/verify', async (c) => {
      const body = await c.req.json();
      const response = await fetch(`${OAUTH3_AGENT_URL}/credential/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);

      if (!response) {
        return c.json({ error: 'External agent unavailable' }, 503);
      }
      return proxyJsonResponse(c, response);
    });
  }

  return router;
}
