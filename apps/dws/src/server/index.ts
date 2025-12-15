/**
 * DWS Server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServiceHealth } from '../types';
import { createStorageRouter } from './routes/storage';
import { createComputeRouter } from './routes/compute';
import { createCDNRouter } from './routes/cdn';
import { createA2ARouter } from './routes/a2a';
import { createMCPRouter } from './routes/mcp';
import { createBackendManager } from '../storage/backends';

const app = new Hono();
app.use('/*', cors({ origin: '*' }));

const backendManager = createBackendManager();

app.get('/health', async (c) => {
  const backends = backendManager.listBackends();
  const backendHealth = await backendManager.healthCheck();

  const health: ServiceHealth = {
    status: 'healthy',
    service: 'dws',
    version: '1.0.0',
    uptime: process.uptime() * 1000,
  };

  return c.json({
    ...health,
    services: {
      storage: { status: 'healthy', backends },
      compute: { status: 'healthy' },
      cdn: { status: 'healthy' },
    },
    backends: { available: backends, health: backendHealth },
  });
});

app.get('/', (c) => {
  return c.json({
    name: 'DWS',
    description: 'Decentralized Web Services',
    version: '1.0.0',
    services: ['storage', 'compute', 'cdn'],
    endpoints: { storage: '/storage/*', compute: '/compute/*', cdn: '/cdn/*', a2a: '/a2a/*', mcp: '/mcp/*' },
  });
});

app.route('/storage', createStorageRouter(backendManager));
app.route('/compute', createComputeRouter());
app.route('/cdn', createCDNRouter());
app.route('/a2a', createA2ARouter());
app.route('/mcp', createMCPRouter());

app.get('/app', async (c) => {
  const file = Bun.file('./frontend/index.html');
  const html = await file.text();
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

app.get('/.well-known/agent-card.json', (c) => {
  const baseUrl = process.env.DWS_BASE_URL || `http://localhost:${PORT}`;
  return c.json({
    name: 'DWS',
    description: 'Decentralized Web Services',
    version: '1.0.0',
    url: baseUrl,
    capabilities: [
      { name: 'storage', endpoint: `${baseUrl}/storage` },
      { name: 'compute', endpoint: `${baseUrl}/compute` },
      { name: 'cdn', endpoint: `${baseUrl}/cdn` },
    ],
    a2aEndpoint: `${baseUrl}/a2a`,
    mcpEndpoint: `${baseUrl}/mcp`,
  });
});

const PORT = parseInt(process.env.DWS_PORT || process.env.PORT || '4030', 10);

if (import.meta.main) {
  console.log(`[DWS] Running at http://localhost:${PORT}`);
  Bun.serve({ port: PORT, fetch: app.fetch });
}

export { app };
