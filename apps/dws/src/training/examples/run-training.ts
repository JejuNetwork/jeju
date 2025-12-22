#!/usr/bin/env bun

/**
 * Distributed Training Example
 *
 * Demonstrates end-to-end distributed training with:
 * - Atropos API server for rollout coordination
 * - GRPO trainer for policy optimization
 * - Fundamental prediction environment
 * - Optional Psyche integration for decentralized training
 *
 * Requirements:
 * - NVIDIA GPU with 16GB+ VRAM (5090 recommended)
 * - vLLM installed
 *
 * Usage:
 *   bun run src/training/examples/run-training.ts
 *
 * Environment variables:
 *   MODEL_NAME - Model to train (default: microsoft/phi-2, no auth required)
 *   TRAINING_STEPS - Number of training steps (default: 10)
 *   USE_WANDB - Enable Weights & Biases logging (default: false)
 *   WANDB_PROJECT - W&B project name
 */

import { spawn } from 'bun'
import { createAtroposServer } from '../atropos-server'
import { createCrossChainBridge } from '../cross-chain-bridge'
import { createFundamentalPredictionEnv } from '../environments/fundamental-prediction'
import {
  createDistributedGRPOTrainer,
  createGRPOTrainer,
  DistributedGRPOTrainer,
} from '../grpo-trainer'
import { createPsycheClient } from '../psyche-client'

// ============================================================================
// Configuration
// ============================================================================

const config = {
  // Use microsoft/phi-2 - no auth required, works well for RL training demos
  modelName: process.env.MODEL_NAME ?? 'microsoft/phi-2',
  trainingSteps: parseInt(process.env.TRAINING_STEPS ?? '10', 10),
  batchSize: parseInt(process.env.BATCH_SIZE ?? '2', 10),
  groupSize: parseInt(process.env.GROUP_SIZE ?? '8', 10),
  maxTokenLength: parseInt(process.env.MAX_TOKEN_LENGTH ?? '2048', 10),
  vllmPort: parseInt(process.env.VLLM_PORT ?? '9001', 10),
  atroposPort: parseInt(process.env.ATROPOS_PORT ?? '8000', 10),
  useWandb: process.env.USE_WANDB === 'true',
  wandbProject: process.env.WANDB_PROJECT,
  usePsyche: process.env.USE_PSYCHE === 'true',
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  evmRpcUrl: process.env.EVM_RPC_URL ?? 'http://localhost:6545',
  savePath: process.env.SAVE_PATH ?? './training-checkpoints',
}

console.log('='.repeat(60))
console.log('Jeju DWS Distributed Training')
console.log('='.repeat(60))
console.log(`Model: ${config.modelName}`)
console.log(`Training Steps: ${config.trainingSteps}`)
console.log(`Batch Size: ${config.batchSize}`)
console.log(`Group Size: ${config.groupSize}`)
console.log(`Max Token Length: ${config.maxTokenLength}`)
console.log(`Psyche Integration: ${config.usePsyche ? 'Enabled' : 'Disabled'}`)
console.log('='.repeat(60))

// ============================================================================
// Main Training Loop
// ============================================================================

async function main() {
  let atroposServer: { stop: () => void } | null = null
  let vllmProcess: ReturnType<typeof spawn> | null = null

  try {
    // Step 1: Start Atropos server
    console.log('\n[1/5] Starting Atropos API server...')
    const atroposApp = createAtroposServer()
    atroposServer = Bun.serve({
      port: config.atroposPort,
      fetch: atroposApp.fetch,
    })
    console.log(`   Atropos server running on port ${config.atroposPort}`)

    // Step 2: Start vLLM server
    console.log('\n[2/5] Starting vLLM inference server...')
    vllmProcess = spawn(
      [
        'python',
        '-m',
        'vllm.entrypoints.openai.api_server',
        '--model',
        config.modelName,
        '--port',
        String(config.vllmPort),
        '--dtype',
        'auto',
        '--gpu-memory-utilization',
        '0.45',
        '--disable-log-requests',
      ],
      {
        stdout: 'inherit',
        stderr: 'inherit',
      },
    )

    // Wait for vLLM to be ready
    console.log('   Waiting for vLLM server to be ready...')
    let vllmReady = false
    for (let i = 0; i < 120; i++) {
      try {
        const response = await fetch(
          `http://localhost:${config.vllmPort}/health`,
        )
        if (response.ok) {
          vllmReady = true
          break
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000))
    }

    if (!vllmReady) {
      throw new Error('vLLM server failed to start within 2 minutes')
    }
    console.log(`   vLLM server running on port ${config.vllmPort}`)

    // Step 3: Initialize trainer
    console.log('\n[3/5] Initializing GRPO trainer...')
    const trainer = config.usePsyche
      ? createDistributedGRPOTrainer({
          modelName: config.modelName,
          trainingSteps: config.trainingSteps,
          batchSize: config.batchSize,
          vllmPort: config.vllmPort,
          atroposUrl: `http://localhost:${config.atroposPort}`,
          useWandb: config.useWandb,
          wandbProject: config.wandbProject,
          savePath: config.savePath,
        })
      : createGRPOTrainer({
          modelName: config.modelName,
          trainingSteps: config.trainingSteps,
          batchSize: config.batchSize,
          vllmPort: config.vllmPort,
          atroposUrl: `http://localhost:${config.atroposPort}`,
          useWandb: config.useWandb,
          wandbProject: config.wandbProject,
          savePath: config.savePath,
        })

    // Optional: Set up Psyche integration
    // Dynamic import kept conditional - only loads if Psyche is enabled
    if (config.usePsyche && trainer instanceof DistributedGRPOTrainer) {
      console.log('   Setting up Psyche distributed training...')

      const psycheClient = createPsycheClient({
        solanaRpcUrl: config.solanaRpcUrl,
        evmRpcUrl: config.evmRpcUrl,
      })

      const bridge = createCrossChainBridge({
        evmRpcUrl: config.evmRpcUrl,
        bridgeContractAddress: '0x0000000000000000000000000000000000000001',
        solanaRpcUrl: config.solanaRpcUrl,
      })

      await trainer.setPsycheClient(psycheClient)
      await trainer.setBridge(bridge)

      // Create distributed run
      const runId = `jeju-training-${Date.now()}`
      await trainer.createDistributedRun(runId)
      console.log(`   Created distributed run: ${runId}`)
    }

    // Step 4: Initialize environment
    console.log('\n[4/5] Initializing Fundamental Prediction environment...')
    const env = createFundamentalPredictionEnv(
      {
        tokenizerName: config.modelName,
        groupSize: config.groupSize,
        rolloutServerUrl: `http://localhost:${config.atroposPort}`,
        maxTokenLength: config.maxTokenLength,
        useWandb: config.useWandb,
        wandbName: 'fundamental_prediction',
      },
      [
        {
          modelName: config.modelName,
          baseUrl: `http://localhost:${config.vllmPort}/v1`,
          apiKey: 'x',
          numRequestsForEval: 256,
        },
      ],
    )

    await env.setup()
    console.log('   Environment ready')

    // Step 5: Register with Atropos
    console.log('\n[5/5] Registering with Atropos...')
    await trainer.registerWithAtropos()
    console.log('   Trainer registered')

    // Register environment
    const envResponse = await fetch(
      `http://localhost:${config.atroposPort}/register-env`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_token_length: config.maxTokenLength,
          desired_name: 'fundamental_prediction',
          weight: 1.0,
          group_size: config.groupSize,
        }),
      },
    )

    const envData = (await envResponse.json()) as {
      status: string
      env_id: number
    }
    if (envData.status !== 'success') {
      throw new Error('Failed to register environment')
    }
    console.log(`   Environment registered with ID: ${envData.env_id}`)

    // Training loop
    console.log(`\n${'='.repeat(60)}`)
    console.log('Starting Training Loop')
    console.log('='.repeat(60))

    let step = 0
    while (step < config.trainingSteps) {
      console.log(`\n--- Step ${step + 1}/${config.trainingSteps} ---`)

      // Collect rollouts
      console.log('Collecting rollouts...')
      const item = await env.getNextItem()
      const { scoredData } = await env.collectTrajectories(item)

      if (scoredData) {
        // Submit to Atropos
        await fetch(`http://localhost:${config.atroposPort}/scored_data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...scoredData,
            env_id: envData.env_id,
          }),
        })
        console.log(`   Submitted ${scoredData.tokens.length} trajectories`)
      }

      // Get training metrics
      const metrics = env.getTrainingMetrics()
      console.log(
        `   Direction Accuracy: ${(metrics.directionAccuracy * 100).toFixed(1)}%`,
      )
      console.log(
        `   Magnitude Accuracy: ${(metrics.magnitudeAccuracy * 100).toFixed(1)}%`,
      )

      step++
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log('Training Complete')
    console.log('='.repeat(60))

    // Final evaluation
    console.log('\nRunning final evaluation...')
    const evalResults = await env.evaluate()
    console.log(
      `Final Direction Accuracy: ${(evalResults.directionAccuracy * 100).toFixed(1)}%`,
    )
    console.log(
      `Final Magnitude Accuracy: ${(evalResults.magnitudeAccuracy * 100).toFixed(1)}%`,
    )
    console.log(`Final Combined Score: ${evalResults.combinedScore.toFixed(3)}`)

    console.log(`\nModel checkpoints saved to: ${config.savePath}`)
  } catch (error) {
    console.error('\nTraining failed:', error)
    throw error
  } finally {
    // Cleanup
    console.log('\nCleaning up...')

    if (vllmProcess) {
      vllmProcess.kill()
      await vllmProcess.exited
    }

    if (atroposServer) {
      atroposServer.stop()
    }

    console.log('Done.')
  }
}

// Run
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
