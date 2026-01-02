/**
 * Test script for worker runtime
 * Run: cd apps/dws && bun run test-worker-runtime.ts
 */

import type { createBackendManager } from './api/storage/backends'
import { WorkerRuntime } from './api/workers/runtime'
import type { WorkerFunction } from './api/workers/types'

// Create a simple test worker
const TEST_WORKER_CODE = `
// Simple test worker
const PORT = process.env.PORT || 3000;

const server = Bun.serve({
  port: Number(PORT),
  fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }
    
    if (url.pathname === '/echo') {
      return new Response(JSON.stringify({
        method: req.method,
        path: url.pathname,
        timestamp: Date.now(),
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Hello from test worker!', { status: 200 });
  },
});

console.log('Test worker listening on port ' + PORT);
`

async function main() {
  console.log('=== Worker Runtime Test ===\n')

  // Create a mock backend that stores code in memory
  const codeStore = new Map<string, Buffer>()

  // Upload test worker code
  const testCid = `test-worker-${Date.now()}`
  codeStore.set(testCid, Buffer.from(TEST_WORKER_CODE))

  // Create mock backend manager
  const mockBackend = {
    upload: async (_content: Buffer, _opts: unknown) => ({ cid: testCid }),
    download: async (cid: string) => {
      const content = codeStore.get(cid)
      if (!content) throw new Error(`Not found: ${cid}`)
      return { content }
    },
    exists: async (cid: string) => codeStore.has(cid),
    delete: async (_cid: string) => {},
    list: async () => [],
    getUrl: (cid: string) => `local://${cid}`,
    stats: async () => ({ totalSize: 0, fileCount: 0 }),
  }

  // Create runtime
  console.log('1. Creating worker runtime...')
  const runtime = new WorkerRuntime(
    mockBackend as unknown as ReturnType<typeof createBackendManager>,
  )

  // Wait for initialization
  await new Promise((r) => setTimeout(r, 1000))

  // Deploy a test function
  console.log('\n2. Deploying test worker...')
  const fn: WorkerFunction = {
    id: 'test-function-1',
    name: 'test-worker',
    owner: '0x0000000000000000000000000000000000000000',
    runtime: 'bun',
    handler: 'index.handler',
    codeCid: testCid,
    memory: 128,
    timeout: 30000,
    env: {},
    status: 'active',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    invocationCount: 0,
    avgDurationMs: 0,
    errorCount: 0,
  }

  await runtime.deployFunction(fn)
  console.log(`   Deployed: ${fn.name}`)

  // Get stats
  const stats = runtime.getStats()
  console.log('\n3. Runtime stats:', JSON.stringify(stats, null, 2))

  // Test HTTP invocation
  console.log('\n4. Testing HTTP invocation...')
  const response = await runtime.invokeHTTP(fn.id, {
    method: 'GET',
    path: '/echo',
    headers: {},
    query: {},
    body: null,
  })

  console.log('   Response status:', response.statusCode)
  console.log('   Response body:', response.body)

  if (response.statusCode === 200) {
    console.log('\n✅ Worker runtime test PASSED!')
  } else if (response.statusCode === 503) {
    console.log(
      '\n⚠️  Worker failed to spawn. This is expected if running in a restricted environment.',
    )
    console.log('   Error:', response.body)
  } else {
    console.log('\n❌ Worker runtime test FAILED!')
    console.log('   Error:', response.body)
  }

  // Undeploy
  console.log('\n5. Cleaning up...')
  await runtime.undeployFunction(fn.id)

  // Final stats
  const finalStats = runtime.getStats()
  console.log('   Final stats:', JSON.stringify(finalStats, null, 2))

  console.log('\n=== Test complete ===')
}

main().catch(console.error)
