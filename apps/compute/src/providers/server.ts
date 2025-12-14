/**
 * Compute Bridge Server
 *
 * HTTP server for the bridge node that exposes APIs for:
 * - Health checks
 * - Deployment management
 * - Pricing queries
 * - Admin operations
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import type { Address, Hex } from 'viem';
import { getUnifiedCompute, type UnifiedComputeService, type DeploymentRequest } from './unified-compute';
import { getBridgeNodeService, type BridgeNodeService } from './bridge-node';
import { getAkashProvider } from './akash';
import { getContainerRegistry } from './container-registry';
import type { ExternalProviderType } from '@jejunetwork/types';

// ============================================================================
// Configuration
// ============================================================================

interface ServerConfig {
  port: number;
  host: string;
  enableCors: boolean;
  corsOrigins: string[];
}

const DEFAULT_CONFIG: ServerConfig = {
  port: parseInt(process.env.PORT ?? '8080', 10),
  host: process.env.HOST ?? '0.0.0.0',
  enableCors: true,
  corsOrigins: ['*'],
};

// ============================================================================
// Server
// ============================================================================

export function createServer(config?: Partial<ServerConfig>): Hono {
  const serverConfig = { ...DEFAULT_CONFIG, ...config };
  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('*', prettyJSON());

  if (serverConfig.enableCors) {
    app.use('*', cors({
      origin: serverConfig.corsOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Network-Address', 'X-Network-Signature'],
    }));
  }

  // Get services lazily
  const getServices = () => ({
    compute: getUnifiedCompute(),
    bridgeNode: getBridgeNodeService(),
    akash: getAkashProvider(),
    registry: getContainerRegistry(),
  });

  // ============================================================================
  // Health & Status
  // ============================================================================

  app.get('/health', async (c) => {
    const services = getServices();
    const akashAvailable = await services.akash.isAvailable().catch(() => false);

    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        akash: akashAvailable ? 'available' : 'unavailable',
        bridgeNode: 'running',
      },
    });
  });

  app.get('/status', async (c) => {
    const services = getServices();
    const bridgeStatus = services.bridgeNode.getStatus();
    const computeStats = services.compute.getStats();
    const akashAvailable = await services.akash.isAvailable().catch(() => false);

    return c.json({
      bridgeNode: {
        address: bridgeStatus.address,
        agentId: bridgeStatus.agentId.toString(),
        stake: bridgeStatus.stake.toString(),
        active: bridgeStatus.active,
        reputationScore: bridgeStatus.reputationScore,
        supportedProviders: bridgeStatus.supportedProviders,
      },
      compute: computeStats,
      akash: {
        available: akashAvailable,
        network: process.env.AKASH_NETWORK ?? 'mainnet',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================================
  // Offerings & Quotes
  // ============================================================================

  app.get('/offerings', async (c) => {
    const services = getServices();

    const cpuCores = c.req.query('cpuCores') ? parseInt(c.req.query('cpuCores')!, 10) : undefined;
    const memoryGb = c.req.query('memoryGb') ? parseInt(c.req.query('memoryGb')!, 10) : undefined;
    const gpuCount = c.req.query('gpuCount') ? parseInt(c.req.query('gpuCount')!, 10) : undefined;

    const filter = { cpuCores, memoryGb, gpuCount };

    const offerings = await services.compute.listOfferings(filter);

    return c.json({
      offerings: offerings.map((o) => ({
        id: o.id,
        provider: o.provider,
        hardware: o.hardware,
        pricing: {
          pricePerHour: o.pricing.pricePerHourFormatted,
          currency: o.pricing.currency,
          markup: o.pricing.markupBps / 100 + '%',
        },
        availability: o.availability,
        features: o.features,
      })),
      count: offerings.length,
    });
  });

  app.post('/quote', async (c) => {
    const services = getServices();
    const body = await c.req.json() as DeploymentRequest;

    const quote = await services.compute.getQuote(body);

    return c.json({
      bestOffering: {
        id: quote.bestOffering.id,
        provider: quote.bestOffering.provider,
        pricePerHour: quote.bestOffering.pricing.pricePerHourFormatted,
      },
      totalCost: quote.totalCostFormatted,
      totalCostWei: quote.totalCost.toString(),
      durationHours: body.durationHours,
      warnings: quote.warnings,
      offeringCount: quote.offerings.length,
    });
  });

  // ============================================================================
  // Deployments
  // ============================================================================

  app.post('/deploy', async (c) => {
    const services = getServices();
    const body = await c.req.json() as DeploymentRequest & {
      userAddress: string;
      paymentToken?: string;
    };

    if (!body.userAddress) {
      return c.json({ error: 'userAddress is required' }, 400);
    }

    const deployment = await services.compute.deploy(
      body,
      body.userAddress as Address,
      (body.paymentToken ?? '0x0000000000000000000000000000000000000000') as Address
    );

    return c.json({
      deploymentId: deployment.id,
      status: deployment.status,
      provider: deployment.provider,
      container: deployment.container,
      endpoints: deployment.endpoints,
      timing: {
        createdAt: new Date(deployment.timing.createdAt).toISOString(),
        expiresAt: new Date(deployment.timing.expiresAt).toISOString(),
      },
      cost: {
        totalPaid: deployment.cost.totalPaidFormatted,
        pricePerHour: deployment.cost.pricePerHourFormatted,
      },
    });
  });

  app.get('/deployments/:id', async (c) => {
    const services = getServices();
    const deploymentId = c.req.param('id');

    const deployment = await services.compute.getDeployment(deploymentId);

    if (!deployment) {
      return c.json({ error: 'Deployment not found' }, 404);
    }

    return c.json({
      deploymentId: deployment.id,
      status: deployment.status,
      provider: deployment.provider,
      container: deployment.container,
      endpoints: deployment.endpoints,
      timing: {
        createdAt: new Date(deployment.timing.createdAt).toISOString(),
        startedAt: deployment.timing.startedAt
          ? new Date(deployment.timing.startedAt).toISOString()
          : null,
        expiresAt: new Date(deployment.timing.expiresAt).toISOString(),
      },
      cost: {
        totalPaid: deployment.cost.totalPaidFormatted,
        pricePerHour: deployment.cost.pricePerHourFormatted,
      },
    });
  });

  app.get('/deployments', async (c) => {
    const services = getServices();
    const userAddress = c.req.query('user') as Address | undefined;

    if (!userAddress) {
      return c.json({ error: 'user query parameter required' }, 400);
    }

    const deployments = await services.compute.listDeployments(userAddress);

    return c.json({
      deployments: deployments.map((d) => ({
        id: d.id,
        status: d.status,
        provider: d.provider,
        image: d.container.image,
        createdAt: new Date(d.timing.createdAt).toISOString(),
        expiresAt: new Date(d.timing.expiresAt).toISOString(),
      })),
      count: deployments.length,
    });
  });

  app.delete('/deployments/:id', async (c) => {
    const services = getServices();
    const deploymentId = c.req.param('id');

    await services.compute.terminate(deploymentId);

    return c.json({ success: true, deploymentId });
  });

  app.get('/deployments/:id/logs', async (c) => {
    const services = getServices();
    const deploymentId = c.req.param('id');
    const tail = c.req.query('tail') ? parseInt(c.req.query('tail')!, 10) : 100;

    const logs = await services.compute.getLogs(deploymentId, tail);

    return c.text(logs);
  });

  // ============================================================================
  // Container Registry
  // ============================================================================

  app.get('/registry/resolve', async (c) => {
    const services = getServices();
    const reference = c.req.query('ref');

    if (!reference) {
      return c.json({ error: 'ref query parameter required' }, 400);
    }

    const resolved = await services.registry.resolve(reference);

    return c.json({
      original: resolved.original,
      resolvedUrl: resolved.resolvedUrl,
      cid: resolved.cid,
      backend: resolved.backend,
      jnsResolved: resolved.jnsResolved,
      jnsName: resolved.jnsName,
    });
  });

  app.get('/registry/search', async (c) => {
    const services = getServices();
    const query = c.req.query('q') ?? '';

    const results = await services.registry.searchImages(query);

    return c.json({ results, count: results.length });
  });

  // ============================================================================
  // Bridge Node Admin
  // ============================================================================

  app.post('/admin/credentials', async (c) => {
    const services = getServices();
    const body = await c.req.json() as {
      providerType: ExternalProviderType;
      walletMnemonic: string;
      walletAddress: string;
      network: 'mainnet' | 'testnet';
      description: string;
    };

    const credential = await services.bridgeNode.registerCredential(
      body.providerType,
      {
        walletMnemonic: body.walletMnemonic,
        walletAddress: body.walletAddress,
        network: body.network,
      },
      body.description
    );

    return c.json({
      secretId: credential.secretId,
      providerType: credential.providerType,
      verified: credential.verified,
    });
  });

  app.post('/admin/refresh-pricing', async (c) => {
    const services = getServices();
    await services.bridgeNode.refreshPricing();
    return c.json({ success: true });
  });

  app.get('/admin/health-check', async (c) => {
    const services = getServices();
    const results = await services.compute.healthCheckAll();
    return c.json({ results, count: results.length });
  });

  app.get('/admin/slashing-events', async (c) => {
    const services = getServices();
    const events = services.bridgeNode.getSlashingEvents();
    return c.json({
      events: events.map((e) => ({
        eventId: e.eventId,
        reason: e.reason,
        amountSlashed: e.amountSlashed.toString(),
        stakeSlashed: e.stakeSlashed,
        deploymentId: e.deploymentId,
        timestamp: new Date(e.timestamp).toISOString(),
      })),
      count: events.length,
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  app.onError((err, c) => {
    console.error('[BridgeServer] Error:', err);
    return c.json({
      error: err.message,
      timestamp: new Date().toISOString(),
    }, 500);
  });

  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
  });

  return app;
}

// ============================================================================
// Server Entry Point
// ============================================================================

export async function startServer(config?: Partial<ServerConfig>): Promise<void> {
  const serverConfig = { ...DEFAULT_CONFIG, ...config };
  const app = createServer(serverConfig);

  console.log(`[BridgeServer] Starting on ${serverConfig.host}:${serverConfig.port}`);

  // Initialize services
  console.log('[BridgeServer] Initializing services...');

  const akash = getAkashProvider();
  const akashAvailable = await akash.isAvailable().catch(() => false);
  console.log(`[BridgeServer] Akash: ${akashAvailable ? 'available' : 'unavailable'}`);

  const bridgeNode = getBridgeNodeService();
  console.log(`[BridgeServer] Bridge node: ${bridgeNode.getStatus().address}`);

  // Start server
  Bun.serve({
    fetch: app.fetch,
    port: serverConfig.port,
    hostname: serverConfig.host,
  });

  console.log(`[BridgeServer] Listening on http://${serverConfig.host}:${serverConfig.port}`);

  // Log status periodically
  setInterval(async () => {
    const stats = getUnifiedCompute().getStats();
    console.log('[BridgeServer] Stats:', stats);
  }, 60000);
}

// Start server if run directly
if (import.meta.main) {
  startServer().catch(console.error);
}

