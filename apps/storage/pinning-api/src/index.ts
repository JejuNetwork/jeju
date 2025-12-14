/**
 * @jejunetwork/storage - Decentralized Storage Marketplace
 *
 * Permissionless storage with x402 micropayments and multi-provider support.
 * NO API KEYS. NO LOGINS. WALLET SIGNATURE ONLY.
 *
 * Features:
 * - Multi-provider routing (IPFS, Cloud, Arweave)
 * - Automatic best provider selection
 * - x402 micropayment integration
 * - ERC-4337 multi-token payments
 * - A2A and MCP integration
 *
 * Target chains: Anvil (local) → Base Sepolia → Base Mainnet
 *
 * @see src/sdk - Storage SDK for client applications
 * @see src/node - Run a storage provider node
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { database as db } from './database';
import { a2aApp, AGENT_CARD } from './a2a';
import { StorageA2AServer, createStorageA2AServer } from './a2a-server';
import { StorageMCPServer, createStorageMCPServer, createMCPRouter } from './mcp-server';
import { StorageNodeServer, startStorageNode } from './node';
import { createBackendManager, BackendManager } from './backends';
import { createFullRegistryApp } from './registry';
import { createRentalRouter, RENTAL_AGENT_CARD } from './rental-api';
import { getCQLDatabase } from './database/cql-adapter';

// Initialize backend manager with auto-detected backends
const backendManager = createBackendManager();

// Initialize container registry
const registryApp = createFullRegistryApp({
  storageBackend: (process.env.REGISTRY_STORAGE_BACKEND as 'ipfs' | 'arweave' | 'hybrid') ?? 'ipfs',
  ipfsUrl: process.env.IPFS_API_URL ?? 'http://localhost:5001',
  arweaveUrl: process.env.ARWEAVE_GATEWAY ?? 'https://arweave.net',
  privateKey: process.env.PRIVATE_KEY,
  paymentRecipient: process.env.REGISTRY_PAYMENT_RECIPIENT ?? process.env.X402_RECIPIENT_ADDRESS ?? '',
  allowPublicPulls: process.env.REGISTRY_PUBLIC_PULLS === 'true',
});

// ============================================================================
// PRODUCTION EXPORTS (100% PERMISSIONLESS)
// ============================================================================

// SDK - Client library for storage operations
export * from './sdk';

// Node - Provider server
export { StorageNodeServer, startStorageNode } from './node';

// A2A Server - Agent-to-agent communication
export { StorageA2AServer, createStorageA2AServer } from './a2a-server';

// MCP Server - Model Context Protocol
export { StorageMCPServer, createStorageMCPServer, createMCPRouter } from './mcp-server';

// Legacy A2A exports
export { a2aApp, AGENT_CARD } from './a2a';

// Database exports
export { db, database } from './database';

// Middleware exports
export * from './middleware/x402';

// Lib exports
export * from './lib/paymaster';
export * from './lib/erc8004';

// Rental API exports
export { createRentalRouter, RENTAL_AGENT_CARD } from './rental-api';

// CQL Database exports
export { getCQLDatabase, resetCQLDatabase } from './database/cql-adapter';

// Backend exports
export * from './backends';

// Container Registry exports
export * from './registry';

// ============================================================================
// SERVER SETUP
// ============================================================================

const app = new Hono();

// Enable CORS
app.use('/*', cors());

// ============================================================================
// INITIALIZE A2A SERVER (Full Marketplace)
// ============================================================================

const a2aConfig = {
  rpcUrl: process.env.JEJU_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:9545',
  registryAddress: process.env.STORAGE_REGISTRY_ADDRESS || process.env.REGISTRY_ADDRESS || '',
  ledgerAddress: process.env.STORAGE_LEDGER_ADDRESS || process.env.LEDGER_ADDRESS || '',
  marketAddress: process.env.STORAGE_MARKET_ADDRESS || process.env.MARKET_ADDRESS || '',
  creditManagerAddress: process.env.CREDIT_MANAGER_ADDRESS,
  paymentRecipient: process.env.X402_RECIPIENT_ADDRESS || process.env.PAYMENT_RECEIVER_ADDRESS,
  privateKey: process.env.PRIVATE_KEY,
};

// Create full A2A server if contracts are configured
const hasContractsConfigured = a2aConfig.registryAddress && a2aConfig.marketAddress;

// Health check
app.get('/health', async (c) => {
  const stats = await db.getStorageStats();
  const ipfsUrl = process.env.IPFS_API_URL;
  
  // Check IPFS connectivity if configured
  let ipfsConnected = false;
  let ipfsPeerId: string | undefined;
  if (ipfsUrl) {
    const response = await fetch(`${ipfsUrl}/api/v0/id`, { method: 'POST' }).catch(() => null);
    if (response?.ok) {
      const data = await response.json() as { ID?: string };
      ipfsConnected = true;
      ipfsPeerId = data.ID;
    }
  }

  // Check all backend health
  const backendHealth = await backendManager.healthCheck();
  const backends = backendManager.listBackends();

  return c.json({
    status: 'healthy',
    service: 'jeju-storage',
    version: '2.0.0',
    a2a: {
      mode: hasContractsConfigured ? 'marketplace' : 'basic',
      contractsConfigured: hasContractsConfigured,
    },
    backends: {
      available: backends,
      health: backendHealth,
      cloud: {
        vercel: !!process.env.BLOB_READ_WRITE_TOKEN,
        s3: !!process.env.S3_BUCKET,
        r2: !!process.env.R2_BUCKET,
      },
    },
    ipfs: {
      connected: ipfsConnected,
      peerId: ipfsPeerId,
      gateway: ipfsUrl,
    },
    database: {
      pins: stats.totalPins,
      totalSizeGB: parseFloat(stats.totalSizeGB.toFixed(4)),
    },
  });
});

// Mount A2A routes - use full marketplace if contracts configured, otherwise basic
if (hasContractsConfigured) {
  const a2aServer = createStorageA2AServer(a2aConfig);
  app.route('/', a2aServer.getRouter());
} else {
  // Fall back to basic A2A (local operations only)
  app.route('/', a2aApp);
}

// ============================================================================
// MCP SERVER ROUTES (Always Available)
// ============================================================================

const mcpConfig = {
  rpcUrl: a2aConfig.rpcUrl,
  registryAddress: a2aConfig.registryAddress,
  marketAddress: a2aConfig.marketAddress,
  ledgerAddress: a2aConfig.ledgerAddress,
  creditManagerAddress: a2aConfig.creditManagerAddress,
  paymentRecipient: a2aConfig.paymentRecipient,
};

const mcpServer = createStorageMCPServer(mcpConfig);

// Mount MCP routes
app.post('/initialize', async (c) => {
  return mcpServer.getRouter().fetch(c.req.raw);
});
app.post('/resources/list', async (c) => {
  return mcpServer.getRouter().fetch(c.req.raw);
});
app.post('/resources/read', async (c) => {
  return mcpServer.getRouter().fetch(c.req.raw);
});
app.post('/tools/list', async (c) => {
  return mcpServer.getRouter().fetch(c.req.raw);
});
app.post('/tools/call', async (c) => {
  return mcpServer.getRouter().fetch(c.req.raw);
});

// ============================================================================
// PINNING SERVICE API (IPFS Pinning Service Standard)
// ============================================================================

// List pins
app.get('/pins', async (c) => {
  const cid = c.req.query('cid');
  const status = c.req.query('status');
  const limit = parseInt(c.req.query('limit') || '10');
  const offset = parseInt(c.req.query('offset') || '0');

  const pins = await db.listPins({ cid, status, limit, offset });
  const count = await db.countPins();

  return c.json({
    count,
    results: pins.map(p => ({
      requestId: p.id.toString(),
      cid: p.cid,
      name: p.name,
      status: p.status,
      created: p.created.toISOString(),
      info: {
        sizeBytes: p.sizeBytes,
      },
    })),
  });
});

// Get pin by ID
app.get('/pins/:id', async (c) => {
  const id = c.req.param('id');
  const pin = await db.getPin(id);

  if (!pin) {
    return c.json({ error: 'Pin not found' }, 404);
  }

  return c.json({
    requestId: pin.id.toString(),
    cid: pin.cid,
    name: pin.name,
    status: pin.status,
    created: pin.created.toISOString(),
    info: {
      sizeBytes: pin.sizeBytes,
    },
  });
});

// Create pin
app.post('/pins', async (c) => {
  const body = await c.req.json<{ cid: string; name?: string; origins?: string[] }>();

  if (!body.cid) {
    return c.json({ error: 'CID required' }, 400);
  }

  const id = await db.createPin({
    cid: body.cid,
    name: body.name || body.cid,
    status: 'pinned',
    created: new Date(),
    origins: body.origins,
  });

  return c.json({
    requestId: id,
    cid: body.cid,
    name: body.name || body.cid,
    status: 'pinned',
    created: new Date().toISOString(),
  });
});

// Delete pin
app.delete('/pins/:id', async (c) => {
  const id = c.req.param('id');
  const pin = await db.getPin(id);

  if (!pin) {
    return c.json({ error: 'Pin not found' }, 404);
  }

  await db.updatePin(id, { status: 'unpinned' });
  return c.json({ status: 'deleted' });
});

// ============================================================================
// STORAGE MARKETPLACE API
// ============================================================================

// Get marketplace stats
app.get('/v1/stats', async (c) => {
  const stats = await db.getStorageStats();
  return c.json({
    totalPins: stats.totalPins,
    totalSizeBytes: stats.totalSizeBytes,
    totalSizeGB: stats.totalSizeGB,
    pricePerGBMonth: 0.10, // $0.10/GB/month
    minFee: 0.001,
  });
});

// Calculate storage cost
app.post('/v1/quote', async (c) => {
  const body = await c.req.json<{ sizeBytes: number; durationMonths?: number }>();
  const sizeGB = body.sizeBytes / (1024 ** 3);
  const months = body.durationMonths || 1;
  const cost = Math.max(sizeGB * 0.10 * months, 0.001);

  return c.json({
    sizeBytes: body.sizeBytes,
    sizeGB: Number(sizeGB.toFixed(4)),
    durationMonths: months,
    costUSD: Number(cost.toFixed(4)),
    pricePerGBMonth: 0.10,
  });
});

// Upload file
app.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  const content = Buffer.from(await file.arrayBuffer());
  const sizeBytes = content.byteLength;

  // Use backend manager for upload
  const result = await backendManager.upload(content, { filename: file.name });
  const cid = result.cid;
  const isIPFS = result.backend === 'ipfs';
  const isCloud = result.backend === 'cloud';

  const id = await db.createPin({
    cid,
    name: file.name,
    status: 'pinned',
    created: new Date(),
    sizeBytes,
  });

  return c.json({
    requestId: id,
    cid,
    name: file.name,
    size: sizeBytes,
    status: 'pinned',
    backend: result.backend,
    provider: result.provider,
    isIPFS,
    isCloud,
    url: result.url,
    gatewayUrl: isIPFS ? `https://ipfs.io/ipfs/${cid}` : result.url,
  });
});

// Download file by CID
app.get('/download/:cid', async (c) => {
  const cid = c.req.param('cid');
  
  const result = await backendManager.download(cid).catch((e: Error) => {
    return { error: e.message };
  });

  if ('error' in result) {
    return c.json({ error: result.error }, 404);
  }

  return new Response(result.content, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${cid}"`,
      'X-Storage-Backend': result.backend,
    },
  });
});

// List available backends
app.get('/backends', async (c) => {
  const backends = backendManager.listBackends();
  const health = await backendManager.healthCheck();
  
  return c.json({
    backends,
    health,
    config: {
      ipfs: !!process.env.IPFS_API_URL,
      vercel: !!process.env.BLOB_READ_WRITE_TOKEN,
      s3: !!process.env.S3_BUCKET,
      r2: !!process.env.R2_BUCKET,
      arweave: !!process.env.ARWEAVE_API_URL,
    },
  });
});

// ============================================================================
// CONTAINER REGISTRY (OCI-Compatible Docker Registry)
// ============================================================================

// Mount container registry at /registry
app.route('/registry', registryApp);

// ============================================================================
// INFRASTRUCTURE RENTAL API (Decentralized DB & Cache)
// ============================================================================

// Mount rental API at /rental
const rentalRouter = createRentalRouter();
app.route('/rental', rentalRouter);

// Initialize CQL database adapter (if configured)
const useCQL = process.env.USE_CQL === 'true' || process.env.CQL_BLOCK_PRODUCER_ENDPOINT;
if (useCQL) {
  const cqlDb = getCQLDatabase();
  cqlDb.initialize().then(() => {
    console.log('[Storage] CovenantSQL database initialized');
  }).catch((e) => {
    console.warn('[Storage] CQL init failed, using PostgreSQL fallback:', (e as Error).message);
  });
}

// ============================================================================
// START SERVER
// ============================================================================

const PORT = parseInt(process.env.PORT || process.env.STORAGE_PORT || '3100');

// Only start server if running directly
if (import.meta.main) {
  console.log(`Storage Marketplace starting...`);
  console.log(`   Port: ${PORT}`);
  console.log(`   A2A: http://localhost:${PORT}/a2a`);
  console.log(`   MCP: http://localhost:${PORT}/mcp`);
  console.log(`   Registry: http://localhost:${PORT}/registry/v2`);
  console.log(`   Rental API: http://localhost:${PORT}/rental`);
  console.log(`   Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`   CQL Mode: ${useCQL ? 'enabled' : 'disabled'}`);
  console.log(`   Cache Service: ${process.env.CACHE_SERVICE_URL ?? 'http://localhost:4015'}`);

  Bun.serve({
    port: PORT,
    fetch: app.fetch,
  });

  console.log(`✅ Storage Marketplace running at http://localhost:${PORT}`);
}

// Export app for programmatic use (not auto-served)
export { app };
