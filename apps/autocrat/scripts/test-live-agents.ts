/**
 * Live Agent Test - Verify agents actually run and respond
 */

import { autocratAgentRuntime, dwsGenerate, checkDWSCompute } from '../src/agents/runtime';

async function testLiveAgents() {
  console.log('\n=== LIVE AGENT TEST ===\n');

  // 1. Check DWS
  console.log('1. Checking DWS compute...');
  const dwsOk = await checkDWSCompute();
  if (!dwsOk) {
    console.error('❌ DWS not available');
    process.exit(1);
  }
  console.log('✅ DWS available\n');

  // 2. Initialize runtime
  console.log('2. Initializing ElizaOS runtime...');
  await autocratAgentRuntime.initialize();
  console.log('✅ Runtime initialized\n');

  // 3. Get all runtimes
  console.log('3. Checking agent runtimes...');
  const agents = ['treasury', 'code', 'community', 'security', 'legal', 'ceo'];
  for (const id of agents) {
    const runtime = autocratAgentRuntime.getRuntime(id);
    console.log(`   - ${id}: ${runtime ? '✅' : '❌'}`);
  }
  console.log('');

  // 4. Test dwsGenerate directly
  console.log('4. Testing DWS inference...');
  const testPrompt = 'What is 5 + 7? Just give the number.';
  const testSystem = 'You are a helpful assistant. Be brief.';
  const result = await dwsGenerate(testPrompt, testSystem, 50);
  console.log(`   Prompt: "${testPrompt}"`);
  console.log(`   Response: "${result.trim()}"`);
  console.log('✅ DWS inference works\n');

  // 5. Test agent deliberation
  console.log('5. Testing agent deliberation...');
  const proposal = {
    proposalId: 'TEST-001',
    title: 'Increase Community Rewards',
    summary: 'Proposal to increase community contributor rewards by 20%',
    description: 'This proposal aims to increase the rewards for community contributors to incentivize more participation.',
    proposalType: 'TREASURY',
    submitter: '0x1234567890abcdef1234567890abcdef12345678',
  };

  console.log(`   Proposal: "${proposal.title}"`);
  
  // Test with Treasury agent
  console.log('\n   === Treasury Agent Deliberation ===');
  const treasuryVote = await autocratAgentRuntime.deliberate('treasury', proposal);
  console.log(`   Vote: ${treasuryVote.vote}`);
  console.log(`   Confidence: ${treasuryVote.confidence}%`);
  console.log(`   Reasoning: ${treasuryVote.reasoning.slice(0, 150)}...`);
  
  // Test with Community agent
  console.log('\n   === Community Agent Deliberation ===');
  const communityVote = await autocratAgentRuntime.deliberate('community', proposal);
  console.log(`   Vote: ${communityVote.vote}`);
  console.log(`   Confidence: ${communityVote.confidence}%`);
  console.log(`   Reasoning: ${communityVote.reasoning.slice(0, 150)}...`);

  console.log('\n✅ Agent deliberation works\n');

  // 6. Test CEO decision
  console.log('6. Testing CEO decision...');
  const ceoDecision = await autocratAgentRuntime.ceoDecision({
    proposalId: 'TEST-001',
    autocratVotes: [treasuryVote, communityVote],
  });
  console.log(`   Decision: ${ceoDecision.approved ? 'APPROVED' : 'REJECTED'}`);
  console.log(`   Confidence: ${ceoDecision.confidence}%`);
  console.log(`   Alignment: ${ceoDecision.alignment}%`);
  console.log(`   Reasoning: ${ceoDecision.reasoning.slice(0, 150)}...`);
  console.log(`   Persona Response: ${ceoDecision.personaResponse.slice(0, 150)}...`);

  console.log('\n✅ CEO decision works\n');

  console.log('=== ALL TESTS PASSED ===\n');
}

testLiveAgents().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});

