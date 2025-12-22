/**
 * Test script to verify Crucible runtime works with DWS
 */

import { createCrucibleRuntime, checkDWSHealth, type RuntimeMessage } from '../src/sdk/eliza-runtime';
import { getCharacter } from '../src/characters';

async function main() {
  console.log('=== Testing Crucible Agent Runtime ===');
  
  // Check DWS health first
  console.log('Checking DWS availability...');
  const dwsOk = await checkDWSHealth();
  console.log('DWS available:', dwsOk);
  
  if (!dwsOk) {
    console.error('DWS is not available. Please start DWS first.');
    process.exit(1);
  }
  
  const character = getCharacter('project-manager');
  if (!character) {
    console.error('Character not found');
    process.exit(1);
  }
  
  console.log('Creating runtime for:', character.name);
  
  const runtime = createCrucibleRuntime({
    agentId: 'test-pm',
    character,
  });
  
  console.log('Initializing runtime...');
  
  try {
    await runtime.initialize();
    console.log('Runtime initialized successfully');
    console.log('Has actions:', runtime.hasActions());
  } catch (e) {
    console.error('Failed to initialize:', e);
    process.exit(1);
  }
  
  console.log('Sending test message...');
  
  const message: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: 'test-user',
    roomId: 'test-room',
    content: { text: 'Hello, can you help me organize my sprint backlog?', source: 'test' },
    createdAt: Date.now(),
  };
  
  try {
    const response = await runtime.processMessage(message);
    console.log('=== Response ===');
    console.log('Text:', response.text);
    if (response.action) {
      console.log('Action:', response.action);
    }
    console.log('=== Test Complete ===');
  } catch (e) {
    console.error('Message processing failed:', e);
    process.exit(1);
  }
}

main();
