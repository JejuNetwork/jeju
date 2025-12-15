/**
 * Experimental Decentralized Todo App - Main Server
 * 
 * Demonstrates all decentralized services:
 * - REST API for CRUD operations
 * - A2A (Agent-to-Agent) protocol for AI agents
 * - MCP (Model Context Protocol) for tool integrations
 * - CQL database for persistent storage
 * - Cache layer for performance
 * - KMS for encrypted todos
 * - Cron triggers for scheduled tasks
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getNetworkName, getWebsiteUrl } from '@jejunetwork/config';
import { createA2AServer } from './a2a';
import { createMCPServer } from './mcp';
import { createRESTRoutes } from './rest';
import { getDatabase } from '../db/client';
import { getCache } from '../services/cache';
import { getKMSService } from '../services/kms';
import { getStorageService } from '../services/storage';
import { getCronService } from '../services/cron';
import type { HealthResponse, ServiceStatus } from '../types';

const PORT = parseInt(process.env.PORT || '4500', 10);

const app = new Hono();

// CORS
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Payment', 'x-jeju-address', 'x-jeju-timestamp', 'x-jeju-signature'],
}));

// Health check with service status
app.get('/health', async (c) => {
  const services: ServiceStatus[] = [];
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // Check database
  const dbStart = Date.now();
  const db = getDatabase();
  const dbHealthy = await db.isHealthy();
  services.push({
    name: 'database (CQL)',
    status: dbHealthy ? 'healthy' : 'unhealthy',
    latency: Date.now() - dbStart,
    details: dbHealthy ? 'Connected' : 'Connection failed',
  });
  if (!dbHealthy) overallStatus = 'degraded';

  // Check cache
  const cacheStart = Date.now();
  const cache = getCache();
  const cacheHealthy = await cache.isHealthy();
  services.push({
    name: 'cache',
    status: cacheHealthy ? 'healthy' : 'degraded',
    latency: Date.now() - cacheStart,
    details: cacheHealthy ? 'Available' : 'Fallback mode',
  });

  // Check KMS
  const kmsStart = Date.now();
  const kms = getKMSService();
  const kmsHealthy = await kms.isHealthy();
  services.push({
    name: 'kms',
    status: kmsHealthy ? 'healthy' : 'degraded',
    latency: Date.now() - kmsStart,
    details: kmsHealthy ? 'Available' : 'Fallback mode',
  });

  // Check storage
  const storageStart = Date.now();
  const storage = getStorageService();
  const storageHealthy = await storage.isHealthy();
  services.push({
    name: 'storage (IPFS)',
    status: storageHealthy ? 'healthy' : 'degraded',
    latency: Date.now() - storageStart,
    details: storageHealthy ? 'Connected' : 'Fallback mode',
  });

  // Check cron
  const cronStart = Date.now();
  const cron = getCronService();
  const cronHealthy = await cron.isHealthy();
  services.push({
    name: 'cron triggers',
    status: cronHealthy ? 'healthy' : 'degraded',
    latency: Date.now() - cronStart,
    details: cronHealthy ? 'Active' : 'Fallback mode',
  });

  const unhealthyCount = services.filter(s => s.status === 'unhealthy').length;
  if (unhealthyCount > 1) overallStatus = 'unhealthy';

  const response: HealthResponse = {
    status: overallStatus,
    version: '1.0.0',
    services,
    timestamp: Date.now(),
  };

  const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
  return c.json(response, statusCode);
});

// Root endpoint
app.get('/', (c) => c.json({
  name: 'Experimental Decentralized Todo App',
  version: '1.0.0',
  description: 'End-to-end demonstration of all decentralized services',
  network: getNetworkName(),
  endpoints: {
    rest: '/api/v1',
    a2a: '/a2a',
    mcp: '/mcp',
    health: '/health',
    docs: '/docs',
    agentCard: '/a2a/.well-known/agent-card.json',
  },
  services: {
    database: 'CQL (CovenantSQL)',
    cache: 'Compute-based Redis',
    storage: 'IPFS via Storage Marketplace',
    secrets: 'KMS with MPC',
    triggers: 'On-chain Cron',
    names: 'JNS (Jeju Name Service)',
  },
}));

// Documentation
app.get('/docs', (c) => c.json({
  title: 'Experimental Decentralized Todo API',
  version: '1.0.0',
  description: 'A fully decentralized Todo application demonstrating all Jeju network services',
  
  restEndpoints: {
    'GET /api/v1/todos': 'List all todos for the authenticated user',
    'POST /api/v1/todos': 'Create a new todo',
    'GET /api/v1/todos/:id': 'Get a specific todo',
    'PATCH /api/v1/todos/:id': 'Update a todo',
    'DELETE /api/v1/todos/:id': 'Delete a todo',
    'POST /api/v1/todos/:id/encrypt': 'Encrypt todo with KMS',
    'POST /api/v1/todos/:id/decrypt': 'Decrypt todo with KMS',
    'POST /api/v1/todos/:id/attach': 'Upload attachment to IPFS',
  },
  
  a2aSkills: {
    'list-todos': 'List all todos',
    'create-todo': 'Create a new todo',
    'complete-todo': 'Mark a todo as complete',
    'delete-todo': 'Delete a todo',
    'get-summary': 'Get todo summary statistics',
    'set-reminder': 'Schedule a reminder for a todo',
  },
  
  mcpTools: {
    'list_todos': 'List all todos with optional filters',
    'create_todo': 'Create a new todo item',
    'update_todo': 'Update an existing todo',
    'delete_todo': 'Delete a todo',
    'get_stats': 'Get todo statistics',
    'schedule_reminder': 'Schedule a reminder',
  },
  
  authentication: 'Sign message with wallet: "jeju-todo:{timestamp}"',
}));

// Mount routes
app.route('/api/v1', createRESTRoutes());
app.route('/a2a', createA2AServer());
app.route('/mcp', createMCPServer());

// Start server
console.log(`
╔══════════════════════════════════════════════════════════════╗
║          EXPERIMENTAL DECENTRALIZED TODO APP                 ║
║══════════════════════════════════════════════════════════════║
║  REST API:     http://localhost:${PORT}/api/v1                 ║
║  A2A:          http://localhost:${PORT}/a2a                    ║
║  MCP:          http://localhost:${PORT}/mcp                    ║
║  Health:       http://localhost:${PORT}/health                 ║
║  Agent Card:   http://localhost:${PORT}/a2a/.well-known/agent-card.json
╚══════════════════════════════════════════════════════════════╝
`);

export default {
  port: PORT,
  fetch: app.fetch,
};
