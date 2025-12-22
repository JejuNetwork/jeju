/**
 * Live Crucible Agent Test - Verify agents actually run and respond
 */

import { runtimeManager, checkDWSHealth, dwsGenerate } from '../src/sdk/eliza-runtime';
import { getCharacter, listCharacters, characters } from '../src/characters';

async function testLiveAgents() {
  console.log('\n=== CRUCIBLE LIVE AGENT TEST ===\n');

  // 1. Check DWS
  console.log('1. Checking DWS compute...');
  const dwsOk = await checkDWSHealth();
  if (!dwsOk) {
    console.error('❌ DWS not available');
    process.exit(1);
  }
  console.log('✅ DWS available\n');

  // 2. Test dwsGenerate directly
  console.log('2. Testing DWS inference...');
  const testPrompt = 'What is the capital of France? Just the city name.';
  const testSystem = 'You are a helpful assistant. Be brief.';
  const result = await dwsGenerate(testPrompt, testSystem, { maxTokens: 50 });
  console.log(`   Prompt: "${testPrompt}"`);
  console.log(`   Response: "${result.trim()}"`);
  console.log('✅ DWS inference works\n');

  // 3. Get all characters
  console.log('3. Available characters:');
  const charIds = listCharacters();
  for (const id of charIds) {
    const char = characters[id];
    console.log(`   - ${id}: ${char.name}`);
  }
  console.log('');

  // 4. Create and test Project Manager agent
  console.log('4. Testing Project Manager agent...');
  const pmChar = getCharacter('project-manager');
  if (!pmChar) throw new Error('Project Manager character not found');
  
  const pmRuntime = await runtimeManager.createRuntime({
    agentId: 'test-pm',
    character: pmChar,
  });
  
  console.log('   Runtime created:', pmRuntime.isInitialized());
  console.log('   DWS available:', pmRuntime.isDWSAvailable());
  
  const pmResponse = await pmRuntime.processMessage({
    id: 'msg-1',
    userId: 'user-1',
    roomId: 'room-1',
    content: { text: 'What are your top 3 priorities for managing a software project?' },
    createdAt: Date.now(),
  });
  
  console.log(`   Response: "${pmResponse.text.slice(0, 200)}..."`);
  console.log(`   Actions: ${pmResponse.actions?.length ?? 0}`);
  console.log('✅ Project Manager works\n');

  // 5. Create and test Red Team agent
  console.log('5. Testing Red Team agent...');
  const rtChar = getCharacter('red-team');
  if (!rtChar) throw new Error('Red Team character not found');
  
  const rtRuntime = await runtimeManager.createRuntime({
    agentId: 'test-rt',
    character: rtChar,
  });
  
  const rtResponse = await rtRuntime.processMessage({
    id: 'msg-2',
    userId: 'user-1',
    roomId: 'room-1',
    content: { text: 'What is the most common smart contract vulnerability?' },
    createdAt: Date.now(),
  });
  
  console.log(`   Response: "${rtResponse.text.slice(0, 200)}..."`);
  console.log(`   Actions: ${rtResponse.actions?.length ?? 0}`);
  console.log('✅ Red Team works\n');

  // 6. Create and test Community Manager agent
  console.log('6. Testing Community Manager agent...');
  const cmChar = getCharacter('community-manager');
  if (!cmChar) throw new Error('Community Manager character not found');
  
  const cmRuntime = await runtimeManager.createRuntime({
    agentId: 'test-cm',
    character: cmChar,
  });
  
  const cmResponse = await cmRuntime.processMessage({
    id: 'msg-3',
    userId: 'user-1',
    roomId: 'room-1',
    content: { text: 'How do you handle a toxic community member?' },
    createdAt: Date.now(),
  });
  
  console.log(`   Response: "${cmResponse.text.slice(0, 200)}..."`);
  console.log(`   Actions: ${cmResponse.actions?.length ?? 0}`);
  console.log('✅ Community Manager works\n');

  // 7. Cleanup
  console.log('7. Shutting down...');
  await runtimeManager.shutdown();
  console.log('✅ Shutdown complete\n');

  console.log('=== ALL CRUCIBLE TESTS PASSED ===\n');
}

testLiveAgents().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});

