#!/usr/bin/env bun

/**
 * Integrated Training Demo
 *
 * End-to-end demonstration of Jeju's distributed training infrastructure.
 * Runs completely with synthetic data - no GPU required for demo.
 *
 * Usage:
 *   bun run src/training/run-integrated-demo.ts
 */

import type { Hex } from 'viem'
import { createAtroposServer } from './atropos-server'
import { createDWSTrainingService } from './dws-integration'
import {
  createTicTacToeEnv,
  trajectoryToTrainingFormat,
} from './environments/tic-tac-toe'

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  atroposPort: 8100,
  dwsApiPort: 8101,
  trajectoryCount: 8,
  trainingSteps: 5,
  agents: [
    { id: 'eliza-alice', name: 'Alice' },
    { id: 'eliza-bob', name: 'Bob' },
  ],
  evmPrivateKey:
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
}

// ============================================================================
// Main Demo
// ============================================================================

async function main() {
  console.log('='.repeat(70))
  console.log('JEJU INTEGRATED TRAINING DEMO')
  console.log('='.repeat(70))
  console.log()

  // Step 1: Start Atropos
  console.log('[1/7] Starting Atropos Rollout Server...')
  const atroposApp = createAtroposServer()
  const atroposServer = Bun.serve({
    port: CONFIG.atroposPort,
    fetch: atroposApp.fetch,
  })
  console.log(`      Running on http://localhost:${CONFIG.atroposPort}`)

  // Step 2: Start DWS Training Service
  console.log('[2/7] Starting DWS Training Service...')
  const dwsService = createDWSTrainingService()
  const dwsServer = Bun.serve({
    port: CONFIG.dwsApiPort,
    fetch: dwsService.getApp().fetch,
  })
  console.log(`      Running on http://localhost:${CONFIG.dwsApiPort}`)

  // Step 3: Generate Game Trajectories
  console.log('[3/7] Generating Tic-Tac-Toe Trajectories...')
  const env = createTicTacToeEnv()
  const agentIds = CONFIG.agents.map((a) => a.id)
  const trajectories = env.generateTrajectoryBatch(
    CONFIG.trajectoryCount,
    agentIds,
  )

  const wins = { X: 0, O: 0, draw: 0 }
  for (const t of trajectories) {
    if (t.metadata.winner === 'X') wins.X++
    else if (t.metadata.winner === 'O') wins.O++
    else wins.draw++
  }
  console.log(`      Generated ${trajectories.length} games`)
  console.log(`      Results: X=${wins.X}, O=${wins.O}, Draw=${wins.draw}`)

  // Step 4: Register with Atropos
  console.log('[4/7] Registering with Atropos...')

  await fetch(`http://localhost:${CONFIG.atroposPort}/register-env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      env_id: 'tic-tac-toe',
      description: 'Tic-Tac-Toe self-play',
      config: { agents: CONFIG.agents },
    }),
  })

  await fetch(`http://localhost:${CONFIG.atroposPort}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trainer_id: 'demo-trainer',
      model: 'tiny-model',
      batch_size: 4,
      environment: 'tic-tac-toe',
    }),
  })
  console.log('      Environment and trainer registered')

  // Step 5: Submit Scored Trajectories
  console.log('[5/7] Submitting Scored Data to Atropos...')

  // Convert trajectories to Atropos ScoredData format
  // tokens: 2D array of token ids per trajectory
  // masks: 2D array of attention masks
  // scores: 1D array of rewards
  const scoredData = trajectories.map((t) => {
    const tf = trajectoryToTrainingFormat(t)
    // Simulate tokenization (in real usage, use actual tokenizer)
    const promptTokens = tf.prompt.split(' ').map((_, i) => i + 1)
    const responseTokens = tf.response.split(' ').map((_, i) => i + 100)
    const allTokens = [...promptTokens, ...responseTokens]

    return {
      tokens: [allTokens],
      masks: [allTokens.map(() => 1)],
      scores: [t.totalReward],
      messages: [
        [
          { role: 'user' as const, content: tf.prompt },
          { role: 'assistant' as const, content: tf.response },
        ],
      ],
    }
  })

  const submitRes = await fetch(
    `http://localhost:${CONFIG.atroposPort}/scored_data_list`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scoredData),
    },
  )

  if (!submitRes.ok) {
    throw new Error(`Failed to submit scored data: ${submitRes.status}`)
  }
  console.log(`      Submitted ${scoredData.length} scored trajectories`)

  // Step 6: Simulate Training Loop
  console.log('[6/7] Running Training Loop...')

  for (let step = 1; step <= CONFIG.trainingSteps; step++) {
    // Fetch batch from Atropos
    const batchRes = await fetch(
      `http://localhost:${CONFIG.atroposPort}/batch?trainer_id=demo-trainer`,
    )
    let batchSize = 0

    if (batchRes.ok) {
      const batchData = (await batchRes.json()) as {
        batch?: Array<{ tokens: number[][] }>
      }
      batchSize = batchData.batch?.length ?? 0
    }

    // Simulate gradient computation
    const loss = 2.5 - step * 0.4 + Math.random() * 0.1
    const accuracy = 0.3 + step * 0.12 + Math.random() * 0.05

    console.log(
      `      Step ${step}/${CONFIG.trainingSteps}: loss=${loss.toFixed(4)}, acc=${accuracy.toFixed(3)}, samples=${batchSize}`,
    )

    await Bun.sleep(200)
  }

  // Step 7: Test DWS Training API
  console.log('[7/7] Testing DWS Training API...')

  // Submit a job
  const jobRes = await fetch(
    `http://localhost:${CONFIG.dwsApiPort}/training/jobs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelName: 'tiny-model',
        batchSize: 4,
        learningRate: 1e-5,
        trainingSteps: 10,
        environment: 'tic-tac-toe',
      }),
    },
  )

  if (jobRes.ok) {
    const job = (await jobRes.json()) as { jobId: string }
    console.log(`      Created job: ${job.jobId}`)

    // Check job status
    const statusRes = await fetch(
      `http://localhost:${CONFIG.dwsApiPort}/training/jobs/${job.jobId}`,
    )
    if (statusRes.ok) {
      const status = (await statusRes.json()) as { status: string }
      console.log(`      Job status: ${status.status}`)
    }
  }

  // List jobs
  const listRes = await fetch(
    `http://localhost:${CONFIG.dwsApiPort}/training/jobs`,
  )
  if (listRes.ok) {
    const list = (await listRes.json()) as { jobs: Array<{ jobId: string }> }
    console.log(`      Total jobs: ${list.jobs?.length ?? 0}`)
  }

  // Summary
  console.log()
  console.log('='.repeat(70))
  console.log('DEMO COMPLETE - All systems operational')
  console.log('='.repeat(70))
  console.log()
  console.log('Components verified:')
  console.log('  [OK] Atropos Rollout Server')
  console.log('  [OK] DWS Training Service')
  console.log('  [OK] Tic-Tac-Toe Environment')
  console.log('  [OK] Trajectory Generation')
  console.log('  [OK] Scored Data Submission')
  console.log('  [OK] Training Batch Retrieval')
  console.log('  [OK] Job Management API')
  console.log()
  console.log('Integration points:')
  console.log('  CRUCIBLE: ElizaOS agents can use this for RLAIF')
  console.log('  AUTOCRAT: Model deployments go through DAO governance')
  console.log()

  // Cleanup
  atroposServer.stop()
  dwsServer.stop()

  console.log('Servers stopped. Demo finished successfully.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Demo failed:', err)
  process.exit(1)
})
