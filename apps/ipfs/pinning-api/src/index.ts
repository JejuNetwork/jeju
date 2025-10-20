/**
 * Jeju IPFS Pinning Service
 * Standard IPFS Pinning Service API with x402 micropayments
 * Replaces external services (Pinata, Infura) with local infrastructure
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { create as createIPFSClient } from 'ipfs-http-client';
import db from './database';
import { x402Middleware } from './middleware/x402';
import { a2aApp } from './a2a';

const app = new Hono();

// CORS for browser access
app.use('/*', cors());

// Mount A2A routes
app.route('/', a2aApp);

// Connect to local Kubo IPFS node
const ipfsClient = createIPFSClient({
  host: process.env.IPFS_NODE_HOST || 'localhost',
  port: parseInt(process.env.IPFS_NODE_PORT || '4100'),
  protocol: 'http',
});

// ============ IPFS Pinning Service API (Standard Spec) ============

// POST /pins - Add pin
app.post('/pins', async (c) => {
  const { cid, name, origins } = await c.req.json();
  
  try {
    // Pin to local IPFS node
    await ipfsClient.pin.add(cid);
    
    // Store metadata in database
    const pinId = await db.createPin({
      cid,
      name: name || `Pin-${Date.now()}`,
      status: 'pinned',
      created: new Date(),
      origins: origins || [],
    });
    
    return c.json({
      requestid: pinId,
      status: 'pinned',
      created: new Date().toISOString(),
      pin: {
        cid,
        name,
        origins,
      },
    });
  } catch (error) {
    return c.json({ error: `Failed to pin: ${error}` }, 500);
  }
});

// GET /pins - List pins
app.get('/pins', async (c) => {
  const { cid, name, status, limit = 10, offset = 0 } = c.req.query();
  
  const pins = await db.listPins({
    cid,
    name,
    status,
    limit: parseInt(limit as string),
    offset: parseInt(offset as string),
  });
  
  return c.json({
    count: pins.length,
    results: pins.map((p) => ({
      requestid: p.id,
      status: p.status,
      created: p.created.toISOString(),
      pin: {
        cid: p.cid,
        name: p.name,
        origins: p.origins || [],
      },
    })),
  });
});

// GET /pins/{id} - Get pin status
app.get('/pins/:id', async (c) => {
  const { id } = c.req.param();
  
  const pin = await db.getPin(id);
  
  if (!pin) {
    return c.json({ error: 'Pin not found' }, 404);
  }
  
  return c.json({
    requestid: pin.id,
    status: pin.status,
    created: pin.created.toISOString(),
    pin: {
      cid: pin.cid,
      name: pin.name,
      origins: pin.origins || [],
    },
  });
});

// DELETE /pins/{id} - Unpin
app.delete('/pins/:id', async (c) => {
  const { id } = c.req.param();
  
  const pin = await db.getPin(id);
  
  if (!pin) {
    return c.json({ error: 'Pin not found' }, 404);
  }
  
  // Unpin from IPFS
  await ipfsClient.pin.rm(pin.cid);
  
  // Update database
  await db.updatePin(id, { status: 'unpinned' });
  
  return c.json({ status: 'unpinned' });
});

// ============ File Upload with x402 Payments ============

// POST /upload - Upload file with payment
app.post('/upload', x402Middleware, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }
  
  // Add file to IPFS
  const buffer = await file.arrayBuffer();
  const result = await ipfsClient.add(Buffer.from(buffer), {
    pin: true,
    progress: (bytes: number) => console.log(`Upload progress: ${bytes} bytes`),
  });
  
  const cid = result.cid.toString();
  
  // Store in database with payment info
  await db.createPin({
    cid,
    name: file.name,
    status: 'pinned',
    created: new Date(),
    sizeBytes: file.size,
    paidAmount: c.get('payment')?.amount || '0',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });
  
  return c.json({
    cid,
    name: file.name,
    size: file.size,
    gatewayUrl: `${process.env.GATEWAY_URL}/ipfs/${cid}`,
  });
});

// ============ IPFS HTTP Gateway ============

// GET /ipfs/{cid} - Retrieve file
app.get('/ipfs/:cid', async (c) => {
  const { cid } = c.req.param();
  
  try {
    const chunks: Uint8Array[] = [];
    
    for await (const chunk of ipfsClient.cat(cid)) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    
    // Set appropriate headers
    c.header('Content-Type', 'application/octet-stream');
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    
    return c.body(buffer);
  } catch (error) {
    return c.json({ error: `File not found: ${error}` }, 404);
  }
});

// ============ Health Check ============

app.get('/health', async (c) => {
  try {
    const { id } = await ipfsClient.id();
    const pinCount = await db.countPins();
    
    return c.json({
      status: 'healthy',
      ipfs: {
        peerId: id.toString(),
        connected: true,
      },
      database: {
        pins: pinCount,
      },
    });
  } catch (error) {
    return c.json({ status: 'unhealthy', error: `${error}` }, 500);
  }
});

// Start server
const port = parseInt(process.env.PORT || process.env.IPFS_PORT || '3100');

console.log(`🚀 Jeju IPFS Storage Service`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`📍 IPFS Pinning API:  http://localhost:${port}`);
console.log(`🌐 IPFS Gateway:      http://localhost:${port}/ipfs/{cid}`);
console.log(`🤖 A2A Endpoint:      http://localhost:${port}/a2a`);
console.log(`📋 Agent Card:        http://localhost:${port}/.well-known/agent-card.json`);
console.log(`💰 x402 Payments:     Enabled (dev mode bypass active)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

export default {
  port,
  fetch: app.fetch,
};

