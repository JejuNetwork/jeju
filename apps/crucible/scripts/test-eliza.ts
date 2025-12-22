/**
 * Test script to verify ElizaOS integration works
 */

import { createCrucibleRuntime, type RuntimeMessage } from '../src/sdk/eliza-runtime';
import { getCharacter } from '../src/characters';

async function main() {
  console.log('=== Testing Crucible ElizaOS Integration ===');
  
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
    console.log('ElizaOS runtime available:', !!runtime.getElizaRuntime());
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
    console.log('Action:', response.action);
    console.log('Actions:', response.actions);
  } catch (e) {
    console.error('Message processing failed:', e);
    process.exit(1);
  }
  
  console.log('=== Test Complete ===');
}

main();
