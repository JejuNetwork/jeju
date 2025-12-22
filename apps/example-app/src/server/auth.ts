/**
 * OAuth3 Authentication Middleware and Routes
 *
 * Provides:
 * - OAuth3 session authentication middleware
 * - Legacy wallet signature fallback
 * - OAuth provider callback routes
 * 
 * All routes use zod validation with expect/throw patterns.
 */

import { Hono, type Context, type Next } from 'hono';
import { getOAuth3Service, AuthProvider } from '../services/auth';
import { verifyMessage } from 'viem';
import {
  oauth3AuthHeadersSchema,
  walletAuthHeadersSchema,
  authProviderSchema,
  authCallbackQuerySchema,
} from '../schemas';
import { expectValid, expectDefined, ValidationError } from '../utils/validation';

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
    const validatedHeaders = expectValid(
      oauth3AuthHeadersSchema,
      { 'x-oauth3-session': sessionId },
      'OAuth3 auth headers'
    );
    
    const session = oauth3Service.getSession();
    if (session && session.sessionId === validatedHeaders['x-oauth3-session'] && oauth3Service.isLoggedIn()) {
      c.set('address', session.smartAccount);
      c.set('oauth3SessionId', session.sessionId);
      c.set('authMethod', 'oauth3');
      return next();
    }

    // Session ID provided but invalid - try to refresh
    await oauth3Service.initialize();
    const refreshedSession = oauth3Service.getSession();
    if (refreshedSession && refreshedSession.sessionId === validatedHeaders['x-oauth3-session']) {
      c.set('address', refreshedSession.smartAccount);
      c.set('oauth3SessionId', refreshedSession.sessionId);
      c.set('authMethod', 'oauth3');
      return next();
    }
  }

  // Try legacy wallet signature authentication
  const addressHeader = c.req.header('x-jeju-address');
  const timestampHeader = c.req.header('x-jeju-timestamp');
  const signatureHeader = c.req.header('x-jeju-signature');

  if (addressHeader && timestampHeader && signatureHeader) {
    const validatedHeaders = expectValid(
      walletAuthHeadersSchema,
      {
        'x-jeju-address': addressHeader,
        'x-jeju-timestamp': timestampHeader,
        'x-jeju-signature': signatureHeader,
      },
      'Wallet auth headers'
    );

    const timestamp = validatedHeaders['x-jeju-timestamp'];
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    // Validate timestamp is within 5 minute window
    if (timestamp > now - fiveMinutes && timestamp <= now) {
      const message = `jeju-dapp:${timestamp}`;

      const valid = await verifyMessage({
        address: validatedHeaders['x-jeju-address'],
        message,
        signature: validatedHeaders['x-jeju-signature'],
      });

      if (valid) {
        c.set('address', validatedHeaders['x-jeju-address']);
        c.set('authMethod', 'wallet-signature');
        return next();
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

  // Error handler
  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: err.message, code: 'VALIDATION_ERROR' }, 400);
    }
    return c.json({ error: err.message || 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  });

  // Initialize OAuth3 and get available providers
  app.get('/providers', async (c) => {
    const oauth3Service = getOAuth3Service();

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
  });

  // Wallet login (primary method)
  app.post('/login/wallet', async (c) => {
    const oauth3Service = getOAuth3Service();

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
  });

  // OAuth provider login (initiates flow) with validated provider
  app.get('/login/:provider', async (c) => {
    const providerStr = expectDefined(c.req.param('provider'), 'Provider parameter is required');
    const validatedProvider = expectValid(
      authProviderSchema,
      providerStr,
      'Auth provider'
    );

    if (validatedProvider === AuthProvider.WALLET) {
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
    const teeAgentUrl = oauth3Service.getTeeAgentUrl();
    
    return c.json({
      method: 'redirect',
      url: `${teeAgentUrl}/auth/init`,
      params: {
        provider: validatedProvider,
        appId,
        redirectUri: process.env.OAUTH3_REDIRECT_URI || 'http://localhost:4501/auth/callback',
      },
    });
  });

  // OAuth callback handler (receives code from provider) with validated query
  app.get('/callback', async (c) => {
    const queryParams = {
      code: c.req.query('code'),
      state: c.req.query('state'),
      error: c.req.query('error'),
    };
    
    const validatedQuery = expectValid(
      authCallbackQuerySchema,
      queryParams,
      'OAuth callback query'
    );

    if (validatedQuery.error) {
      // Return error page that posts to opener
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head><title>OAuth3 Error</title></head>
          <body>
            <script>
              window.opener.postMessage({ error: '${validatedQuery.error}' }, window.location.origin);
              window.close();
            </script>
            <p>Authentication failed. This window will close automatically.</p>
          </body>
        </html>
      `);
    }

    if (!validatedQuery.code || !validatedQuery.state) {
      throw new ValidationError('Missing code or state in callback');
    }

    // Post code/state to opener window for SDK to process
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>OAuth3 Callback</title></head>
        <body>
          <script>
            window.opener.postMessage({ 
              code: '${validatedQuery.code}', 
              state: '${validatedQuery.state}' 
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
    await oauth3Service.logout();
    return c.json({ success: true, message: 'Logged out' });
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
    const health = await oauth3Service.checkInfrastructureHealth();
    const allHealthy = health.jns && health.storage && health.teeNode;

    return c.json(
      {
        status: allHealthy ? 'healthy' : 'degraded',
        components: health,
      },
      allHealthy ? 200 : 503,
    );
  });

  return app;
}

// Alias for backward compatibility
export const createOAuth3CallbackRoutes = createAuthRoutes;
