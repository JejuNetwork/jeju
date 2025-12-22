import { createCrucibleRuntime, runtimeManager, checkDWSHealth } from '../src/sdk/eliza-runtime';
import { getCharacter } from '../src/characters';

async function test() {
  console.log('Checking DWS...');
  const dwsOk = await checkDWSHealth();
  console.log('DWS available:', dwsOk);
  
  console.log('Creating runtime...');
  const char = getCharacter('project-manager');
  const runtime = await runtimeManager.createRuntime({
    agentId: 'test-pm',
    character: char!,
    useElizaOS: true,
  });
  
  console.log('Runtime initialized:', runtime.isInitialized());
  console.log('ElizaOS available:', runtime.isElizaOSAvailable());
  console.log('DWS available:', runtime.isDWSAvailable());
}

test().catch(console.error);

