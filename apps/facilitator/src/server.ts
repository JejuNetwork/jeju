/**
 * x402 Facilitator HTTP Server
 * Hono-based HTTP server for x402 payment verification and settlement
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
import { config, validateConfig } from './config';
import { startNonceCleanup, stopNonceCleanup } from './services/nonce-manager';

const app = new Hono();

// ============ Middleware ============

// CORS - allow all origins for x402 compatibility
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Payment', 'X-Payment-Proof', 'Authorization'],
    exposeHeaders: ['X-Payment-Requirement', 'WWW-Authenticate'],
  })
);

// Security headers
app.use('*', secureHeaders());

// Request logging
app.use('*', logger());

// Pretty JSON for development
app.use('*', prettyJSON());

// ============ Routes ============

// Health and info routes (/, /stats, /health, /ready)
app.route('/', healthRoutes);

// Payment verification (POST /verify)
app.route('/verify', verifyRoutes);

// Payment settlement (POST /settle)
app.route('/settle', settleRoutes);

// Supported schemes (GET /supported)
app.route('/supported', supportedRoutes);

// Prometheus metrics (GET /metrics)
app.route('/metrics', metricsRoutes);

// ============ Error Handling ============

app.onError((err, c) => {
  console.error('[Facilitator] Unhandled error:', err);
  return c.json(
    {
      error: 'Internal server error',
      message: err.message,
      timestamp: Date.now(),
    },
    500
  );
});

app.notFound((c) => {
  return c.json(
    {
      error: 'Not found',
      path: c.req.path,
      timestamp: Date.now(),
    },
    404
  );
});

// ============ Server Lifecycle ============

export function createServer() {
  return app;
}

export async function startServer(): Promise<void> {
  const cfg = config();

  // Validate configuration
  const validation = validateConfig();
  if (!validation.valid) {
    console.warn('[Facilitator] Configuration warnings:');
    validation.errors.forEach((err) => console.warn(`  - ${err}`));
  }

  // Start nonce cleanup
  startNonceCleanup();

  // Print startup info
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          Jeju x402 Facilitator                            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  🌐 Network:      ${cfg.network} (chainId: ${cfg.chainId})`);
  console.log(`  📍 RPC:          ${cfg.rpcUrl}`);
  console.log(`  📜 Facilitator:  ${cfg.facilitatorAddress}`);
  console.log(`  💰 Fee:          ${cfg.protocolFeeBps / 100}%`);
  console.log(`  🔑 Wallet:       ${cfg.privateKey ? 'Configured' : 'Not configured'}`);
  console.log(`  🌍 Environment:  ${cfg.environment}`);
  console.log('');
  console.log('  Endpoints:');
  console.log(`    GET  /           Health & info`);
  console.log(`    GET  /supported  Supported schemes`);
  console.log(`    GET  /stats      Facilitator stats`);
  console.log(`    GET  /metrics    Prometheus metrics`);
  console.log(`    POST /verify     Verify payment`);
  console.log(`    POST /settle     Settle payment`);
  console.log('');

  // Start server using Bun
  const server = Bun.serve({
    port: cfg.port,
    hostname: cfg.host,
    fetch: app.fetch,
  });

  console.log(`🚀 Server listening on http://${cfg.host}:${cfg.port}`);
  console.log('');

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n[Facilitator] Shutting down...');
    stopNonceCleanup();
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Facilitator] Received SIGTERM, shutting down...');
    stopNonceCleanup();
    server.stop();
    process.exit(0);
  });
}

export default app;
