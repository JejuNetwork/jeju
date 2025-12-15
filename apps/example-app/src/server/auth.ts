/**
 * OAuth3 Authentication Middleware and Routes
 *
 * Provides:
 * - OAuth3 session authentication middleware
 * - Legacy wallet signature fallback
 * - OAuth provider callback routes
 */

import { Hono, type Context, type Next } from 'hono';
import { getOAuth3Service, AuthProvider } from '../services/auth';
import type { Address } from 'viem';
import { verifyMessage } from 'viem';

/**
 * Middleware for OAuth3 authentication.
 * Checks for 'x-oauth3-session' header and validates the session.
 * Falls back to legacy wallet signature auth if no OAuth3 session.
 */
export async function OAuth3AuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const oauth3Service = getOAuth3Service();
  const sessionId = c.req.header('x-oauth3-session');

  // Try OAuth3 session authentication
  if (sessionId) {
    const session = oauth3Service.getSession();
    if (session && session.sessionId === sessionId && oauth3Service.isLoggedIn()) {
      c.set('address', session.smartAccount);
      c.set('oauth3SessionId', session.sessionId);
      c.set('authMethod', 'oauth3');
      return next();
    }

    // Session ID provided but invalid - try to refresh
    try {
      await oauth3Service.initialize();
      const refreshedSession = oauth3Service.getSession();
      if (refreshedSession && refreshedSession.sessionId === sessionId) {
        c.set('address', refreshedSession.smartAccount);
        c.set('oauth3SessionId', refreshedSession.sessionId);
        c.set('authMethod', 'oauth3');
        return next();
      }
    } catch {
      // OAuth3 session invalid, fall through to legacy auth
    }
  }

  // Try legacy wallet signature authentication
  const address = c.req.header('x-jeju-address') as Address | undefined;
  const timestamp = c.req.header('x-jeju-timestamp');
  const signature = c.req.header('x-jeju-signature');

  if (address && timestamp && signature) {
    const timestampNum = parseInt(timestamp, 10);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    // Validate timestamp is within 5 minute window
    if (timestampNum > now - fiveMinutes && timestampNum <= now) {
      const message = `jeju-dapp:${timestamp}`;

      try {
        const valid = await verifyMessage({
          address,
          message,
          signature: signature as `0x${string}`,
        });

        if (valid) {
          c.set('address', address);
          c.set('authMethod', 'wallet-signature');
          return next();
        }
      } catch {
        // Signature verification failed
      }
    }
  }

  return c.json(
    {
      error: 'Authentication required',
      details: 'Provide x-oauth3-session header or legacy wallet signature headers',
      methods: {
        oauth3: { header: 'x-oauth3-session', value: 'session-id' },
        legacy: {
          headers: ['x-jeju-address', 'x-jeju-timestamp', 'x-jeju-signature'],
          message: 'jeju-dapp:{timestamp}',
        },
      },
    },
    401,
  );
}

/**
 * Creates routes for OAuth3 authentication flows.
 */
export function createAuthRoutes(): Hono {
  const app = new Hono();

  // Initialize OAuth3 and get available providers
  app.get('/providers', async (c) => {
    const oauth3Service = getOAuth3Service();

    try {
      await oauth3Service.initialize();
      const health = await oauth3Service.checkInfrastructureHealth();

      return c.json({
        providers: [
          { id: AuthProvider.WALLET, name: 'Wallet', available: true },
          { id: AuthProvider.FARCASTER, name: 'Farcaster', available: health.teeNode },
          { id: AuthProvider.GITHUB, name: 'GitHub', available: health.teeNode },
          { id: AuthProvider.GOOGLE, name: 'Google', available: health.teeNode },
          { id: AuthProvider.TWITTER, name: 'Twitter', available: health.teeNode },
          { id: AuthProvider.DISCORD, name: 'Discord', available: health.teeNode },
        ],
        infrastructure: health,
      });
    } catch (error) {
      const err = error as Error;
      return c.json({ error: err.message }, 500);
    }
  });

  // Wallet login (primary method)
  app.post('/login/wallet', async (c) => {
    const oauth3Service = getOAuth3Service();

    try {
      await oauth3Service.initialize();
      const session = await oauth3Service.loginWithWallet();

      return c.json({
        success: true,
        session: {
          sessionId: session.sessionId,
          smartAccount: session.smartAccount,
          expiresAt: session.expiresAt,
        },
      });
    } catch (error) {
      const err = error as Error;
      return c.json({ error: err.message }, 500);
    }
  });

  // OAuth provider login (initiates flow)
  app.get('/login/:provider', async (c) => {
    const providerStr = c.req.param('provider');
    const provider = providerStr as AuthProvider;

    // Validate provider
    const validProviders = Object.values(AuthProvider);
    if (!validProviders.includes(provider)) {
      return c.json({ error: `Invalid provider: ${providerStr}` }, 400);
    }

    if (provider === AuthProvider.WALLET) {
      return c.json(
        {
          error: 'Wallet login must be initiated from client',
          hint: 'Use POST /auth/login/wallet',
        },
        400,
      );
    }

    // For OAuth providers, return the auth URL to redirect to
    const oauth3Service = getOAuth3Service();
    const appId = oauth3Service.getAppId();

    try {
      const teeAgentUrl = oauth3Service.getTeeAgentUrl();
      return c.json({
        method: 'redirect',
        url: `${teeAgentUrl}/auth/init`,
        params: {
          provider,
          appId,
          redirectUri: process.env.OAUTH3_REDIRECT_URI || 'http://localhost:4501/auth/callback',
        },
      });
    } catch (error) {
      const err = error as Error;
      return c.json({ error: err.message, hint: 'Initialize OAuth3 first' }, 503);
    }
  });

  // OAuth callback handler (receives code from provider)
  app.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      // Return error page that posts to opener
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head><title>OAuth3 Error</title></head>
          <body>
            <script>
              window.opener.postMessage({ error: '${error}' }, window.location.origin);
              window.close();
            </script>
            <p>Authentication failed. This window will close automatically.</p>
          </body>
        </html>
      `);
    }

    if (!code || !state) {
      return c.json({ error: 'Missing code or state in callback' }, 400);
    }

    // Post code/state to opener window for SDK to process
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>OAuth3 Callback</title></head>
        <body>
          <script>
            window.opener.postMessage({ 
              code: '${code}', 
              state: '${state}' 
            }, window.location.origin);
            window.close();
          </script>
          <p>Completing authentication. This window will close automatically.</p>
        </body>
      </html>
    `);
  });

  // Logout
  app.post('/logout', async (c) => {
    const oauth3Service = getOAuth3Service();

    try {
      await oauth3Service.logout();
      return c.json({ success: true, message: 'Logged out' });
    } catch (error) {
      const err = error as Error;
      return c.json({ error: err.message }, 500);
    }
  });

  // Get current session info
  app.get('/session', async (c) => {
    const oauth3Service = getOAuth3Service();
    const session = oauth3Service.getSession();

    if (session && oauth3Service.isLoggedIn()) {
      return c.json({
        isLoggedIn: true,
        session: {
          sessionId: session.sessionId,
          smartAccount: session.smartAccount,
          expiresAt: session.expiresAt,
          capabilities: session.capabilities,
        },
        identity: oauth3Service.getIdentity(),
      });
    }

    return c.json({ isLoggedIn: false, message: 'No active session' });
  });

  // Infrastructure health
  app.get('/health', async (c) => {
    const oauth3Service = getOAuth3Service();

    try {
      const health = await oauth3Service.checkInfrastructureHealth();
      const allHealthy = health.jns && health.storage && health.teeNode;

      return c.json(
        {
          status: allHealthy ? 'healthy' : 'degraded',
          components: health,
        },
        allHealthy ? 200 : 503,
      );
    } catch (error) {
      const err = error as Error;
      return c.json({ status: 'unhealthy', error: err.message }, 503);
    }
  });

  return app;
}

// Alias for backward compatibility
export const createOAuth3CallbackRoutes = createAuthRoutes;
