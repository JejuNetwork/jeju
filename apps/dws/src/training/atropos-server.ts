/**
 * Atropos API Server for Jeju DWS
 * 
 * Production-ready implementation of the Atropos rollout server
 * for GRPO/PPO training coordination. Designed for distributed RL training
 * with Psyche integration for decentralized model training.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { compress } from 'hono/compress';
import type { Context } from 'hono';

// ============================================================================
// Types
// ============================================================================

export interface ScoredData {
  tokens: number[][];
  masks: number[][];
  scores: number[];
  advantages?: number[][] | null;
  ref_logprobs?: number[][] | null;
  messages?: Message[][] | null;
  generation_params?: Record<string, string | number | boolean> | null;
  inference_logprobs?: number[][] | null;
  overrides?: Record<string, string | number | boolean>[] | null;
  group_overrides?: Record<string, string | number | boolean> | null;
  images?: string[] | null;
  env_id?: number | null;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  reward?: number;
}

export interface Registration {
  wandb_group: string;
  wandb_project: string;
  batch_size: number;
  max_token_len: number;
  checkpoint_dir: string;
  save_checkpoint_interval: number;
  starting_step: number;
  num_steps: number;
}

export interface RegisterEnv {
  max_token_length: number;
  desired_name: string;
  weight: number;
  group_size: number;
  min_batch_allocation?: number | null;
}

export interface EnvConfig {
  max_context_len: number;
  weight: number;
  desired_name: string;
  real_name: string;
  registered_id: number;
  last_update: number;
  connected: boolean;
  min_batch_allocation: number | null;
  group_size: number;
}

export interface AtroposState {
  queue: ScoredData[];
  group: string | null;
  project: string | null;
  batchsize: number;
  max_token_len: number;
  status_dict: { step: number };
  checkpoint_dir: string;
  save_checkpoint_interval: number;
  num_steps: number;
  curr_batch: ScoredData[][];
  started: boolean;
  envs: EnvConfig[];
  buffer: Map<number, ScoredData[]>;
  requesters: bigint[];
  latest: ScoredData | null;
}

// ============================================================================
// State Management
// ============================================================================

function createInitialState(): AtroposState {
  return {
    queue: [],
    group: null,
    project: null,
    batchsize: -1,
    max_token_len: -1,
    status_dict: { step: 0 },
    checkpoint_dir: '',
    save_checkpoint_interval: -1,
    num_steps: -1,
    curr_batch: [],
    started: false,
    envs: [],
    buffer: new Map(),
    requesters: [],
    latest: null,
  };
}

const MIN_ENV_WEIGHT = 0.01;

// ============================================================================
// Batch Helpers
// ============================================================================

function findGroupsSummingToTarget(
  groups: ScoredData[],
  target: number
): number[] {
  const sizes = groups.map(g => g.tokens.length);
  
  // Simple greedy algorithm for finding groups that sum to target
  const indices: number[] = [];
  let sum = 0;
  
  for (let i = 0; i < sizes.length && sum < target; i++) {
    if (sum + sizes[i] <= target) {
      indices.push(i);
      sum += sizes[i];
    }
  }
  
  return sum === target ? indices : [];
}

function grabBatchWithMinimumAllocations(
  queue: ScoredData[],
  batchSize: number,
  envs: EnvConfig[]
): [ScoredData[] | null, ScoredData[]] {
  if (queue.length === 0) return [null, queue];
  
  const batch: ScoredData[] = [];
  const remaining = [...queue];
  let totalTokens = 0;
  
  // First, fill minimum allocations
  for (const env of envs) {
    if (env.min_batch_allocation !== null && env.connected) {
      const minSeqs = Math.ceil(batchSize * env.min_batch_allocation);
      let envSeqs = 0;
      
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (remaining[i].env_id === env.registered_id) {
          batch.push(remaining[i]);
          totalTokens += remaining[i].tokens.length;
          remaining.splice(i, 1);
          envSeqs++;
          if (envSeqs >= minSeqs) break;
        }
      }
    }
  }
  
  // Fill rest of batch
  while (totalTokens < batchSize && remaining.length > 0) {
    const item = remaining.shift();
    if (item) {
      batch.push(item);
      totalTokens += item.tokens.length;
    }
  }
  
  if (totalTokens < batchSize) {
    return [null, [...batch, ...remaining]];
  }
  
  return [batch, remaining];
}

function grabExactFromHeterogeneousQueue(
  queue: ScoredData[],
  batchSize: number
): [ScoredData[] | null, ScoredData[]] {
  if (queue.length === 0) return [null, queue];
  
  const batch: ScoredData[] = [];
  const remaining = [...queue];
  let totalTokens = 0;
  
  while (totalTokens < batchSize && remaining.length > 0) {
    const item = remaining.shift();
    if (item) {
      batch.push(item);
      totalTokens += item.tokens.length;
    }
  }
  
  if (totalTokens < batchSize) {
    return [null, [...batch, ...remaining]];
  }
  
  return [batch, remaining];
}

// ============================================================================
// Scored Data Processing
// ============================================================================

function processScoredData(
  state: AtroposState,
  scoredData: ScoredData
): { status: string; buffer_size?: number } {
  const envId = scoredData.env_id;
  
  if (envId !== undefined && envId !== null && envId < state.envs.length) {
    const expectedGroupSize = state.envs[envId].group_size;
    const actualGroupSize = scoredData.tokens.length;
    
    if (actualGroupSize !== expectedGroupSize) {
      let buffer = state.buffer.get(envId);
      if (!buffer) {
        buffer = [];
        state.buffer.set(envId, buffer);
      }
      buffer.push(scoredData);
      
      const indices = findGroupsSummingToTarget(buffer, expectedGroupSize);
      
      if (indices.length > 0) {
        const groupsToAdd: ScoredData[] = [];
        for (const idx of indices.sort((a, b) => b - a)) {
          groupsToAdd.push(buffer.splice(idx, 1)[0]);
        }
        
        for (const group of groupsToAdd.reverse()) {
          state.queue.push(group);
          state.latest = group;
        }
      }
      
      return {
        status: 'buffered',
        buffer_size: buffer.reduce((sum, g) => sum + g.tokens.length, 0),
      };
    }
  }
  
  state.queue.push(scoredData);
  state.latest = scoredData;
  return { status: 'received' };
}

// ============================================================================
// Create Atropos Server
// ============================================================================

export function createAtroposServer(): Hono {
  const app = new Hono();
  const state = createInitialState();
  
  // Middleware
  app.use('*', cors());
  app.use('*', logger());
  app.use('*', compress());
  
  // Root endpoint
  app.get('/', (c: Context) => {
    return c.json({ message: 'Atropos API Server for Jeju DWS' });
  });
  
  // Register trainer
  app.post('/register', async (c: Context) => {
    const registration = await c.req.json() as Registration;
    
    if (state.queue.length === 0) {
      state.group = registration.wandb_group;
      state.project = registration.wandb_project;
      state.batchsize = registration.batch_size;
      state.max_token_len = registration.max_token_len;
      state.status_dict = { step: registration.starting_step };
      state.checkpoint_dir = registration.checkpoint_dir;
      state.save_checkpoint_interval = registration.save_checkpoint_interval;
      state.num_steps = registration.num_steps;
      state.curr_batch = [];
      state.started = false;
      state.envs = [];
      state.buffer = new Map();
    }
    
    const uuid = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    state.requesters.push(uuid);
    
    return c.json({ uuid: uuid.toString() });
  });
  
  // Register environment
  app.post('/register-env', async (c: Context) => {
    const registerEnv = await c.req.json() as RegisterEnv;
    
    if (!state.started) {
      return c.json({ status: 'wait for trainer to start' });
    }
    
    const realName = `${registerEnv.desired_name}_${
      state.envs.filter(x => x.desired_name === registerEnv.desired_name).length
    }`;
    const registeredId = state.envs.length;
    
    state.envs.push({
      max_context_len: registerEnv.max_token_length,
      weight: registerEnv.weight ?? 1.0,
      desired_name: registerEnv.desired_name,
      real_name: realName,
      registered_id: registeredId,
      last_update: Date.now(),
      connected: true,
      min_batch_allocation: registerEnv.min_batch_allocation ?? null,
      group_size: registerEnv.group_size,
    });
    
    return c.json({
      status: 'success',
      env_id: registeredId,
      wandb_name: realName,
      checkpoint_dir: state.checkpoint_dir,
      starting_step: state.status_dict.step,
      checkpoint_interval: state.save_checkpoint_interval,
      num_steps: state.num_steps,
    });
  });
  
  // Disconnect environment
  app.post('/disconnect-env', async (c: Context) => {
    const { env_id } = await c.req.json() as { env_id: number };
    
    if (env_id < state.envs.length) {
      state.envs[env_id].connected = false;
      return c.json({ status: 'success' });
    }
    
    return c.json({ status: 'failure', error: 'Environment not found' });
  });
  
  // Wandb info
  app.get('/wandb_info', (c: Context) => {
    return c.json({
      group: state.group,
      project: state.project,
    });
  });
  
  // Server info
  app.get('/info', (c: Context) => {
    return c.json({
      batch_size: state.batchsize,
      max_token_len: state.max_token_len,
    });
  });
  
  // Get batch for training
  app.get('/batch', (c: Context) => {
    if (!state.started) {
      state.started = true;
    }
    
    if (state.curr_batch.length > 0) {
      return c.json({ batch: state.curr_batch.pop() });
    }
    
    const newBatches: ScoredData[][] = [];
    const hasMinAllocations = state.envs.some(
      env => env.min_batch_allocation !== null
    );
    
    let result: [ScoredData[] | null, ScoredData[]];
    
    if (hasMinAllocations) {
      result = grabBatchWithMinimumAllocations(
        state.queue,
        state.batchsize,
        state.envs
      );
    } else {
      result = grabExactFromHeterogeneousQueue(state.queue, state.batchsize);
    }
    
    let [batch, remaining] = result;
    state.queue = remaining;
    
    while (batch !== null) {
      newBatches.push(batch);
      
      if (hasMinAllocations) {
        result = grabBatchWithMinimumAllocations(
          state.queue,
          state.batchsize,
          state.envs
        );
      } else {
        result = grabExactFromHeterogeneousQueue(state.queue, state.batchsize);
      }
      
      [batch, remaining] = result;
      state.queue = remaining;
    }
    
    if (newBatches.length === 0) {
      return c.json({ batch: null });
    }
    
    state.status_dict.step += newBatches.length;
    state.curr_batch.push(...newBatches);
    
    const currBatch = state.curr_batch.pop();
    if (currBatch) {
      const totalSeqs = currBatch.reduce((sum, item) => sum + item.tokens.length, 0);
      console.log(`[Atropos] Sending batch of ${totalSeqs} sequences`);
    }
    
    return c.json({ batch: currBatch ?? null });
  });
  
  // Latest example
  app.get('/latest_example', (c: Context) => {
    if (state.latest) {
      return c.json(state.latest);
    }
    return c.json({
      tokens: [],
      masks: [],
      scores: [],
      advantages: [],
      ref_logprobs: [],
      generation_params: [],
      inference_logprobs: [],
      messages: [],
      images: [],
    });
  });
  
  // Submit scored data
  app.post('/scored_data', async (c: Context) => {
    const scoredData = await c.req.json() as ScoredData;
    const result = processScoredData(state, scoredData);
    return c.json(result);
  });
  
  // Submit scored data list
  app.post('/scored_data_list', async (c: Context) => {
    const scoredDataList = await c.req.json() as ScoredData[];
    
    let bufferedCount = 0;
    let lastBufferSize: number | null = null;
    
    for (const scoredData of scoredDataList) {
      const result = processScoredData(state, scoredData);
      if (result.status === 'buffered') {
        bufferedCount++;
        lastBufferSize = result.buffer_size ?? lastBufferSize;
      }
    }
    
    const response: Record<string, string | number | null> = {
      status: 'received',
      groups_processed: scoredDataList.length,
    };
    
    if (bufferedCount > 0) {
      response.buffered = bufferedCount;
      if (lastBufferSize !== null) {
        response.last_buffer_size = lastBufferSize;
      }
    }
    
    return c.json(response);
  });
  
  // Get status
  app.get('/status', (c: Context) => {
    return c.json({
      current_step: state.status_dict.step,
      queue_size: state.queue.length,
    });
  });
  
  // Get status for environment
  app.get('/status-env', async (c: Context) => {
    const envIdParam = c.req.query('env_id');
    const envId = envIdParam ? parseInt(envIdParam, 10) : 0;
    
    if (state.envs.length === 0) {
      return c.json({
        current_step: 0,
        queue_size: 0,
        unallocated_fraction: 1.0,
        self_queue_size: 0,
        max_group_size: 1,
        env_weight: 1.0,
      });
    }
    
    const total = state.envs
      .filter(x => x.connected)
      .reduce((sum, x) => sum + x.max_context_len * Math.max(0, x.weight), 0);
    
    let envGroupSize = state.envs[envId]?.group_size ?? 1;
    let envWeight = total > 0
      ? (state.envs[envId].max_context_len * state.envs[envId].weight) / total
      : 1.0;
    envWeight = Math.max(MIN_ENV_WEIGHT, envWeight);
    
    // Calculate minimum allocations
    let totalMinAllocation = 0;
    for (const env of state.envs) {
      if (env.connected && env.min_batch_allocation !== null) {
        totalMinAllocation += env.min_batch_allocation;
      }
    }
    
    const unallocatedFraction = 1.0 - Math.min(totalMinAllocation, 1.0);
    
    // Find max group size and count self sequences
    let maxGroupSize = 1;
    let numSelfSequencesInQueue = 0;
    
    for (const item of state.queue) {
      const groupSize = item.tokens.length;
      if (groupSize > maxGroupSize) {
        maxGroupSize = groupSize;
      }
      if (item.env_id === envId) {
        envGroupSize = Math.max(envGroupSize, groupSize);
        numSelfSequencesInQueue += groupSize;
      }
    }
    
    if (state.envs[envId]) {
      state.envs[envId].group_size = envGroupSize;
    }
    
    return c.json({
      current_step: state.status_dict.step,
      queue_size: Math.floor(state.queue.length / envGroupSize),
      unallocated_fraction: unallocatedFraction,
      self_queue_size: Math.floor(numSelfSequencesInQueue / envGroupSize),
      max_group_size: maxGroupSize,
      env_weight: envWeight,
    });
  });
  
  // Reset data
  app.get('/reset_data', (c: Context) => {
    Object.assign(state, createInitialState());
    return c.text('Reset successful', 200);
  });
  
  // Health check
  app.get('/health', (c: Context) => {
    return c.json({
      status: 'healthy',
      started: state.started,
      queue_size: state.queue.length,
      envs: state.envs.length,
      step: state.status_dict.step,
    });
  });
  
  return app;
}

// ============================================================================
// Standalone Server
// ============================================================================

export async function startAtroposServer(port = 8000): Promise<void> {
  const app = createAtroposServer();
  
  console.log(`[Atropos] Starting server on port ${port}`);
  
  const server = Bun.serve({
    port,
    fetch: app.fetch,
  });
  
  console.log(`[Atropos] Server listening on http://localhost:${server.port}`);
}

// Run if executed directly
if (import.meta.main) {
  const port = parseInt(process.env.ATROPOS_PORT ?? '8000', 10);
  startAtroposServer(port);
}

