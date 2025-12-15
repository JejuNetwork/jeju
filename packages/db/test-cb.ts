import { getCQL, resetCQL } from './src/client.ts';

// Mock fetch to always fail
const originalFetch = globalThis.fetch;
let callCount = 0;
globalThis.fetch = async () => {
  callCount++;
  throw new Error('Network failure');
};

const client = getCQL({ blockProducerEndpoint: 'http://fake:9999' });

async function test() {
  // Make 6 calls - circuit should open after 5
  for (let i = 0; i < 6; i++) {
    try {
      await client.isHealthy();
    } catch (e) {
      console.log(`Call ${i+1}: ${(e as Error).message}`);
    }
  }
  console.log(`Total fetch calls: ${callCount}`);
  // If circuit breaker works, call 6 should NOT hit fetch (should throw circuit open error)
}

test().finally(() => {
  globalThis.fetch = originalFetch;
  resetCQL();
});
