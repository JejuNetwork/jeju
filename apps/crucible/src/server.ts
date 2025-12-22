/**
 * Crucible API Server
 * REST API for agent management, room coordination, and execution.
 * 
 * Agent Runtime Options:
 * 1. ElizaOS + @jejunetwork/eliza-plugin: Full plugin/action support (60+ actions)
 * 2. DWS-only: Character-template inference (fallback when ElizaOS unavailable)
 * 
 * The runtime auto-detects ElizaOS availability and uses full capabilities when possible.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia, localhost } from 'viem/chains';
import type { CrucibleConfig, ExecutionRequest } from './types';
import { createStorage } from './sdk/storage';
import { createCompute } from './sdk/compute';
import { createAgentSDK } from './sdk/agent';
import { createRoomSDK } from './sdk/room';
import { createExecutorSDK } from './sdk/executor';
import { createLogger } from './sdk/logger';
import { runtimeManager, checkDWSHealth, type RuntimeMessage } from './sdk/eliza-runtime';
import { getCharacter, listCharacters, characters } from './characters';
import { BotInitializer } from './bots/initializer';
import type { TradingBot } from './bots/trading-bot';
import {
  parseOrThrow,
  expect,
  RegisterAgentRequestSchema,
  AgentIdParamSchema,
  FundAgentRequestSchema,
  AddMemoryRequestSchema,
  CreateRoomRequestSchema,
  RoomIdParamSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  PostMessageRequestSchema,
  SetPhaseRequestSchema,
  ExecuteRequestSchema,
  AgentSearchQuerySchema,
  BotIdParamSchema,
} from './schemas';
import { z } from 'zod';

const log = createLogger('Server');

// Metrics tracking
const metrics = {
  requests: { total: 0, success: 0, error: 0 },
  agents: { registered: 0, executions: 0 },
  rooms: { created: 0, messages: 0 },
  latency: { sum: 0, count: 0 },
  startTime: Date.now(),
};

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getRequiredAddress(key: string): `0x${string}` {
  const value = getRequiredEnv(key);
  if (!value.startsWith('0x') || value.length !== 42) {
    throw new Error(`Environment variable ${key} must be a valid Ethereum address`);
  }
  return value as `0x${string}`;
}

function getNetwork(): 'localnet' | 'testnet' | 'mainnet' {
  const network = process.env.NETWORK;
  if (!network) {
    throw new Error('NETWORK environment variable is required (localnet, testnet, or mainnet)');
  }
  if (network !== 'localnet' && network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`Invalid NETWORK: ${network}. Must be one of: localnet, testnet, mainnet`);
  }
  return network;
}

const config: CrucibleConfig = {
  rpcUrl: getRequiredEnv('RPC_URL'),
  privateKey: process.env.PRIVATE_KEY,
  contracts: {
    agentVault: getRequiredAddress('AGENT_VAULT_ADDRESS'),
    roomRegistry: getRequiredAddress('ROOM_REGISTRY_ADDRESS'),
    triggerRegistry: getRequiredAddress('TRIGGER_REGISTRY_ADDRESS'),
    identityRegistry: getRequiredAddress('IDENTITY_REGISTRY_ADDRESS'),
    serviceRegistry: getRequiredAddress('SERVICE_REGISTRY_ADDRESS'),
    autocratTreasury: process.env.AUTOCRAT_TREASURY_ADDRESS as `0x${string}` | undefined,
  },
  services: {
    computeMarketplace: getRequiredEnv('COMPUTE_MARKETPLACE_URL'),
    storageApi: getRequiredEnv('STORAGE_API_URL'),
    ipfsGateway: getRequiredEnv('IPFS_GATEWAY'),
    indexerGraphql: getRequiredEnv('INDEXER_GRAPHQL_URL'),
    cqlEndpoint: process.env.CQL_ENDPOINT,
    dexCacheUrl: process.env.DEX_CACHE_URL,
  },
  network: getNetwork(),
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

// Bot initialization
let botInitializer: BotInitializer | null = null;
let tradingBots: Map<bigint, TradingBot> = new Map();

if (config.privateKey && walletClient) {
  botInitializer = new BotInitializer({
    crucibleConfig: config,
    agentSdk,
    publicClient,
    walletClient,
    treasuryAddress: config.contracts.autocratTreasury,
  });
  
  if (process.env.BOTS_ENABLED !== 'false') {
    botInitializer.initializeDefaultBots()
      .then(bots => {
        tradingBots = bots;
        log.info('Default bots initialized', { count: bots.size });
      })
      .catch(err => log.error('Failed to initialize default bots', { error: String(err) }));
  }
}

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

app.get('/info', async (c) => {
  const dwsAvailable = await checkDWSHealth();
  return c.json({
    service: 'crucible',
    version: '1.0.0',
    network: config.network,
    contracts: config.contracts,
    services: config.services,
    hasWallet: !!walletClient,
    dwsAvailable,
    runtimes: runtimeManager.getAllRuntimes().length,
  });
});

// ============================================================================
// Agent Chat API
// Uses ElizaOS + @jejunetwork/eliza-plugin when available (60+ actions)
// Falls back to DWS character-inference when ElizaOS unavailable
// ============================================================================

// Chat with an agent
app.post('/api/v1/chat/:characterId', async (c) => {
  const characterId = c.req.param('characterId');
  const character = getCharacter(characterId);
  
  if (!character) {
    return c.json({ error: `Character not found: ${characterId}` }, 404);
  }
  
  const body = await c.req.json() as { text: string; userId?: string; roomId?: string };
  
  if (!body.text) {
    return c.json({ error: 'Missing text field' }, 400);
  }
  
  // Get or create runtime for this character
  // Auto-detects ElizaOS and uses full plugin support if available
  let runtime = runtimeManager.getRuntime(characterId);
  if (!runtime) {
    runtime = await runtimeManager.createRuntime({
      agentId: characterId,
      character,
      useJejuPlugin: true, // Enable @jejunetwork/eliza-plugin
    });
  }
  
  const message: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: body.userId ?? 'anonymous',
    roomId: body.roomId ?? 'default',
    content: { text: body.text, source: 'api' },
    createdAt: Date.now(),
  };
  
  const response = await runtime.processMessage(message);
  metrics.agents.executions++;
  
  return c.json({
    text: response.text,
    action: response.action,
    actions: response.actions,
    character: characterId,
    runtime: runtime.isElizaOSAvailable() ? 'elizaos' : 'dws-fallback',
    capabilities: runtime.isElizaOSAvailable() ? 'full-plugin-support' : 'character-inference',
  });
});

// List available characters with runtime status
app.get('/api/v1/chat/characters', async (c) => {
  const characterList = listCharacters().map(id => {
    const char = getCharacter(id);
    const runtime = runtimeManager.getRuntime(id);
    return {
      id,
      name: char?.name,
      description: char?.description,
      hasRuntime: !!runtime,
      runtimeType: runtime?.isElizaOSAvailable() ? 'elizaos' : (runtime ? 'dws' : null),
      capabilities: runtime?.isElizaOSAvailable() ? 'full-plugin-support' : (runtime ? 'character-inference' : null),
    };
  });
  return c.json({ characters: characterList });
});

// Initialize all character runtimes with full ElizaOS support
app.post('/api/v1/chat/init', async (c) => {
  const results: Record<string, { success: boolean; elizaos: boolean; error?: string }> = {};
  
  for (const [id, character] of Object.entries(characters)) {
    try {
      const runtime = await runtimeManager.createRuntime({
        agentId: id,
        character,
        useJejuPlugin: true,
      });
      results[id] = { success: true, elizaos: runtime.isElizaOSAvailable() };
    } catch (e) {
      results[id] = { success: false, elizaos: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  
  const successResults = Object.values(results).filter(r => r.success);
  return c.json({
    initialized: successResults.length,
    withElizaOS: successResults.filter(r => r.elizaos).length,
    total: Object.keys(characters).length,
    results,
  });
});

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
  const id = c.req.param('id');
  expect(id, 'Character ID is required');
  const character = expect(getCharacter(id), `Character not found: ${id}`);
  return c.json({ character });
});

// Agent Management
app.post('/api/v1/agents', async (c) => {
  const rawBody = await c.req.json();
  const body = parseOrThrow(RegisterAgentRequestSchema, rawBody, 'Register agent request');
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
  const params = parseOrThrow(AgentIdParamSchema, c.req.param(), 'Agent ID parameter');
  const agentId = BigInt(params.agentId);
  const agent = await agentSdk.getAgent(agentId);
  const validAgent = expect(agent, `Agent not found: ${params.agentId}`);
  return c.json({ agent: { ...validAgent, agentId: validAgent.agentId.toString() } });
});

app.get('/api/v1/agents/:agentId/character', async (c) => {
  const params = parseOrThrow(AgentIdParamSchema, c.req.param(), 'Agent ID parameter');
  try {
    const character = await agentSdk.loadCharacter(BigInt(params.agentId));
    return c.json({ character });
  } catch (error) {
    return c.json({ error: String(error) }, 404);
  }
});

app.get('/api/v1/agents/:agentId/state', async (c) => {
  const params = parseOrThrow(AgentIdParamSchema, c.req.param(), 'Agent ID parameter');
  const state = await agentSdk.loadState(BigInt(params.agentId));
  return c.json({ state });
});

app.get('/api/v1/agents/:agentId/balance', async (c) => {
  const params = parseOrThrow(AgentIdParamSchema, c.req.param(), 'Agent ID parameter');
  const balance = await agentSdk.getVaultBalance(BigInt(params.agentId));
  return c.json({ balance: balance.toString() });
});

app.post('/api/v1/agents/:agentId/fund', async (c) => {
  const params = parseOrThrow(AgentIdParamSchema, c.req.param(), 'Agent ID parameter');
  const rawBody = await c.req.json();
  const body = parseOrThrow(FundAgentRequestSchema, rawBody, 'Fund agent request');
  const agentId = BigInt(params.agentId);
  try {
    const txHash = await agentSdk.fundVault(agentId, BigInt(body.amount));
    return c.json({ txHash });
  } catch (error) {
    return c.json({ error: String(error) }, 400);
  }
});

app.post('/api/v1/agents/:agentId/memory', async (c) => {
  const params = parseOrThrow(AgentIdParamSchema, c.req.param(), 'Agent ID parameter');
  const rawBody = await c.req.json();
  const body = parseOrThrow(AddMemoryRequestSchema, rawBody, 'Add memory request');
  const agentId = BigInt(params.agentId);
  const memory = await agentSdk.addMemory(agentId, body.content, {
    importance: body.importance,
    roomId: body.roomId,
    userId: body.userId,
  });
  return c.json({ memory });
});

// Room Management
app.post('/api/v1/rooms', async (c) => {
  const rawBody = await c.req.json();
  const body = parseOrThrow(CreateRoomRequestSchema, rawBody, 'Create room request');
  log.info('Creating room', { name: body.name, roomType: body.roomType });

  const result = await roomSdk.createRoom(body.name, body.description, body.roomType, {
    maxMembers: body.config?.maxMembers ?? 10,
    turnBased: body.config?.turnBased ?? false,
    turnTimeout: body.config?.turnTimeout ?? 300,
    visibility: 'public' as const,
  });
  metrics.rooms.created++;

  return c.json({ roomId: result.roomId.toString(), stateCid: result.stateCid });
});

app.get('/api/v1/rooms/:roomId', async (c) => {
  const params = parseOrThrow(RoomIdParamSchema, c.req.param(), 'Room ID parameter');
  const room = await roomSdk.getRoom(BigInt(params.roomId));
  const validRoom = expect(room, `Room not found: ${params.roomId}`);
  return c.json({
    room: {
      ...validRoom, roomId: validRoom.roomId.toString(),
      members: validRoom.members.map(m => ({ ...m, agentId: m.agentId.toString() })),
    },
  });
});

app.post('/api/v1/rooms/:roomId/join', async (c) => {
  const params = parseOrThrow(RoomIdParamSchema, c.req.param(), 'Room ID parameter');
  const rawBody = await c.req.json();
  const body = parseOrThrow(JoinRoomRequestSchema, rawBody, 'Join room request');
  await roomSdk.joinRoom(BigInt(params.roomId), BigInt(body.agentId), body.role);
  return c.json({ success: true });
});

app.post('/api/v1/rooms/:roomId/leave', async (c) => {
  const params = parseOrThrow(RoomIdParamSchema, c.req.param(), 'Room ID parameter');
  const rawBody = await c.req.json();
  const body = parseOrThrow(LeaveRoomRequestSchema, rawBody, 'Leave room request');
  await roomSdk.leaveRoom(BigInt(params.roomId), BigInt(body.agentId));
  return c.json({ success: true });
});

app.post('/api/v1/rooms/:roomId/message', async (c) => {
  const params = parseOrThrow(RoomIdParamSchema, c.req.param(), 'Room ID parameter');
  const rawBody = await c.req.json();
  const body = parseOrThrow(PostMessageRequestSchema, rawBody, 'Post message request');
  const message = await roomSdk.postMessage(BigInt(params.roomId), BigInt(body.agentId), body.content, body.action);
  metrics.rooms.messages++;
  return c.json({ message });
});

app.get('/api/v1/rooms/:roomId/messages', async (c) => {
  const params = parseOrThrow(RoomIdParamSchema, c.req.param(), 'Room ID parameter');
  const limitStr = c.req.query('limit');
  const limit = limitStr ? parseOrThrow(z.number().int().min(1).max(1000), parseInt(limitStr), 'Limit query parameter') : 50;
  try {
    const messages = await roomSdk.getMessages(BigInt(params.roomId), limit);
    return c.json({ messages });
  } catch (error) {
    return c.json({ error: String(error) }, 404);
  }
});

app.post('/api/v1/rooms/:roomId/phase', async (c) => {
  const params = parseOrThrow(RoomIdParamSchema, c.req.param(), 'Room ID parameter');
  const rawBody = await c.req.json();
  const body = parseOrThrow(SetPhaseRequestSchema, rawBody, 'Set phase request');
  await roomSdk.setPhase(BigInt(params.roomId), body.phase);
  return c.json({ success: true });
});

// Execution
app.post('/api/v1/execute', async (c) => {
  expect(walletClient && account, 'Executor not configured - missing private key');

  const rawBody = await c.req.json();
  const body = parseOrThrow(ExecuteRequestSchema, rawBody, 'Execute request');

  log.info('Executing agent', { agentId: body.agentId });

  const executorSdk = createExecutorSDK({
    crucibleConfig: config, storage, compute, agentSdk, roomSdk,
    publicClient, walletClient: expect(walletClient, 'Wallet client is required'), executorAddress: expect(account, 'Account is required').address,
  });

  const request: ExecutionRequest = {
    agentId: BigInt(body.agentId),
    triggerId: body.triggerId,
    input: body.input,
    options: body.options ? {
      ...body.options,
      maxCost: body.options.maxCost ? BigInt(body.options.maxCost) : undefined,
    } : undefined,
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

// Bot Management
app.get('/api/v1/bots', async (c) => {
  const bots = Array.from(tradingBots.entries()).map(([agentId, bot]) => ({
    agentId: agentId.toString(),
    metrics: bot.getMetrics(),
    healthy: bot.isHealthy(),
  }));
  return c.json({ bots });
});

app.get('/api/v1/bots/:agentId/metrics', async (c) => {
  const params = parseOrThrow(BotIdParamSchema, c.req.param(), 'Bot ID parameter');
  const agentId = BigInt(params.agentId);
  const bot = expect(tradingBots.get(agentId), `Bot not found: ${params.agentId}`);
  return c.json({ metrics: bot.getMetrics() });
});

app.post('/api/v1/bots/:agentId/stop', async (c) => {
  const params = parseOrThrow(BotIdParamSchema, c.req.param(), 'Bot ID parameter');
  const agentId = BigInt(params.agentId);
  const bot = expect(tradingBots.get(agentId), `Bot not found: ${params.agentId}`);
  await bot.stop();
  tradingBots.delete(agentId);
  return c.json({ success: true });
});

app.post('/api/v1/bots/:agentId/start', async (c) => {
  const params = parseOrThrow(BotIdParamSchema, c.req.param(), 'Bot ID parameter');
  const agentId = BigInt(params.agentId);
  const bot = expect(tradingBots.get(agentId), `Bot not found: ${params.agentId}`);
  await bot.start();
  return c.json({ success: true });
});

// Search
app.get('/api/v1/search/agents', async (c) => {
  try {
    const rawQuery = c.req.query();
    const parsedQuery = AgentSearchQuerySchema.parse(rawQuery);
    const result = await agentSdk.searchAgents({
      name: parsedQuery.name,
      owner: parsedQuery.owner as `0x${string}` | undefined,
      active: parsedQuery.active,
      limit: parsedQuery.limit ?? 20,
    });
    return c.json({
      agents: result.items.map(a => ({ ...a, agentId: a.agentId.toString() })),
      total: result.total,
      hasMore: result.hasMore,
    });
  } catch (error) {
    return c.json({ error: String(error) }, 400);
  }
});

const portStr = process.env.PORT;
if (!portStr) {
  throw new Error('PORT environment variable is required');
}
const port = parseInt(portStr, 10);
if (isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT: ${portStr}. Must be a valid port number`);
}

log.info('Starting server', { port, network: config.network, wallet: account?.address ?? 'not configured' });

export default { port, fetch: app.fetch };
