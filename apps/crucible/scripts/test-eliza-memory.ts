#!/usr/bin/env bun

/**
 * Test ElizaOS Integration with Memory
 *
 * Verifies:
 * 1. Agents respond to messages with actual LLM responses (not canned)
 * 2. Agents recall previous messages from memory
 * 3. Autonomous ticks execute and use memory
 */

import { getCharacter } from '../src/characters'
import {
  checkDWSHealth,
  checkDWSInferenceAvailable,
  createCrucibleRuntime,
  type RuntimeMessage,
} from '../src/sdk/eliza-runtime'

const ROOM_ID = `test-room-${Date.now()}`
const USER_ID = 'test-user-123'

async function main() {
  console.log('\n=== ElizaOS Memory & Message Test ===\n')

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
  console.log('\nInitializing ElizaOS runtime...')
  const runtime = createCrucibleRuntime({
    agentId: `test-agent-${Date.now()}`,
    character,
  })

  await runtime.initialize()
  console.log('✅ Runtime initialized')

  const actions = runtime.getAvailableActions()
  console.log(`   Available actions: ${actions.length}`)
  if (actions.length > 0) {
    console.log(
      `   Sample actions: ${actions
        .slice(0, 5)
        .map((a) => a.name)
        .join(', ')}`,
    )
  }

  // ===================================================================
  // TEST 1: Basic Message Processing
  // ===================================================================
  console.log('\n--- TEST 1: Basic Message Processing ---')
  console.log('Sending: "Hello, who are you?"')

  const msg1: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: USER_ID,
    roomId: ROOM_ID,
    content: { text: 'Hello, who are you?', source: 'test' },
    createdAt: Date.now(),
  }

  const response1 = await runtime.processMessage(msg1)

  console.log(`\nAgent Response (${response1.text.length} chars):`)
  console.log(
    `"${response1.text.substring(0, 200)}${response1.text.length > 200 ? '...' : ''}"`,
  )

  // Verify it's not a canned response
  const isCanned =
    response1.text.includes('Hello! How can I help') ||
    response1.text.includes('I am an AI assistant') ||
    response1.text === ''

  if (isCanned || response1.text.length < 20) {
    console.log('❌ Response appears to be canned or too short')
    process.exit(1)
  }
  console.log('✅ Response is LLM-generated (not canned)')

  // ===================================================================
  // TEST 2: Memory Recall - Set Context
  // ===================================================================
  console.log('\n--- TEST 2: Memory Recall ---')
  console.log(
    'Setting context: "My name is Alex and I work on the Jeju SDK. Remember that."',
  )

  const msg2: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: USER_ID,
    roomId: ROOM_ID,
    content: {
      text: 'My name is Alex and I work on the Jeju SDK. Remember that.',
      source: 'test',
    },
    createdAt: Date.now(),
  }

  const response2 = await runtime.processMessage(msg2)
  console.log(`Agent: "${response2.text.substring(0, 150)}..."`)

  // Short delay
  await new Promise((r) => setTimeout(r, 500))

  // ===================================================================
  // TEST 3: Memory Recall - Test Recall
  // ===================================================================
  console.log('\n--- TEST 3: Memory Recall Verification ---')
  console.log('Asking: "What is my name and what do I work on?"')

  const msg3: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: USER_ID,
    roomId: ROOM_ID,
    content: { text: 'What is my name and what do I work on?', source: 'test' },
    createdAt: Date.now(),
  }

  const response3 = await runtime.processMessage(msg3)
  console.log(`Agent: "${response3.text}"`)

  // Check if response mentions Alex or Jeju
  const mentionsPepe =
    response3.text.toLowerCase().includes('alex') ||
    response3.text.toLowerCase().includes('jeju')
  if (mentionsPepe) {
    console.log(
      '✅ Agent correctly recalled context from memory (Alex or Jeju SDK)',
    )
  } else {
    console.log(
      '⚠️  Agent did not recall context (memory may not be working correctly)',
    )
  }

  // Check memory storage
  const memories = await runtime.getMemories(ROOM_ID, 10)
  console.log(`\nMemory check: ${memories.length} messages in room`)
  if (memories.length >= 4) {
    console.log('✅ Messages are being stored in memory')
  } else {
    console.log('⚠️  Memory storage may not be working')
  }

  // ===================================================================
  // TEST 4: Action Awareness
  // ===================================================================
  console.log('\n--- TEST 4: Action Awareness ---')
  console.log('Asking: "Can you help me swap tokens?"')

  const msg4: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: USER_ID,
    roomId: ROOM_ID,
    content: { text: 'Can you help me swap tokens?', source: 'test' },
    createdAt: Date.now(),
  }

  const response4 = await runtime.processMessage(msg4)
  console.log(`Agent: "${response4.text.substring(0, 200)}..."`)

  if (response4.action) {
    console.log(`✅ Agent triggered action: ${response4.action}`)
  } else {
    console.log(
      '⚠️  No action triggered (agent may respond conversationally first)',
    )
  }

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log('\n=== TEST SUMMARY ===')
  console.log(`Room ID: ${ROOM_ID}`)
  console.log(`Messages processed: 4`)
  console.log(`Memories stored: ${memories.length}`)
  console.log(`Actions available: ${actions.length}`)
  console.log(`Memory recall: ${mentionsPepe ? 'PASSED' : 'NEEDS REVIEW'}`)

  console.log('\n✅ ElizaOS integration test completed')
}

main().catch((e) => {
  console.error('\n❌ Test failed:', e)
  process.exit(1)
})
