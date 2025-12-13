/**
 * Org API Server - REST API for decentralized organization management.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { OrgConfig, OrgState } from './types';
import { createOrgStorage } from './services/storage';
import { createTodoService } from './services/todos';
import { createCheckinService } from './services/checkins';

const config: OrgConfig = {
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  privateKey: process.env.PRIVATE_KEY,
  contracts: {
    roomRegistry: (process.env.ROOM_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`,
    identityRegistry: (process.env.IDENTITY_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`,
  },
  services: {
    storageApi: process.env.STORAGE_API_URL ?? 'http://127.0.0.1:3100',
    ipfsGateway: process.env.IPFS_GATEWAY ?? 'http://127.0.0.1:3100',
    crucibleApi: process.env.CRUCIBLE_API_URL ?? 'http://127.0.0.1:4020',
  },
  network: (process.env.NETWORK as 'localnet' | 'testnet' | 'mainnet') ?? 'localnet',
};

const storage = createOrgStorage({
  apiUrl: config.services.storageApi,
  ipfsGateway: config.services.ipfsGateway,
});

const todoService = createTodoService(storage);
const checkinService = createCheckinService(storage);

const stateCache = new Map<string, OrgState>();

async function getState(orgId: string): Promise<OrgState> {
  let state = stateCache.get(orgId);
  if (!state) {
    state = storage.createInitialState(orgId);
    stateCache.set(orgId, state);
  }
  return state;
}

async function setState(orgId: string, state: OrgState): Promise<void> {
  stateCache.set(orgId, state);
}

const app = new Hono();

app.use('*', cors());
app.use('*', logger());

app.get('/health', (c) => c.json({ status: 'healthy', service: 'org' }));

app.post('/api/v1/orgs/:orgId/todos', async (c) => {
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const state = await getState(orgId);

  const { todo, state: newState } = await todoService.create(state, {
    ...body,
    createdBy: body.createdBy ?? 'api',
  });

  await setState(orgId, newState);
  return c.json({ todo });
});

app.get('/api/v1/orgs/:orgId/todos', async (c) => {
  const orgId = c.req.param('orgId');
  const state = await getState(orgId);

  const { todos, total } = todoService.list(state, {
    status: c.req.query('status') as never,
    priority: c.req.query('priority') as never,
    limit: parseInt(c.req.query('limit') ?? '50'),
  });

  return c.json({ todos, total });
});

app.patch('/api/v1/orgs/:orgId/todos/:todoId', async (c) => {
  const orgId = c.req.param('orgId');
  const todoId = c.req.param('todoId');
  const body = await c.req.json();
  const state = await getState(orgId);

  const { todo, state: newState } = await todoService.update(state, todoId, body);

  await setState(orgId, newState);
  return c.json({ todo });
});

app.post('/api/v1/orgs/:orgId/todos/:todoId/complete', async (c) => {
  const orgId = c.req.param('orgId');
  const todoId = c.req.param('todoId');
  const state = await getState(orgId);

  const { todo, state: newState } = await todoService.complete(state, todoId);

  await setState(orgId, newState);
  return c.json({ todo });
});

app.get('/api/v1/orgs/:orgId/todos/stats', async (c) => {
  const orgId = c.req.param('orgId');
  const state = await getState(orgId);

  const stats = todoService.getStats(state);
  return c.json({ stats });
});

app.post('/api/v1/orgs/:orgId/checkins/schedules', async (c) => {
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const state = await getState(orgId);

  const { schedule, state: newState } = await checkinService.createSchedule(state, {
    ...body,
    createdBy: body.createdBy ?? 'api',
  });

  await setState(orgId, newState);
  return c.json({ schedule });
});

app.get('/api/v1/orgs/:orgId/checkins/schedules', async (c) => {
  const orgId = c.req.param('orgId');
  const roomId = c.req.query('roomId');
  const state = await getState(orgId);

  const schedules = checkinService.listSchedules(state, roomId);
  return c.json({ schedules });
});

app.post('/api/v1/orgs/:orgId/checkins/responses', async (c) => {
  const orgId = c.req.param('orgId');
  const body = await c.req.json();
  const state = await getState(orgId);

  const { response, state: newState } = await checkinService.recordResponse(state, body);

  await setState(orgId, newState);
  return c.json({ response });
});

app.get('/api/v1/orgs/:orgId/checkins/:scheduleId/report', async (c) => {
  const orgId = c.req.param('orgId');
  const scheduleId = c.req.param('scheduleId');
  const start = parseInt(c.req.query('start') ?? String(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const end = parseInt(c.req.query('end') ?? String(Date.now()));
  const state = await getState(orgId);

  const report = checkinService.generateReport(state, scheduleId, { start, end });
  return c.json({ report });
});

const port = parseInt(process.env.PORT ?? '4022');

export default { port, fetch: app.fetch };
