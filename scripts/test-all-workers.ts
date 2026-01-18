#!/usr/bin/env bun
/**
 * Test All Worker Deployments
 *
 * Verifies that all Jeju app workers can be loaded and served correctly.
 * Tests the worker export pattern and basic HTTP functionality.
 */

import { spawn, type Subprocess } from 'bun'
import { setTimeout } from 'node:timers/promises'

interface WorkerInfo {
  name: string
  path: string
  port: number
  portEnvVar?: string // Environment variable name for port (if not just PORT)
  requiresServices?: string[] // External services required (sqlit, cache, etc)
}

const WORKERS: WorkerInfo[] = [
  { name: 'autocrat', path: 'apps/autocrat/api/worker.ts', port: 14040, portEnvVar: 'AUTOCRAT_API_PORT' },
  { name: 'bazaar', path: 'apps/bazaar/api/worker.ts', port: 14007, portEnvVar: 'BAZAAR_API_PORT' },
  { name: 'crucible', path: 'apps/crucible/api/worker.ts', port: 14020, portEnvVar: 'CRUCIBLE_PORT' },
  { name: 'factory', path: 'apps/factory/api/worker.ts', port: 14009, portEnvVar: 'FACTORY_PORT' },
  { name: 'indexer', path: 'apps/indexer/api/worker.ts', port: 14352, portEnvVar: 'INDEXER_PORT' },
  // These apps don't have worker.ts yet - they use server.ts or multiple entry points:
  // - gateway: multiple servers (rpc-server.ts, x402-server.ts, etc.)
  // - monitoring: multiple servers (heartbeat.ts, database-monitor.ts, etc.)
  // - oauth3: api/index.ts (needs worker.ts wrapper)
  // - otto: no worker.ts (needs creation)
  // - vpn: no worker.ts (needs creation)
]

interface TestResult {
  name: string
  status: 'pass' | 'fail' | 'skip'
  loadTime?: number
  healthCheck?: boolean
  error?: string
}

async function testWorkerLoad(worker: WorkerInfo): Promise<TestResult> {
  const startTime = Date.now()

  try {
    // Try to dynamically import the worker module
    const module = await import(`../${worker.path}`)

    const loadTime = Date.now() - startTime

    // Check for correct export pattern
    const hasDefaultExport = 'default' in module
    const hasFetchExport =
      hasDefaultExport &&
      (typeof module.default === 'function' ||
        (typeof module.default === 'object' &&
          typeof module.default.fetch === 'function'))

    if (!hasFetchExport) {
      return {
        name: worker.name,
        status: 'fail',
        loadTime,
        error: 'Missing fetch export pattern',
      }
    }

    return {
      name: worker.name,
      status: 'pass',
      loadTime,
    }
  } catch (err) {
    return {
      name: worker.name,
      status: 'fail',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function testWorkerHTTP(worker: WorkerInfo): Promise<TestResult> {
  // Skip workers that require external services unless --full is passed
  if (worker.requiresServices?.length && !process.argv.includes('--full')) {
    return {
      name: worker.name,
      status: 'skip',
      error: `Requires: ${worker.requiresServices.join(', ')}`,
    }
  }

  let proc: Subprocess | null = null

  try {
    // Build environment with correct port variable for each worker
    const workerEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      PORT: String(worker.port), // Fallback PORT
      NETWORK: 'localnet',
      // Provide SQLit private key for apps that require it
      SQLIT_PRIVATE_KEY:
        process.env.SQLIT_PRIVATE_KEY ??
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    }
    // Set the specific port env var for this worker
    if (worker.portEnvVar) {
      workerEnv[worker.portEnvVar] = String(worker.port)
    }

    // Start the worker (use 'bun' directly, not 'bun run' which adds dev server overhead)
    proc = spawn(['bun', worker.path], {
      env: workerEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // Wait for startup (factory needs longer due to DB init, use 8s to be safe)
    await setTimeout(8000)

    // Test health endpoint
    const healthResponse = await fetch(
      `http://127.0.0.1:${worker.port}/health`,
      {
        signal: AbortSignal.timeout(5000),
      },
    ).catch(() => null)

    // Test root endpoint
    const rootResponse = await fetch(`http://127.0.0.1:${worker.port}/`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    const healthOk = healthResponse?.ok ?? false
    const rootOk = rootResponse?.ok ?? false

    return {
      name: worker.name,
      status: healthOk || rootOk ? 'pass' : 'fail',
      healthCheck: healthOk,
      error:
        !healthOk && !rootOk ? 'No response from health or root endpoint' : undefined,
    }
  } catch (err) {
    return {
      name: worker.name,
      status: 'fail',
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (proc) {
      proc.kill()
      // Wait for process to fully terminate and port to be freed
      await setTimeout(1000)
    }
  }
}

// Kill any existing processes on a port using fuser (more reliable)
async function killProcessOnPort(port: number): Promise<void> {
  const { execSync } = await import('node:child_process')
  try {
    // Try to find and kill any process on the port
    execSync(`lsof -t -i:${port} | xargs -r kill -9 2>/dev/null`, { stdio: 'ignore' })
    await setTimeout(500) // Wait for process to die
  } catch {
    // Ignore errors - port may already be free
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║          Testing All Jeju Backend Workers                  ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log()

  const mode = process.argv[2] || 'load'

  if (mode === 'load') {
    console.log('Testing worker module loading...\n')

    const results: TestResult[] = []

    for (const worker of WORKERS) {
      process.stdout.write(`  ${worker.name.padEnd(15)}`)
      const result = await testWorkerLoad(worker)
      results.push(result)

      if (result.status === 'pass') {
        console.log(`✅ PASS (${result.loadTime}ms)`)
      } else {
        console.log(`❌ FAIL: ${result.error?.slice(0, 60)}`)
      }
    }

    console.log()
    const passed = results.filter((r) => r.status === 'pass').length
    const failed = results.filter((r) => r.status === 'fail').length
    console.log(`Results: ${passed} passed, ${failed} failed`)

    process.exit(failed > 0 ? 1 : 0)
  } else if (mode === 'http') {
    console.log('Testing worker HTTP endpoints (this will take ~30s)...\n')

    const results: TestResult[] = []

    for (const worker of WORKERS) {
      process.stdout.write(`  ${worker.name.padEnd(15)}`)
      const result = await testWorkerHTTP(worker)
      results.push(result)

      if (result.status === 'pass') {
        console.log(`✅ PASS ${result.healthCheck ? '(health OK)' : '(root OK)'}`)
      } else if (result.status === 'skip') {
        console.log(`⏭️  SKIP: ${result.error}`)
      } else {
        console.log(`❌ FAIL: ${result.error?.slice(0, 50)}`)
      }
    }

    console.log()
    const passed = results.filter((r) => r.status === 'pass').length
    const skipped = results.filter((r) => r.status === 'skip').length
    const failed = results.filter((r) => r.status === 'fail').length
    console.log(`Results: ${passed} passed, ${skipped} skipped, ${failed} failed`)
    if (skipped > 0) {
      console.log('Use --full to test workers requiring external services')
    }

    // Exit with success if only skipped tests remain
    process.exit(failed > 0 ? 1 : 0)
  } else {
    console.log('Usage: bun scripts/test-all-workers.ts [load|http]')
    console.log('  load - Test module loading (fast)')
    console.log('  http - Test HTTP endpoints (slow, starts each worker)')
  }
}

main().catch(console.error)
