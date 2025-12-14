/**
 * x402 Facilitator HTTP Server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';

import healthRoutes from './routes/health';
import verifyRoutes from './routes/verify';
import settleRoutes from './routes/settle';
import supportedRoutes from './routes/supported';
import metricsRoutes from './routes/metrics';
import { config, validateConfig, getPrivateKeyFromKMS } from './config';
import { startNonceCleanup, stopNonceCleanup, initDistributedNonceManager } from './services/nonce-manager';

const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Payment', 'X-Payment-Proof', 'Authorization'],
  exposeHeaders: ['X-Payment-Requirement', 'WWW-Authenticate'],
}));
app.use('*', secureHeaders());
app.use('*', logger());
app.use('*', prettyJSON());

app.route('/', healthRoutes);
app.route('/verify', verifyRoutes);
app.route('/settle', settleRoutes);
app.route('/supported', supportedRoutes);
app.route('/metrics', metricsRoutes);

app.onError((err, c) => {
  console.error('[Facilitator] Error:', err);
  return c.json({ error: 'Internal server error', message: err.message, timestamp: Date.now() }, 500);
});

app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path, timestamp: Date.now() }, 404);
});

export function createServer() {
  return app;
}

export async function startServer(): Promise<void> {
  const cfg = config();

  const validation = validateConfig();
  if (!validation.valid) {
    console.warn('[Facilitator] Warnings:', validation.errors.join(', '));
  }

  await initDistributedNonceManager();
  startNonceCleanup();

  let keySource = 'env';
  if (cfg.kmsEnabled) {
    const kmsKey = await getPrivateKeyFromKMS();
    keySource = kmsKey ? 'kms' : (cfg.privateKey ? 'env' : 'none');
  }

  console.log(`[Facilitator] ${cfg.network} (${cfg.chainId}) | ${cfg.environment} | key:${keySource}`);
  console.log(`[Facilitator] Contract: ${cfg.facilitatorAddress}`);

  const server = Bun.serve({
    port: cfg.port,
    hostname: cfg.host,
    fetch: app.fetch,
  });

  console.log(`[Facilitator] Listening on http://${cfg.host}:${cfg.port}`);

  const shutdown = () => {
    console.log('[Facilitator] Shutting down...');
    stopNonceCleanup();
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
