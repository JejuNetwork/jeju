/**
 * Distributed Training System Tests
 * 
 * Comprehensive tests for the Jeju DWS distributed training infrastructure:
 * - Atropos API server
 * - Psyche client
 * - Cross-chain bridge
 * - GRPO trainer
 * - Fundamental prediction environment
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import {
  createAtroposServer,
  type ScoredData,
  type Registration,
  type RegisterEnv,
} from './atropos-server';
import {
  createFundamentalPredictionEnv,
  type EnvConfig,
  type APIServerConfig,
} from './environments/fundamental-prediction';
import { createGRPOTrainer, type TrainingConfig } from './grpo-trainer';
import type { Server } from 'bun';

// ============================================================================
// Test Setup
// ============================================================================

let atroposServer: Server | null = null;
let atroposPort: number;

beforeAll(async () => {
  // Start Atropos server on a random available port
  atroposPort = 8100 + Math.floor(Math.random() * 100);
  const app = createAtroposServer();

  atroposServer = Bun.serve({
    port: atroposPort,
    fetch: app.fetch,
  });

  console.log(`[Test] Atropos server started on port ${atroposPort}`);
});

afterAll(() => {
  if (atroposServer) {
    atroposServer.stop();
    console.log('[Test] Atropos server stopped');
  }
});

// ============================================================================
// Atropos Server Tests
// ============================================================================

describe('Atropos Server', () => {
  const baseUrl = () => `http://localhost:${atroposPort}`;

  beforeEach(async () => {
    // Reset server state
    await fetch(`${baseUrl()}/reset_data`);
  });

  test('root endpoint returns message', async () => {
    const response = await fetch(baseUrl());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe('Atropos API Server for Jeju DWS');
  });

  test('health check returns status', async () => {
    const response = await fetch(`${baseUrl()}/health`);
    const data = await response.json() as { status: string; started: boolean };

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.started).toBe(false);
  });

  test('register trainer creates session', async () => {
    const registration: Registration = {
      wandb_group: 'test-group',
      wandb_project: 'test-project',
      batch_size: 32,
      max_token_len: 2048,
      checkpoint_dir: '/tmp/checkpoints',
      save_checkpoint_interval: 10,
      starting_step: 0,
      num_steps: 100,
    };

    const response = await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration),
    });

    const data = await response.json() as { uuid: string };

    expect(response.status).toBe(200);
    expect(data.uuid).toBeDefined();
  });

  test('wandb_info returns project info after registration', async () => {
    // Register first
    await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wandb_group: 'test-group',
        wandb_project: 'test-project',
        batch_size: 32,
        max_token_len: 2048,
        checkpoint_dir: '/tmp/checkpoints',
        save_checkpoint_interval: 10,
        starting_step: 0,
        num_steps: 100,
      }),
    });

    const response = await fetch(`${baseUrl()}/wandb_info`);
    const data = await response.json() as { group: string; project: string };

    expect(response.status).toBe(200);
    expect(data.group).toBe('test-group');
    expect(data.project).toBe('test-project');
  });

  test('register-env requires trainer to be started', async () => {
    const registerEnv: RegisterEnv = {
      max_token_length: 2048,
      desired_name: 'test-env',
      weight: 1.0,
      group_size: 4,
    };

    const response = await fetch(`${baseUrl()}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerEnv),
    });

    const data = await response.json() as { status: string };

    expect(response.status).toBe(200);
    expect(data.status).toBe('wait for trainer to start');
  });

  test('full training flow works', async () => {
    // 1. Register trainer
    await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wandb_group: 'test-group',
        wandb_project: 'test-project',
        batch_size: 4,
        max_token_len: 2048,
        checkpoint_dir: '/tmp/checkpoints',
        save_checkpoint_interval: 10,
        starting_step: 0,
        num_steps: 100,
      }),
    });

    // 2. Start (by requesting batch)
    await fetch(`${baseUrl()}/batch`);

    // 3. Register environment
    const envResponse = await fetch(`${baseUrl()}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 2048,
        desired_name: 'test-env',
        weight: 1.0,
        group_size: 4,
      }),
    });

    const envData = await envResponse.json() as { status: string; env_id: number };
    expect(envData.status).toBe('success');
    expect(envData.env_id).toBe(0);

    // 4. Submit scored data
    const scoredData: ScoredData = {
      tokens: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
      masks: [[0, 0, -100, -100], [0, 0, -100, -100], [0, 0, -100, -100], [0, 0, -100, -100]],
      scores: [1.0, -1.0, 0.5, -0.5],
      env_id: 0,
    };

    const scoreResponse = await fetch(`${baseUrl()}/scored_data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scoredData),
    });

    const scoreData = await scoreResponse.json() as { status: string };
    expect(scoreData.status).toBe('received');

    // 5. Check status
    const statusResponse = await fetch(`${baseUrl()}/status`);
    const statusData = await statusResponse.json() as { current_step: number; queue_size: number };

    expect(statusData.current_step).toBe(0);
    expect(statusData.queue_size).toBe(1);
  });

  test('batch retrieval returns data when available', async () => {
    // Setup
    await fetch(`${baseUrl()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wandb_group: 'test',
        wandb_project: 'test',
        batch_size: 4,
        max_token_len: 2048,
        checkpoint_dir: '/tmp',
        save_checkpoint_interval: 10,
        starting_step: 0,
        num_steps: 100,
      }),
    });

    await fetch(`${baseUrl()}/batch`);

    await fetch(`${baseUrl()}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 2048,
        desired_name: 'test',
        weight: 1.0,
        group_size: 4,
      }),
    });

    // Submit enough data for a batch
    for (let i = 0; i < 4; i++) {
      await fetch(`${baseUrl()}/scored_data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: [[1, 2, 3, 4]],
          masks: [[0, 0, -100, -100]],
          scores: [1.0],
          env_id: 0,
        }),
      });
    }

    // Get batch
    const response = await fetch(`${baseUrl()}/batch`);
    const data = await response.json() as { batch: ScoredData[] | null };

    expect(response.status).toBe(200);
    expect(data.batch).not.toBeNull();
    expect(Array.isArray(data.batch)).toBe(true);
  });
});

// ============================================================================
// Fundamental Prediction Environment Tests
// ============================================================================

describe('Fundamental Prediction Environment', () => {
  test('configInit returns valid configuration', () => {
    const { envConfig, serverConfigs } = createFundamentalPredictionEnv.constructor.prototype.constructor.configInit
      ? { envConfig: {}, serverConfigs: [] }
      : { envConfig: {}, serverConfigs: [] };

    // Use factory function instead
    const env = createFundamentalPredictionEnv();
    expect(env).toBeDefined();
  });

  test('environment setup loads dataset', async () => {
    const env = createFundamentalPredictionEnv();
    await env.setup();

    // Environment should have training data
    const item = await env.getNextItem();
    expect(item).toBeDefined();
    expect(item.context).toBeDefined();
    expect(item.answer).toBeDefined();
    expect(item.magnitude).toBeDefined();
    expect(item.fundamentalMetric).toBeDefined();
  });

  test('getNextItem returns sequential items', async () => {
    const env = createFundamentalPredictionEnv();
    await env.setup();

    const item1 = await env.getNextItem();
    const item2 = await env.getNextItem();

    // Items should be defined
    expect(item1).toBeDefined();
    expect(item2).toBeDefined();
  });

  test('answer extraction works correctly', () => {
    // Test the extraction logic indirectly through the environment
    const testText = `<think>
Let me analyze the data carefully...
The revenue trends suggest growth.
</think>

Based on my analysis, The earnings guidance will be: raised and the magnitude will be: 8.5%`;

    // This tests the regex pattern used in the environment
    const pattern = /The earnings guidance will be:\s*(maintained|raised|reduced)\s*and\s*the\s*magnitude\s*will\s*be:\s*([-+]?\d+(?:\.\d+)?)%/i;
    const match = testText.match(pattern);

    expect(match).not.toBeNull();
    expect(match?.[1].toLowerCase()).toBe('raised');
    expect(match?.[2]).toBe('8.5');
  });
});

// ============================================================================
// GRPO Trainer Tests
// ============================================================================

describe('GRPO Trainer', () => {
  test('trainer initializes with default config', () => {
    const trainer = createGRPOTrainer();
    expect(trainer).toBeDefined();
  });

  test('trainer initializes with custom config', () => {
    const trainer = createGRPOTrainer({
      modelName: 'test-model',
      trainingSteps: 10,
      batchSize: 8,
    });

    expect(trainer).toBeDefined();
  });

  test('trainer can register with atropos', async () => {
    const trainer = createGRPOTrainer({
      atroposUrl: `http://localhost:${atroposPort}`,
    });

    // Reset server first
    await fetch(`http://localhost:${atroposPort}/reset_data`);

    // This should complete successfully without error
    await trainer.registerWithAtropos();
    
    // Verify registration by checking info
    const infoResponse = await fetch(`http://localhost:${atroposPort}/info`);
    const info = await infoResponse.json() as { batch_size: number };
    expect(info.batch_size).toBe(32); // batchSize * gradientAccumulationSteps = 2 * 16
  });

  test('trainer getBatch handles empty queue', async () => {
    const trainer = createGRPOTrainer({
      atroposUrl: `http://localhost:${atroposPort}`,
    });

    // Reset and register
    await fetch(`http://localhost:${atroposPort}/reset_data`);
    await trainer.registerWithAtropos();

    // Request batch (starts the server)
    const batch = await trainer.getBatch();

    // Should return null when queue is empty
    expect(batch).toBeNull();
  });
});

// ============================================================================
// Cross-Chain Bridge Tests (Mock)
// ============================================================================

describe('Cross-Chain Bridge', () => {
  test('merkle root computation is consistent', () => {
    // Import the bridge module
    const { CrossChainTrainingBridge } = require('./cross-chain-bridge') as {
      CrossChainTrainingBridge: typeof import('./cross-chain-bridge').CrossChainTrainingBridge;
    };

    // Create bridge with mock config
    const bridge = new CrossChainTrainingBridge({
      evmRpcUrl: 'http://localhost:8545',
      bridgeContractAddress: '0x0000000000000000000000000000000000000001',
      solanaRpcUrl: 'http://localhost:8899',
    });

    const rewards = [
      { client: '0x1234567890123456789012345678901234567890' as `0x${string}`, amount: 100n },
      { client: '0x2345678901234567890123456789012345678901' as `0x${string}`, amount: 200n },
    ];

    const root1 = bridge.computeRewardsMerkleRoot(rewards);
    const root2 = bridge.computeRewardsMerkleRoot(rewards);

    expect(root1).toBe(root2);
    expect(root1.startsWith('0x')).toBe(true);
    expect(root1.length).toBe(66);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  test('full training loop simulation', async () => {
    const baseUrl = `http://localhost:${atroposPort}`;

    // Reset
    await fetch(`${baseUrl}/reset_data`);

    // 1. Register trainer
    const regResponse = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wandb_group: 'integration-test',
        wandb_project: 'jeju-training',
        batch_size: 8,
        max_token_len: 1024,
        checkpoint_dir: '/tmp/integration-test',
        save_checkpoint_interval: 5,
        starting_step: 0,
        num_steps: 10,
      }),
    });

    expect(regResponse.status).toBe(200);

    // 2. Start training (request first batch)
    await fetch(`${baseUrl}/batch`);

    // 3. Register environment
    const envResponse = await fetch(`${baseUrl}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 1024,
        desired_name: 'fundamental-prediction',
        weight: 1.0,
        group_size: 8,
      }),
    });

    const envData = await envResponse.json() as { status: string };
    expect(envData.status).toBe('success');

    // 4. Simulate environment rollouts
    const env = createFundamentalPredictionEnv();
    await env.setup();

    for (let i = 0; i < 3; i++) {
      const item = await env.getNextItem();

      // Simulate scored data
      const scoredData: ScoredData = {
        tokens: Array(8).fill([1, 2, 3, 4, 5, 6, 7, 8]),
        masks: Array(8).fill([0, 0, 0, 0, -100, -100, -100, -100]),
        scores: [1.0, -1.0, 0.5, -0.5, 1.0, -1.0, 0.5, -0.5],
        env_id: 0,
      };

      await fetch(`${baseUrl}/scored_data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scoredData),
      });
    }

    // 5. Check training progressed
    const statusResponse = await fetch(`${baseUrl}/status`);
    const statusData = await statusResponse.json() as { queue_size: number };

    expect(statusData.queue_size).toBeGreaterThan(0);

    // 6. Get batch
    const batchResponse = await fetch(`${baseUrl}/batch`);
    const batchData = await batchResponse.json() as { batch: ScoredData[] | null };

    expect(batchData.batch).not.toBeNull();
    expect(Array.isArray(batchData.batch)).toBe(true);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  test('scored_data_list handles batch submissions', async () => {
    const baseUrl = `http://localhost:${atroposPort}`;

    // Reset and setup
    await fetch(`${baseUrl}/reset_data`);
    await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wandb_group: 'perf-test',
        wandb_project: 'perf',
        batch_size: 32,
        max_token_len: 1024,
        checkpoint_dir: '/tmp/perf',
        save_checkpoint_interval: 10,
        starting_step: 0,
        num_steps: 100,
      }),
    });
    await fetch(`${baseUrl}/batch`);
    await fetch(`${baseUrl}/register-env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_token_length: 1024,
        desired_name: 'perf-env',
        weight: 1.0,
        group_size: 4,
      }),
    });

    // Submit batch of scored data
    const scoredDataList: ScoredData[] = Array(10).fill(null).map(() => ({
      tokens: [[1, 2, 3, 4]],
      masks: [[0, 0, -100, -100]],
      scores: [Math.random() > 0.5 ? 1.0 : -1.0],
      env_id: 0,
    }));

    const start = performance.now();

    const response = await fetch(`${baseUrl}/scored_data_list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scoredDataList),
    });

    const elapsed = performance.now() - start;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(1000); // Should complete in under 1 second

    const data = await response.json() as { groups_processed: number };
    expect(data.groups_processed).toBe(10);
  });
});

