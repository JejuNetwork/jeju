import { autocratAgentRuntime, checkDWSCompute } from '../src/agents/runtime';

async function test() {
  console.log('Checking DWS...');
  const dwsOk = await checkDWSCompute();
  console.log('DWS available:', dwsOk);
  
  console.log('Initializing Autocrat runtime...');
  await autocratAgentRuntime.initialize();
  
  console.log('Checking runtimes...');
  const treasury = autocratAgentRuntime.getRuntime('treasury');
  console.log('Treasury runtime exists:', !!treasury);
  console.log('Treasury has character:', !!treasury?.character);
  console.log('Treasury has registerPlugin:', typeof treasury?.registerPlugin);
  
  // Try to get all runtimes
  const code = autocratAgentRuntime.getRuntime('code');
  const community = autocratAgentRuntime.getRuntime('community');
  const security = autocratAgentRuntime.getRuntime('security');
  const legal = autocratAgentRuntime.getRuntime('legal');
  const ceo = autocratAgentRuntime.getRuntime('ceo');
  
  console.log('\nAll runtimes:');
  console.log('- treasury:', !!treasury);
  console.log('- code:', !!code);
  console.log('- community:', !!community);
  console.log('- security:', !!security);
  console.log('- legal:', !!legal);
  console.log('- ceo:', !!ceo);
}

test().catch(console.error);

