#!/usr/bin/env bun

/**
 * Test Autonomous Agent Execution
 *
 * Verifies:
 * 1. Autonomous ticks execute with the agent making decisions
 * 2. Agent recalls previous tick results for context
 * 3. Agent can decide to take actions based on context
 */

import { AutonomousTick } from '../src/autonomous/tick'
import type { AutonomousAgentConfig } from '../src/autonomous/types'
import { getCharacter } from '../src/characters'
import {
  checkDWSHealth,
  checkDWSInferenceAvailable,
  createCrucibleRuntime,
} from '../src/sdk/eliza-runtime'

async function main() {
  console.log('\n=== Autonomous Agent Execution Test ===\n')

  // Check DWS
  console.log('Checking DWS...')
  const dwsOk = await checkDWSHealth()
  if (!dwsOk) {
    console.error(
      'DWS not available. Start DWS first: cd apps/dws && bun run dev',
    )
    process.exit(1)
  }
  console.log('✅ DWS is healthy')

  const inference = await checkDWSInferenceAvailable()
  if (!inference.available) {
    console.error(
      'No inference nodes. Start inference: cd apps/dws && bun run inference',
    )
    process.exit(1)
  }
  console.log(`✅ ${inference.nodes} inference node(s) available`)

  // Load a character
  const character = getCharacter('devrel')
  if (!character) {
    console.error('Character not found: devrel')
    process.exit(1)
  }
  console.log(`\nUsing character: ${character.name}`)

  // Create runtime
  const agentId = `autonomous-test-${Date.now()}`
  console.log('\nInitializing runtime...')
  const runtime = createCrucibleRuntime({
    agentId,
    character,
  })
  await runtime.initialize()
  console.log('✅ Runtime initialized')

  // Create autonomous config
  const config: AutonomousAgentConfig = {
    agentId,
    character,
    autonomousEnabled: true,
    tickIntervalMs: 60000,
    maxActionsPerTick: 3,
    capabilities: {
      compute: true,
      storage: true,
      defi: true,
      governance: false,
      a2a: true,
      crossChain: false,
    },
    goals: [
      {
        id: 'goal-1',
        description: 'Monitor the network and report status',
        status: 'active',
        priority: 'high',
      },
    ],
  }

  // ===================================================================
  // TICK 1: First autonomous tick
  // ===================================================================
  console.log('\n--- TICK 1: First Autonomous Tick ---')
  console.log('Goal: Monitor the network and report status')

  const tick1 = new AutonomousTick(config, runtime)
  const result1 = await tick1.execute()

  console.log(`\nTick 1 Result:`)
  console.log(`  Success: ${result1.success}`)
  console.log(`  Iterations: ${result1.iterations}`)
  console.log(`  Duration: ${result1.duration}ms`)
  console.log(`  Actions executed: ${result1.actionsExecuted.length}`)

  if (result1.actionsExecuted.length > 0) {
    console.log(`  Actions taken:`)
    for (const action of result1.actionsExecuted) {
      console.log(
        `    - ${action.name}: ${action.success ? 'SUCCESS' : 'FAILED'}`,
      )
    }
  } else {
    console.log('  Agent decided no actions were needed')
  }

  // Short delay between ticks
  await new Promise((r) => setTimeout(r, 1000))

  // ===================================================================
  // TICK 2: Second tick - should remember previous context
  // ===================================================================
  console.log('\n--- TICK 2: Second Autonomous Tick (Memory Check) ---')
  console.log('Verifying agent recalls previous tick results...')

  // Add a goal that requires memory of the previous tick
  config.goals = [
    {
      id: 'goal-2',
      description:
        'Check if any agents are available for collaboration based on previous network scan',
      status: 'active',
      priority: 'medium',
    },
  ]

  const tick2 = new AutonomousTick(config, runtime)
  const result2 = await tick2.execute()

  console.log(`\nTick 2 Result:`)
  console.log(`  Success: ${result2.success}`)
  console.log(`  Iterations: ${result2.iterations}`)
  console.log(`  Duration: ${result2.duration}ms`)
  console.log(`  Actions executed: ${result2.actionsExecuted.length}`)

  if (result2.actionsExecuted.length > 0) {
    console.log(`  Actions taken:`)
    for (const action of result2.actionsExecuted) {
      console.log(
        `    - ${action.name}: ${action.success ? 'SUCCESS' : 'FAILED'}`,
      )
    }
  }

  // ===================================================================
  // Check memory between ticks
  // ===================================================================
  console.log('\n--- Memory Verification ---')
  const memories = runtime.getMemories('autonomous-tick', 20)
  console.log(`Messages in autonomous room: ${memories.length}`)

  if (memories.length >= 2) {
    console.log('✅ Memory is being preserved between ticks')
    console.log('\nLast 3 messages:')
    for (const mem of memories.slice(-3)) {
      console.log(`  [${mem.role}] ${mem.content.substring(0, 80)}...`)
    }
  } else {
    console.log('⚠️  Memory may not be persisting correctly')
  }

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log('\n=== TEST SUMMARY ===')
  console.log(`Agent: ${character.name} (${agentId})`)
  console.log(
    `Tick 1: ${result1.success ? 'SUCCESS' : 'NEEDS REVIEW'} (${result1.actionsExecuted.length} actions)`,
  )
  console.log(
    `Tick 2: ${result2.success ? 'SUCCESS' : 'NEEDS REVIEW'} (${result2.actionsExecuted.length} actions)`,
  )
  console.log(
    `Memory persistence: ${memories.length >= 2 ? 'WORKING' : 'NEEDS REVIEW'}`,
  )
  console.log(
    `Total autonomous iterations: ${result1.iterations + result2.iterations}`,
  )

  console.log('\n✅ Autonomous agent test completed')
}

main().catch((e) => {
  console.error('\n❌ Test failed:', e)
  process.exit(1)
})
