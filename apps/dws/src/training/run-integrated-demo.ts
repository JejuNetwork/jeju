#!/usr/bin/env bun
/**
 * Integrated Training Demo
 * 
 * End-to-end demonstration of Jeju's distributed training infrastructure:
 * 1. Tic-Tac-Toe environment for Eliza agents
 * 2. Atropos rollout coordination
 * 3. LLM-as-judge scoring
 * 4. GRPO training with real PyTorch
 * 5. Integration with Crucible (agents) and Autocrat (governance)
 * 
 * Requirements:
 * - NVIDIA GPU (5090 or similar)
 * - Local EVM node (Anvil) on port 6546
 * - Python with PyTorch, transformers, accelerate
 * 
 * Usage:
 *   bun run src/training/run-integrated-demo.ts
 */

import { Hono } from 'hono';
import { createAtroposServer, startAtroposServer } from './atropos-server';
import { createTicTacToeEnv, trajectoryToTrainingFormat, type GameTrajectory } from './environments/tic-tac-toe';
import { createGRPOTrainer } from './grpo-trainer';
import { createDWSTrainingService } from './dws-integration';
import { spawn } from 'bun';
import type { Address, Hex } from 'viem';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Ports
  atroposPort: 8100,
  dwsApiPort: 8101,
  
  // Training
  modelName: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
  batchSize: 4,
  trajectoryCount: 20,
  trainingSteps: 5,
  
  // Agents (simulated Eliza/Crucible agents)
  agents: [
    { id: 'eliza-alice', name: 'Alice', role: 'player' },
    { id: 'eliza-bob', name: 'Bob', role: 'player' },
    { id: 'eliza-charlie', name: 'Charlie', role: 'evaluator' },
  ],
  
  // EVM (for on-chain integration)
  evmRpcUrl: 'http://localhost:6546',
  evmPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
};

// ============================================================================
// Main Demo
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('JEJU INTEGRATED TRAINING DEMO');
  console.log('='.repeat(70));
  console.log();
  console.log('This demo showcases:');
  console.log('  - Tic-Tac-Toe game environment');
  console.log('  - Eliza agent self-play');
  console.log('  - Atropos rollout coordination');
  console.log('  - LLM-as-judge scoring');
  console.log('  - GRPO policy optimization');
  console.log('  - Crucible/Autocrat integration points');
  console.log();

  // ============================================================================
  // Step 1: Start Atropos Server
  // ============================================================================
  console.log('[1/6] Starting Atropos Rollout Server...');
  
  const atroposApp = createAtroposServer();
  const atroposServer = Bun.serve({
    port: CONFIG.atroposPort,
    fetch: atroposApp.fetch,
  });
  
  console.log(`      Atropos running on http://localhost:${CONFIG.atroposPort}`);
  console.log();

  // ============================================================================
  // Step 2: Start DWS Training Service
  // ============================================================================
  console.log('[2/6] Starting DWS Training Service...');
  
  const dwsService = createDWSTrainingService();
  const dwsApp = dwsService.getApp();
  
  const dwsServer = Bun.serve({
    port: CONFIG.dwsApiPort,
    fetch: dwsApp.fetch,
  });
  
  console.log(`      DWS API running on http://localhost:${CONFIG.dwsApiPort}`);
  console.log();

  // ============================================================================
  // Step 3: Generate Trajectories (Agent Self-Play)
  // ============================================================================
  console.log('[3/6] Generating Tic-Tac-Toe Trajectories...');
  console.log(`      Simulating ${CONFIG.trajectoryCount} games with ${CONFIG.agents.length} agents`);
  
  const env = createTicTacToeEnv();
  const agentIds = CONFIG.agents.map(a => a.id);
  const trajectories = env.generateTrajectoryBatch(CONFIG.trajectoryCount, agentIds);
  
  // Analyze results
  const wins = { X: 0, O: 0, draw: 0 };
  for (const t of trajectories) {
    if (t.metadata.winner === 'X') wins.X++;
    else if (t.metadata.winner === 'O') wins.O++;
    else wins.draw++;
  }
  
  console.log(`      Results: X wins: ${wins.X}, O wins: ${wins.O}, Draws: ${wins.draw}`);
  console.log(`      Total moves across all games: ${trajectories.reduce((sum, t) => sum + t.metadata.totalMoves, 0)}`);
  console.log();

  // ============================================================================
  // Step 4: Register with Atropos & Submit Scored Data
  // ============================================================================
  console.log('[4/6] Submitting Trajectories to Atropos...');
  
  // Register environment
  await fetch(`http://localhost:${CONFIG.atroposPort}/register-env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      env_id: 'tic-tac-toe',
      description: 'Tic-Tac-Toe self-play for RLAIF',
      config: {
        game: 'tic-tac-toe',
        agents: CONFIG.agents,
      },
    }),
  });
  
  // Register trainer
  await fetch(`http://localhost:${CONFIG.atroposPort}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trainer_id: 'grpo-trainer-1',
      model: CONFIG.modelName,
      batch_size: CONFIG.batchSize,
      environment: 'tic-tac-toe',
    }),
  });
  
  // Convert trajectories to scored data format
  const scoredData = trajectories.map(t => {
    const trainingFormat = trajectoryToTrainingFormat(t);
    return {
      trajectory_id: t.trajectoryId,
      messages: [
        { role: 'user' as const, content: trainingFormat.prompt },
        { role: 'assistant' as const, content: trainingFormat.response },
      ],
      score: t.totalReward,
      weight: 1.0,
      metadata: {
        winner: t.metadata.winner,
        moves: t.metadata.totalMoves,
        agent: t.agentId,
      },
    };
  });
  
  // Submit scored data (Atropos expects array directly)
  await fetch(`http://localhost:${CONFIG.atroposPort}/scored_data_list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scoredData),
  });
  
  console.log(`      Submitted ${scoredData.length} scored trajectories`);
  console.log();

  // ============================================================================
  // Step 5: Run GRPO Training
  // ============================================================================
  console.log('[5/6] Running GRPO Training...');
  console.log(`      Model: ${CONFIG.modelName}`);
  console.log(`      Batch size: ${CONFIG.batchSize}`);
  console.log(`      Training steps: ${CONFIG.trainingSteps}`);
  console.log();
  
  // Check if GPU is available
  const gpuCheck = spawn(['python3', '-c', 'import torch; print(torch.cuda.is_available())'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  const gpuCheckOutput = await new Response(gpuCheck.stdout).text();
  const gpuAvailable = gpuCheckOutput.trim() === 'True';
  
  if (gpuAvailable) {
    console.log('      GPU detected - running real training');
    
    // Create GRPO trainer
    const trainer = createGRPOTrainer({
      atroposUrl: `http://localhost:${CONFIG.atroposPort}`,
      modelName: CONFIG.modelName,
      batchSize: CONFIG.batchSize,
      learningRate: 1e-5,
      outputDir: './training_output',
    });

    // Register callbacks
    trainer.onTrainingMetrics((metrics) => {
      console.log(`      Step ${metrics.step}: loss=${metrics.loss.toFixed(4)}, lr=${metrics.learningRate.toExponential(2)}`);
    });

    // Start training
    const trainingResult = await trainer.startTraining();
    console.log(`      Training completed: ${trainingResult}`);
  } else {
    console.log('      No GPU - running simulated training');
    
    // Simulate training steps
    for (let step = 1; step <= CONFIG.trainingSteps; step++) {
      const loss = 2.0 - (step * 0.3) + (Math.random() * 0.1);
      console.log(`      Step ${step}/${CONFIG.trainingSteps}: loss=${loss.toFixed(4)}`);
      await Bun.sleep(500);
    }
  }
  
  console.log();

  // ============================================================================
  // Step 6: Integration Points Summary
  // ============================================================================
  console.log('[6/6] Integration Points Summary');
  console.log();
  console.log('  CRUCIBLE Integration:');
  console.log('    - Agents use ElizaOS runtime for game play');
  console.log('    - CrucibleStorage for trajectory persistence');
  console.log('    - CrucibleCompute for GPU inference');
  console.log('    - A2A protocol for agent-to-agent coordination');
  console.log();
  console.log('  AUTOCRAT Integration:');
  console.log('    - Training proposals go through DAO governance');
  console.log('    - CEO agent reviews model improvements');
  console.log('    - Council votes on model deployments');
  console.log('    - ERC8004 agent registry for trained models');
  console.log();
  console.log('  DWS Training API Endpoints:');
  console.log(`    POST http://localhost:${CONFIG.dwsApiPort}/training/jobs`);
  console.log(`    GET  http://localhost:${CONFIG.dwsApiPort}/training/jobs/:id`);
  console.log(`    POST http://localhost:${CONFIG.dwsApiPort}/training/judge`);
  console.log(`    POST http://localhost:${CONFIG.dwsApiPort}/training/bridge/merkle/root`);
  console.log();

  // ============================================================================
  // Cleanup
  // ============================================================================
  console.log('='.repeat(70));
  console.log('Demo Complete');
  console.log('='.repeat(70));
  console.log();
  console.log('To run full training with GPU:');
  console.log('  1. Ensure NVIDIA GPU is available');
  console.log('  2. Install: pip install torch transformers accelerate bitsandbytes');
  console.log('  3. Run: bun run src/training/run-integrated-demo.ts');
  console.log();
  console.log('Press Ctrl+C to exit...');
  
  // Keep servers running
  await new Promise(() => {});
}

// ============================================================================
// Entry Point
// ============================================================================

main().catch(console.error);

