#!/usr/bin/env bun
/**
 * Comprehensive Worker Deployment Test Script
 *
 * Tests the full worker deployment pipeline across environments:
 * 1. Local workerd execution
 * 2. Local DWS deployment
 * 3. Testnet DWS deployment
 *
 * Usage:
 *   bun scripts/test-worker-deployment.ts [local|testnet|all]
 */

import { spawn, type Subprocess } from 'bun'
import { setTimeout } from 'node:timers/promises'

// Test worker code
const TEST_WORKER_CODE = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'test-worker',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      message: 'Hello from test worker!',
      path: url.pathname,
      method: request.method,
      timestamp: new Date().toISOString(),
      env: Object.keys(env || {})
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
`

interface TestResult {
  test: string
  status: 'pass' | 'fail' | 'skip'
  duration: number
  details?: string
  error?: string
}

const results: TestResult[] = []

function logTest(name: string, status: 'pass' | 'fail' | 'skip', duration: number, details?: string, error?: string) {
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⏭️'
  console.log(`  ${icon} ${name} (${duration}ms)`)
  if (details) console.log(`     ${details}`)
  if (error) console.log(`     Error: ${error}`)
  results.push({ test: name, status, duration, details, error })
}

// Test 1: Module Load Test
async function testModuleLoad(): Promise<void> {
  console.log('\n📦 Testing Worker Module Loading...')
  const start = Date.now()
  
  const workers = [
    { name: 'autocrat', path: 'apps/autocrat/api/worker.ts' },
    { name: 'bazaar', path: 'apps/bazaar/api/worker.ts' },
    { name: 'crucible', path: 'apps/crucible/api/worker.ts' },
    { name: 'factory', path: 'apps/factory/api/worker.ts' },
    { name: 'indexer', path: 'apps/indexer/api/worker.ts' },
  ]
  
  for (const worker of workers) {
    const testStart = Date.now()
    try {
      const module = await import(`../${worker.path}`)
      const hasDefaultExport = 'default' in module
      const hasFetchExport = hasDefaultExport && (
        typeof module.default === 'function' ||
        (typeof module.default === 'object' && typeof module.default.fetch === 'function')
      )
      
      if (hasFetchExport) {
        logTest(`Load ${worker.name}`, 'pass', Date.now() - testStart)
      } else {
        logTest(`Load ${worker.name}`, 'fail', Date.now() - testStart, undefined, 'Missing fetch export')
      }
    } catch (err) {
      logTest(`Load ${worker.name}`, 'fail', Date.now() - testStart, undefined, 
        err instanceof Error ? err.message : String(err))
    }
  }
}

// Test 2: HTTP Health Check Test
async function testHTTPHealth(): Promise<void> {
  console.log('\n🌐 Testing Worker HTTP Endpoints...')
  
  const workers = [
    { name: 'autocrat', path: 'apps/autocrat/api/worker.ts', port: 18040, portEnvVar: 'AUTOCRAT_API_PORT' },
    { name: 'bazaar', path: 'apps/bazaar/api/worker.ts', port: 18007, portEnvVar: 'BAZAAR_API_PORT' },
    { name: 'crucible', path: 'apps/crucible/api/worker.ts', port: 18020, portEnvVar: 'CRUCIBLE_PORT' },
    { name: 'factory', path: 'apps/factory/api/worker.ts', port: 18009, portEnvVar: 'FACTORY_PORT' },
    { name: 'indexer', path: 'apps/indexer/api/worker.ts', port: 18352, portEnvVar: 'INDEXER_PORT' },
  ]
  
  for (const worker of workers) {
    let proc: Subprocess | null = null
    const testStart = Date.now()
    
    try {
      // Build environment
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        PORT: String(worker.port),
        NETWORK: 'localnet',
        [worker.portEnvVar]: String(worker.port),
        SQLIT_PRIVATE_KEY: process.env.SQLIT_PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      }
      
      // Start worker
      proc = spawn(['bun', worker.path], { env, stdout: 'pipe', stderr: 'pipe' })
      
      // Wait for startup
      await setTimeout(8000)
      
      // Test health
      const response = await fetch(`http://127.0.0.1:${worker.port}/health`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)
      
      if (response?.ok) {
        const data = await response.json()
        logTest(`HTTP ${worker.name}`, 'pass', Date.now() - testStart, `Health: ${JSON.stringify(data).slice(0, 50)}...`)
      } else {
        logTest(`HTTP ${worker.name}`, 'fail', Date.now() - testStart, undefined, 'No health response')
      }
    } catch (err) {
      logTest(`HTTP ${worker.name}`, 'fail', Date.now() - testStart, undefined,
        err instanceof Error ? err.message : String(err))
    } finally {
      if (proc) {
        proc.kill()
        await setTimeout(1000)
      }
    }
  }
}

// Test 3: DWS Deployment Test
async function testDWSDeployment(environment: 'local' | 'testnet'): Promise<void> {
  console.log(`\n🚀 Testing DWS Deployment (${environment})...`)
  
  const dwsUrl = environment === 'local' 
    ? 'http://127.0.0.1:4030'
    : 'https://dws.testnet.jejunetwork.org'
  
  // Check DWS health
  const healthStart = Date.now()
  try {
    const healthResponse = await fetch(`${dwsUrl}/workers/health`, {
      signal: AbortSignal.timeout(10000),
    })
    
    if (!healthResponse.ok) {
      logTest(`DWS ${environment} health`, 'fail', Date.now() - healthStart, undefined, 
        `Status: ${healthResponse.status}`)
      return
    }
    
    const healthData = await healthResponse.json()
    logTest(`DWS ${environment} health`, 'pass', Date.now() - healthStart, 
      `Runtime: ${healthData.runtimeMode}, workerd: ${healthData.workerdAvailable}`)
  } catch (err) {
    logTest(`DWS ${environment} health`, 'fail', Date.now() - healthStart, undefined,
      `DWS not reachable: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  
  // Deploy test worker
  const deployStart = Date.now()
  const code = Buffer.from(TEST_WORKER_CODE).toString('base64')
  
  try {
    const deployResponse = await fetch(`${dwsUrl}/workers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
      body: JSON.stringify({
        name: `test-worker-${Date.now()}`,
        code,
        memory: 128,
        timeout: 30000,
      }),
      signal: AbortSignal.timeout(30000),
    })
    
    if (!deployResponse.ok) {
      const errorText = await deployResponse.text()
      logTest(`DWS ${environment} deploy`, 'fail', Date.now() - deployStart, undefined, 
        `Status: ${deployResponse.status}, ${errorText.slice(0, 100)}`)
      return
    }
    
    const deployData = await deployResponse.json()
    logTest(`DWS ${environment} deploy`, 'pass', Date.now() - deployStart,
      `Worker ID: ${deployData.functionId}, CID: ${deployData.codeCid}`)
    
    // Test invocation (may fail if IPFS is slow)
    const invokeStart = Date.now()
    try {
      await setTimeout(2000) // Wait for worker to be ready
      
      const invokeResponse = await fetch(`${dwsUrl}/workers/${deployData.functionId}/http/health`, {
        signal: AbortSignal.timeout(10000),
      })
      
      if (invokeResponse.ok) {
        const invokeData = await invokeResponse.json()
        logTest(`DWS ${environment} invoke`, 'pass', Date.now() - invokeStart,
          `Response: ${JSON.stringify(invokeData).slice(0, 50)}...`)
      } else {
        const errorText = await invokeResponse.text()
        logTest(`DWS ${environment} invoke`, 'fail', Date.now() - invokeStart, undefined,
          `Status: ${invokeResponse.status}, ${errorText.slice(0, 100)}`)
      }
    } catch (err) {
      logTest(`DWS ${environment} invoke`, 'fail', Date.now() - invokeStart, undefined,
        err instanceof Error ? err.message : String(err))
    }
    
    // Cleanup - delete worker
    try {
      await fetch(`${dwsUrl}/workers/${deployData.functionId}`, {
        method: 'DELETE',
        headers: {
          'x-jeju-address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      })
    } catch {
      // Ignore cleanup errors
    }
  } catch (err) {
    logTest(`DWS ${environment} deploy`, 'fail', Date.now() - deployStart, undefined,
      err instanceof Error ? err.message : String(err))
  }
}

// Test 4: Workerd Config Generation Test
async function testWorkerdConfig(): Promise<void> {
  console.log('\n⚙️ Testing Workerd Config Generation...')
  const start = Date.now()
  
  try {
    const { generateWorkerConfig, wrapHandlerAsWorker } = await import('../apps/dws/api/workers/workerd/config-generator')
    
    const testWorker = {
      id: 'test-123',
      name: 'test-worker',
      owner: '0x1234567890123456789012345678901234567890',
      modules: [{ name: 'worker.js', type: 'esModule' as const, content: TEST_WORKER_CODE }],
      bindings: [{ name: 'TEST_VAR', type: 'text' as const, value: 'test' }],
      compatibilityDate: '2024-01-01',
      mainModule: 'worker.js',
      memoryMb: 128,
      cpuTimeMs: 50,
      timeoutMs: 30000,
      codeCid: 'QmTest',
      version: 1,
      status: 'active' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    const config = generateWorkerConfig(testWorker, 30001)
    
    if (config.includes('using Workerd') && config.includes('worker.js') && config.includes('TEST_VAR')) {
      logTest('Config generation', 'pass', Date.now() - start, 'Cap\'n Proto config generated correctly')
    } else {
      logTest('Config generation', 'fail', Date.now() - start, undefined, 'Config missing required elements')
    }
    
    // Test wrapper
    const wrapStart = Date.now()
    const wrapped = wrapHandlerAsWorker('function handler() {}', 'handler')
    
    if (wrapped.includes('export default') && wrapped.includes('fetch')) {
      logTest('Handler wrapping', 'pass', Date.now() - wrapStart, 'Handler wrapped as fetch worker')
    } else {
      logTest('Handler wrapping', 'fail', Date.now() - wrapStart, undefined, 'Wrapper missing fetch export')
    }
  } catch (err) {
    logTest('Config generation', 'fail', Date.now() - start, undefined,
      err instanceof Error ? err.message : String(err))
  }
}

// Main test runner
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║       Comprehensive Worker Deployment Test Suite           ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  
  const mode = process.argv[2] || 'all'
  const startTime = Date.now()
  
  if (mode === 'all' || mode === 'load') {
    await testModuleLoad()
  }
  
  if (mode === 'all' || mode === 'http') {
    await testHTTPHealth()
  }
  
  if (mode === 'all' || mode === 'config') {
    await testWorkerdConfig()
  }
  
  if (mode === 'all' || mode === 'local') {
    await testDWSDeployment('local')
  }
  
  if (mode === 'all' || mode === 'testnet') {
    await testDWSDeployment('testnet')
  }
  
  // Summary
  console.log('\n' + '═'.repeat(64))
  console.log('SUMMARY')
  console.log('═'.repeat(64))
  
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const skipped = results.filter(r => r.status === 'skip').length
  
  console.log(`\n  ✅ Passed: ${passed}`)
  console.log(`  ❌ Failed: ${failed}`)
  console.log(`  ⏭️  Skipped: ${skipped}`)
  console.log(`  ⏱️  Total time: ${Date.now() - startTime}ms`)
  
  if (failed > 0) {
    console.log('\n  Failed tests:')
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`    - ${r.test}: ${r.error ?? 'Unknown error'}`)
    }
  }
  
  console.log('')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Test runner error:', err)
  process.exit(1)
})
