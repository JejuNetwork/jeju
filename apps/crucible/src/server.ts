/**
 * Crucible API Server
 * REST API for agent management, room coordination, and execution.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia, localhost } from 'viem/chains';
import type { CrucibleConfig, AgentCharacter, ExecutionRequest } from './types';
import { createStorage } from './sdk/storage';
import { createCompute } from './sdk/compute';
import { createAgentSDK } from './sdk/agent';
import { createRoomSDK } from './sdk/room';
import { createExecutorSDK } from './sdk/executor';
import { createLogger } from './sdk/logger';
import { getCharacter, listCharacters } from './characters';

const log = createLogger('Server');

// Metrics tracking
const metrics = {
  requests: { total: 0, success: 0, error: 0 },
  agents: { registered: 0, executions: 0 },
  rooms: { created: 0, messages: 0 },
  latency: { sum: 0, count: 0 },
  startTime: Date.now(),
};

const config: CrucibleConfig = {
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  privateKey: process.env.PRIVATE_KEY,
  contracts: {
    agentVault: (process.env.AGENT_VAULT_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    roomRegistry: (process.env.ROOM_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    triggerRegistry: (process.env.TRIGGER_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    identityRegistry: (process.env.IDENTITY_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    serviceRegistry: (process.env.SERVICE_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  },
  services: {
    computeMarketplace: process.env.COMPUTE_MARKETPLACE_URL ?? 'http://127.0.0.1:4007',
    storageApi: process.env.STORAGE_API_URL ?? 'http://127.0.0.1:3100',
    ipfsGateway: process.env.IPFS_GATEWAY ?? 'http://127.0.0.1:3100',
    indexerGraphql: process.env.INDEXER_GRAPHQL_URL ?? 'http://127.0.0.1:4350/graphql',
  },
  network: (process.env.NETWORK as 'localnet' | 'testnet' | 'mainnet') ?? 'localnet',
};

const chain = config.network === 'mainnet' ? mainnet : config.network === 'testnet' ? sepolia : localhost;

const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

const account = config.privateKey ? privateKeyToAccount(config.privateKey as `0x${string}`) : undefined;

const walletClient = account ? createWalletClient({
  account, chain, transport: http(config.rpcUrl),
}) : undefined;

const storage = createStorage({
  apiUrl: config.services.storageApi,
  ipfsGateway: config.services.ipfsGateway,
});

const compute = createCompute({
  marketplaceUrl: config.services.computeMarketplace,
  rpcUrl: config.rpcUrl,
  defaultModel: 'llama-3.1-8b',
});

const agentSdk = createAgentSDK({
  crucibleConfig: config, storage, compute, publicClient, walletClient,
});

const roomSdk = createRoomSDK({
  crucibleConfig: config, storage, publicClient, walletClient,
});

const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', logger());
app.use('*', async (c, next) => {
  const start = Date.now();
  metrics.requests.total++;
  await next();
  const duration = Date.now() - start;
  metrics.latency.sum += duration;
  metrics.latency.count++;
  if (c.res.status >= 400) metrics.requests.error++;
  else metrics.requests.success++;
});

// Health & Info
app.get('/health', (c) => c.json({
  status: 'healthy',
  service: 'crucible',
  network: config.network,
  timestamp: new Date().toISOString(),
}));

app.get('/info', (c) => c.json({
  service: 'crucible',
  version: '1.0.0',
  network: config.network,
  contracts: config.contracts,
  services: config.services,
  hasWallet: !!walletClient,
}));

// Prometheus Metrics
app.get('/metrics', (c) => {
  const uptimeSeconds = Math.floor((Date.now() - metrics.startTime) / 1000);
  const avgLatency = metrics.latency.count > 0 ? metrics.latency.sum / metrics.latency.count : 0;

  const lines = [
    '# HELP crucible_requests_total Total HTTP requests',
    '# TYPE crucible_requests_total counter',
    `crucible_requests_total{status="success"} ${metrics.requests.success}`,
    `crucible_requests_total{status="error"} ${metrics.requests.error}`,
    '',
    '# HELP crucible_agents_registered_total Total agents registered',
    '# TYPE crucible_agents_registered_total counter',
    `crucible_agents_registered_total ${metrics.agents.registered}`,
    '',
    '# HELP crucible_agent_executions_total Total agent executions',
    '# TYPE crucible_agent_executions_total counter',
    `crucible_agent_executions_total ${metrics.agents.executions}`,
    '',
    '# HELP crucible_rooms_created_total Total rooms created',
    '# TYPE crucible_rooms_created_total counter',
    `crucible_rooms_created_total ${metrics.rooms.created}`,
    '',
    '# HELP crucible_room_messages_total Total room messages',
    '# TYPE crucible_room_messages_total counter',
    `crucible_room_messages_total ${metrics.rooms.messages}`,
    '',
    '# HELP crucible_request_latency_avg_ms Average request latency in milliseconds',
    '# TYPE crucible_request_latency_avg_ms gauge',
    `crucible_request_latency_avg_ms ${avgLatency.toFixed(2)}`,
    '',
    '# HELP crucible_uptime_seconds Server uptime in seconds',
    '# TYPE crucible_uptime_seconds gauge',
    `crucible_uptime_seconds ${uptimeSeconds}`,
    '',
    '# HELP crucible_info Service info',
    '# TYPE crucible_info gauge',
    `crucible_info{version="1.0.0",network="${config.network}"} 1`,
    '',
  ];

  c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return c.text(lines.join('\n'));
});

// Character Templates
app.get('/api/v1/characters', (c) => {
  const characterList = listCharacters().map(id => {
    const char = getCharacter(id);
    return char ? { id: char.id, name: char.name, description: char.description } : null;
  }).filter(Boolean);
  return c.json({ characters: characterList });
});

app.get('/api/v1/characters/:id', (c) => {
  const character = getCharacter(c.req.param('id'));
  if (!character) return c.json({ error: 'Character not found' }, 404);
  return c.json({ character });
});

// Agent Management
app.post('/api/v1/agents', async (c) => {
  const body = await c.req.json() as { character: AgentCharacter; initialFunding?: string };
  log.info('Registering agent', { name: body.character.name });

  const result = await agentSdk.registerAgent(
    body.character,
    { initialFunding: body.initialFunding ? BigInt(body.initialFunding) : undefined }
  );
  metrics.agents.registered++;

  return c.json({
    agentId: result.agentId.toString(),
    vaultAddress: result.vaultAddress,
    characterCid: result.characterCid,
    stateCid: result.stateCid,
  });
});

app.get('/api/v1/agents/:agentId', async (c) => {
  const agent = await agentSdk.getAgent(BigInt(c.req.param('agentId')));
  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json({ agent: { ...agent, agentId: agent.agentId.toString() } });
});

app.get('/api/v1/agents/:agentId/character', async (c) => {
  const character = await agentSdk.loadCharacter(BigInt(c.req.param('agentId')));
  return c.json({ character });
});

app.get('/api/v1/agents/:agentId/state', async (c) => {
  const state = await agentSdk.loadState(BigInt(c.req.param('agentId')));
  return c.json({ state });
});

app.get('/api/v1/agents/:agentId/balance', async (c) => {
  const balance = await agentSdk.getVaultBalance(BigInt(c.req.param('agentId')));
  return c.json({ balance: balance.toString() });
});

app.post('/api/v1/agents/:agentId/fund', async (c) => {
  const agentId = BigInt(c.req.param('agentId'));
  const body = await c.req.json() as { amount: string };
  const txHash = await agentSdk.fundVault(agentId, BigInt(body.amount));
  return c.json({ txHash });
});

app.post('/api/v1/agents/:agentId/memory', async (c) => {
  const agentId = BigInt(c.req.param('agentId'));
  const body = await c.req.json() as { content: string; importance?: number; roomId?: string };
  const memory = await agentSdk.addMemory(agentId, body.content, {
    importance: body.importance, roomId: body.roomId,
  });
  return c.json({ memory });
});

// Room Management
app.post('/api/v1/rooms', async (c) => {
  const body = await c.req.json() as {
    name: string; description: string;
    roomType: 'collaboration' | 'adversarial' | 'debate' | 'council';
    config: { maxMembers?: number; turnBased?: boolean; turnTimeout?: number };
  };
  log.info('Creating room', { name: body.name, roomType: body.roomType });

  const result = await roomSdk.createRoom(body.name, body.description, body.roomType, {
    maxMembers: body.config.maxMembers ?? 10,
    turnBased: body.config.turnBased ?? false,
    turnTimeout: body.config.turnTimeout ?? 300,
    visibility: 'public' as const,
  });
  metrics.rooms.created++;

  return c.json({ roomId: result.roomId.toString(), stateCid: result.stateCid });
});

app.get('/api/v1/rooms/:roomId', async (c) => {
  const room = await roomSdk.getRoom(BigInt(c.req.param('roomId')));
  if (!room) return c.json({ error: 'Room not found' }, 404);
  return c.json({
    room: {
      ...room, roomId: room.roomId.toString(),
      members: room.members.map(m => ({ ...m, agentId: m.agentId.toString() })),
    },
  });
});

app.post('/api/v1/rooms/:roomId/join', async (c) => {
  const roomId = BigInt(c.req.param('roomId'));
  const body = await c.req.json() as { agentId: string; role: 'participant' | 'moderator' | 'red_team' | 'blue_team' | 'observer' };
  await roomSdk.joinRoom(roomId, BigInt(body.agentId), body.role);
  return c.json({ success: true });
});

app.post('/api/v1/rooms/:roomId/leave', async (c) => {
  const roomId = BigInt(c.req.param('roomId'));
  const body = await c.req.json() as { agentId: string };
  await roomSdk.leaveRoom(roomId, BigInt(body.agentId));
  return c.json({ success: true });
});

app.post('/api/v1/rooms/:roomId/message', async (c) => {
  const roomId = BigInt(c.req.param('roomId'));
  const body = await c.req.json() as { agentId: string; content: string; action?: string };
  const message = await roomSdk.postMessage(roomId, BigInt(body.agentId), body.content, body.action);
  metrics.rooms.messages++;
  return c.json({ message });
});

app.get('/api/v1/rooms/:roomId/messages', async (c) => {
  const roomId = BigInt(c.req.param('roomId'));
  const messages = await roomSdk.getMessages(roomId, parseInt(c.req.query('limit') ?? '50'));
  return c.json({ messages });
});

app.post('/api/v1/rooms/:roomId/phase', async (c) => {
  const roomId = BigInt(c.req.param('roomId'));
  const body = await c.req.json() as { phase: 'setup' | 'active' | 'paused' | 'completed' | 'archived' };
  await roomSdk.setPhase(roomId, body.phase);
  return c.json({ success: true });
});

// Execution
app.post('/api/v1/execute', async (c) => {
  if (!walletClient || !account) {
    return c.json({ error: 'Executor not configured - missing private key' }, 500);
  }

  const body = await c.req.json() as {
    agentId: string; triggerId?: string;
    input: { message?: string; roomId?: string; userId?: string; context?: Record<string, unknown> };
    options?: { maxTokens?: number; temperature?: number; requireTee?: boolean; maxCost?: string; timeout?: number };
  };

  log.info('Executing agent', { agentId: body.agentId });

  const executorSdk = createExecutorSDK({
    crucibleConfig: config, storage, compute, agentSdk, roomSdk,
    publicClient, walletClient, executorAddress: account.address,
  });

  const request: ExecutionRequest = {
    agentId: BigInt(body.agentId),
    triggerId: body.triggerId,
    input: body.input,
    options: body.options ? { ...body.options, maxCost: body.options.maxCost ? BigInt(body.options.maxCost) : undefined } : undefined,
  };

  const result = await executorSdk.execute(request);
  metrics.agents.executions++;

  return c.json({
    result: {
      ...result, agentId: result.agentId.toString(),
      cost: {
        ...result.cost,
        total: result.cost.total.toString(),
        inference: result.cost.inference.toString(),
        storage: result.cost.storage.toString(),
        executionFee: result.cost.executionFee.toString(),
      },
    },
  });
});

// Search
app.get('/api/v1/search/agents', async (c) => {
  const result = await agentSdk.searchAgents({
    name: c.req.query('name'),
    owner: c.req.query('owner') as `0x${string}` | undefined,
    active: c.req.query('active') ? c.req.query('active') === 'true' : undefined,
    limit: parseInt(c.req.query('limit') ?? '20'),
  });
  return c.json({
    agents: result.items.map(a => ({ ...a, agentId: a.agentId.toString() })),
    total: result.total,
    hasMore: result.hasMore,
  });
});

const port = parseInt(process.env.PORT ?? '4020');

log.info('Starting server', { port, network: config.network, wallet: account?.address ?? 'not configured' });

export default { port, fetch: app.fetch };
