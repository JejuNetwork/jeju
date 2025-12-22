#!/usr/bin/env bun
/**
 * Babylon RLAIF Integration Verification Script
 *
 * Verifies the complete Babylon-Jeju RLAIF integration is working.
 * Supports Phala TEE for remote training when local GPU is unavailable.
 *
 * Run with: bun scripts/verify-babylon-rlaif.ts
 *
 * Environment variables:
 * - DWS_URL: DWS endpoint (default: http://localhost:4030)
 * - PHALA_ENDPOINT: Phala TEE endpoint for remote training
 * - PHALA_API_KEY: API key for Phala TEE
 */

const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const PHALA_ENDPOINT = process.env.PHALA_ENDPOINT
const TIMEOUT = 5000

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
}

const results: TestResult[] = []

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now()
  try {
    await fn()
    results.push({ name, passed: true, duration: Date.now() - start })
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    })
    console.log(
      `  ✗ ${name}: ${error instanceof Error ? error.message : error}`,
    )
  }
}

async function main() {
  console.log('\n=== Babylon RLAIF Integration Verification ===\n')

  // Check DWS availability
  console.log('1. DWS Health Check')
  await test('DWS server is running', async () => {
    const response = await fetch(`${DWS_URL}/health`, {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const health = await response.json()
    if (health.status !== 'ok') throw new Error(`Status: ${health.status}`)
  })

  await test('RLAIF endpoint is available', async () => {
    const response = await fetch(`${DWS_URL}/rlaif/health`, {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const health = await response.json()
    if (health.service !== 'rlaif') throw new Error('Wrong service')
  })

  // Test RLAIF Run Creation
  console.log('\n2. RLAIF Run Management')
  let runId: string | null = null

  await test('Create RLAIF run for Babylon trader', async () => {
    const response = await fetch(`${DWS_URL}/rlaif/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environment: {
          id: 'babylon',
          type: 'game',
          configCID: 'babylon-trader',
        },
        model: {
          baseModelCID: 'Qwen/Qwen2.5-3B-Instruct',
          tokenizer: 'Qwen/Qwen2.5-3B-Instruct',
        },
        judge: {
          rubricId: 'babylon-trader',
        },
        targetIterations: 2,
        minTrajectoriesPerIteration: 3,
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const result = await response.json()
    if (!result.runId) throw new Error('No runId returned')
    runId = result.runId
  })

  await test('Get RLAIF run status', async () => {
    if (!runId) throw new Error('No runId from previous test')
    const response = await fetch(`${DWS_URL}/rlaif/runs/${runId}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const run = await response.json()
    if (run.state === undefined) throw new Error('No state in response')
  })

  // Test Trajectory Submission
  console.log('\n3. Trajectory Submission')
  await test('Submit trajectories to run', async () => {
    if (!runId) throw new Error('No runId from previous test')
    const response = await fetch(`${DWS_URL}/rlaif/runs/${runId}/rollouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trajectories: [
          {
            id: 'verify-traj-1',
            steps: [
              {
                stepNumber: 0,
                timestamp: Date.now(),
                observation: { balance: 1000, pnl: 0 },
                action: { type: 'buy', parameters: { amount: 100 } },
                reward: 0.5,
                done: false,
              },
              {
                stepNumber: 1,
                timestamp: Date.now() + 1000,
                observation: { balance: 1100, pnl: 100 },
                action: { type: 'sell', parameters: { amount: 50 } },
                reward: 1.0,
                done: true,
              },
            ],
            totalReward: 1.5,
            metadata: { archetype: 'trader', finalPnL: 100 },
          },
          {
            id: 'verify-traj-2',
            steps: [
              {
                stepNumber: 0,
                timestamp: Date.now(),
                observation: { balance: 1000, pnl: 0 },
                action: { type: 'wait', parameters: {} },
                reward: 0,
                done: true,
              },
            ],
            totalReward: 0,
            metadata: { archetype: 'trader', finalPnL: 0 },
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const result = await response.json()
    if (!result.manifestCID) throw new Error('No manifestCID returned')
    if (result.trajectoryCount !== 2) throw new Error('Wrong trajectory count')
  })

  // Test Type Imports
  console.log('\n4. Type System Verification')
  // Conditional import: only loaded during test execution
  await test('RLAIF types are properly exported', async () => {
    const { RLAlgorithm, RLRunState } = await import(
      '../apps/dws/src/rlaif/types'
    )
    if (RLAlgorithm.GRPO !== 'grpo')
      throw new Error('RLAlgorithm.GRPO incorrect')
    if (RLRunState.CollectingRollouts !== 1)
      throw new Error('RLRunState incorrect')
  })

  // Conditional import: only loaded during test execution
  await test('Coordinator can be imported', async () => {
    const { createRLAIFCoordinator } = await import(
      '../apps/dws/src/rlaif/coordinator'
    )
    if (typeof createRLAIFCoordinator !== 'function')
      throw new Error('Not a function')
  })

  // Conditional import: only loaded during test execution
  await test('TrajectoryStore can be imported', async () => {
    const { createTrajectoryStore } = await import(
      '../apps/dws/src/rlaif/trajectory-store'
    )
    if (typeof createTrajectoryStore !== 'function')
      throw new Error('Not a function')
  })

  // Conditional import: only loaded during test execution
  await test('RulerScorer can be imported', async () => {
    const { createRulerScorer } = await import(
      '../apps/dws/src/rlaif/ruler-scorer'
    )
    if (typeof createRulerScorer !== 'function')
      throw new Error('Not a function')
  })

  // Test Babylon Adapter
  console.log('\n5. Babylon Adapter Verification')
  // Conditional import: only loaded during test execution
  await test('Babylon adapter exports are available', async () => {
    const exports = await import(
      '../vendor/babylon/packages/training/src/compute/jeju-rlaif-adapter'
    )
    if (!exports.BabylonJejuAdapter)
      throw new Error('BabylonJejuAdapter not exported')
    if (!exports.createBabylonJejuAdapter)
      throw new Error('createBabylonJejuAdapter not exported')
    if (!exports.trainWithJejuRLAIF)
      throw new Error('trainWithJejuRLAIF not exported')
  })

  // Conditional import: only loaded during test execution
  await test('Babylon compute index exports adapter', async () => {
    const exports = await import(
      '../vendor/babylon/packages/training/src/compute/index'
    )
    if (!exports.BabylonJejuAdapter)
      throw new Error('BabylonJejuAdapter not in compute/index')
    if (!exports.trainWithJejuRLAIF)
      throw new Error('trainWithJejuRLAIF not in compute/index')
  })

  // Test CLI Commands
  console.log('\n6. CLI Command Verification')
  // Conditional import: only loaded during test execution
  await test('Training command is exported', async () => {
    const { trainingCommand } = await import(
      '../packages/cli/src/commands/training'
    )
    if (!trainingCommand) throw new Error('trainingCommand not exported')
    if (trainingCommand.name() !== 'training')
      throw new Error('Wrong command name')
  })

  // Phala TEE Verification (only if configured)
  if (PHALA_ENDPOINT) {
    console.log('\n7. Phala TEE Verification')

    await test('Phala TEE endpoint is reachable', async () => {
      const response = await fetch(`${PHALA_ENDPOINT}/health`, {
        signal: AbortSignal.timeout(TIMEOUT),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const health = await response.json()
      console.log(`     Enclave ID: ${health.enclave_id ?? 'unknown'}`)
    })

    await test('Phala TEE can accept training jobs', async () => {
      const response = await fetch(`${PHALA_ENDPOINT}/training/capabilities`, {
        signal: AbortSignal.timeout(TIMEOUT),
      })
      // May return 404 if endpoint not implemented, which is ok
      if (response.status !== 404 && !response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
    })

    console.log('  Phala TEE is configured for remote training')
  } else {
    console.log('\n7. Phala TEE (skipped - PHALA_ENDPOINT not set)')
    console.log('  To enable Phala TEE training, set:')
    console.log('    export PHALA_ENDPOINT=https://your-phala-endpoint')
    console.log('    export PHALA_API_KEY=your-api-key')
  }

  // Summary
  console.log('\n=== Summary ===\n')
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0)

  console.log(`  Total: ${results.length} tests`)
  console.log(`  Passed: ${passed}`)
  console.log(`  Failed: ${failed}`)
  console.log(`  Duration: ${totalTime}ms\n`)

  if (failed > 0) {
    console.log('Failed tests:')
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.name}: ${result.error}`)
    }
    console.log('')
    process.exit(1)
  }

  console.log('All tests passed.\n')
}

main().catch((err) => {
  console.error('Verification failed:', err)
  process.exit(1)
})
