/**
 * DWS Server
 * Decentralized Web Services - Storage, Compute, CDN, and Git
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Address, Hex } from 'viem';
import type { ServiceHealth } from '../types';
import { createStorageRouter } from './routes/storage';
import { createComputeRouter } from './routes/compute';
import { createCDNRouter } from './routes/cdn';
import { createA2ARouter } from './routes/a2a';
import { createMCPRouter } from './routes/mcp';
import { createGitRouter } from './routes/git';
import { createNpmRouter } from './routes/npm';
import { createCIRouter } from './routes/ci';
import { createOAuth3Router } from './routes/oauth3';
import { createBackendManager } from '../storage/backends';
import { GitRepoManager } from '../git/repo-manager';
import { NpmRegistryManager } from '../npm/registry-manager';
import { WorkflowEngine } from '../ci/workflow-engine';

const app = new Hono();
app.use('/*', cors({ origin: '*' }));

const backendManager = createBackendManager();

// Git configuration
const gitConfig = {
  rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
  repoRegistryAddress: (process.env.REPO_REGISTRY_ADDRESS ||
    '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address,
  privateKey: process.env.DWS_PRIVATE_KEY as Hex | undefined,
};

const repoManager = new GitRepoManager(gitConfig, backendManager);

// NPM configuration
const npmConfig = {
  rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
  packageRegistryAddress: (process.env.PACKAGE_REGISTRY_ADDRESS ||
    '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
  privateKey: process.env.DWS_PRIVATE_KEY as Hex | undefined,
};

const registryManager = new NpmRegistryManager(npmConfig, backendManager);

// CI configuration
const ciConfig = {
  rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
  triggerRegistryAddress: (process.env.TRIGGER_REGISTRY_ADDRESS ||
    '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0') as Address,
  privateKey: process.env.DWS_PRIVATE_KEY as Hex | undefined,
};

const workflowEngine = new WorkflowEngine(ciConfig, backendManager, repoManager);

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
      git: { status: 'healthy' },
      npm: { status: 'healthy' },
      ci: { status: 'healthy' },
      oauth3: { status: process.env.OAUTH3_AGENT_URL ? 'available' : 'not-configured' },
    },
    backends: { available: backends, health: backendHealth },
  });
});

app.get('/', (c) => {
  return c.json({
    name: 'DWS',
    description: 'Decentralized Web Services',
    version: '1.0.0',
    services: ['storage', 'compute', 'cdn', 'git', 'npm', 'ci', 'oauth3'],
    endpoints: {
      storage: '/storage/*',
      compute: '/compute/*',
      cdn: '/cdn/*',
      git: '/git/*',
      npm: '/npm/*',
      ci: '/ci/*',
      oauth3: '/oauth3/*',
      a2a: '/a2a/*',
      mcp: '/mcp/*',
    },
  });
});

app.route('/storage', createStorageRouter(backendManager));
app.route('/compute', createComputeRouter());
app.route('/cdn', createCDNRouter());
app.route('/git', createGitRouter({ repoManager, backend: backendManager }));
app.route('/npm', createNpmRouter({ registryManager, backend: backendManager }));
app.route('/ci', createCIRouter({ workflowEngine, repoManager, backend: backendManager }));
app.route('/oauth3', createOAuth3Router());
app.route('/a2a', createA2ARouter());
app.route('/mcp', createMCPRouter());

// Serve frontend
app.get('/app', async (c) => {
  const file = Bun.file('./frontend/index.html');
  const html = await file.text();
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

app.get('/app/ci', async (c) => {
  const file = Bun.file('./frontend/ci.html');
  const html = await file.text();
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

app.get('/app/*', async (c) => {
  // For SPA routing - serve index.html for all /app/* routes
  const file = Bun.file('./frontend/index.html');
  const html = await file.text();
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Agent card for discovery
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
      { name: 'git', endpoint: `${baseUrl}/git` },
      { name: 'npm', endpoint: `${baseUrl}/npm` },
      { name: 'ci', endpoint: `${baseUrl}/ci` },
      { name: 'oauth3', endpoint: `${baseUrl}/oauth3` },
    ],
    a2aEndpoint: `${baseUrl}/a2a`,
    mcpEndpoint: `${baseUrl}/mcp`,
  });
});

const PORT = parseInt(process.env.DWS_PORT || process.env.PORT || '4030', 10);

if (import.meta.main) {
  console.log(`[DWS] Running at http://localhost:${PORT}`);
  console.log(`[DWS] Git registry: ${gitConfig.repoRegistryAddress}`);
  console.log(`[DWS] NPM registry: ${npmConfig.packageRegistryAddress}`);
  Bun.serve({ port: PORT, fetch: app.fetch });
}

export { app, backendManager, repoManager, registryManager, workflowEngine };
