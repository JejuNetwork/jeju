#!/usr/bin/env bun

// Copyright (c) 2024 Jeju Network
// Test runner that starts workerd, verifies it's working, then runs tests
// Licensed under the Apache 2.0 license

import { dirname, join } from 'node:path'
import { type Subprocess, spawn } from 'bun'

const WORKERD_URL = 'http://localhost:9123'
const STARTUP_TIMEOUT = 30000 // 30 seconds
const HEALTH_CHECK_INTERVAL = 500 // 500ms

// Get the path to the samples directory
const scriptDir = dirname(import.meta.path)
const workerdRoot = join(scriptDir, '..', '..')
const bunHelloDir = join(workerdRoot, 'samples', 'bun-hello')

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
}

async function findWorkerd(): Promise<string> {
  // Try common locations for workerd binary
  const locations = [
    'workerd', // PATH
    join(workerdRoot, 'bazel-bin', 'src', 'workerd', 'server', 'workerd'),
    '/usr/local/bin/workerd',
    '/opt/homebrew/bin/workerd',
  ]

  for (const loc of locations) {
    try {
      const proc = spawn(['which', loc], { stdout: 'pipe', stderr: 'pipe' })
      await proc.exited
      if (proc.exitCode === 0) {
        const output = await new Response(proc.stdout).text()
        return output.trim() || loc
      }
    } catch {
      // Try the path directly
      try {
        const proc = spawn([loc, '--version'], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        await proc.exited
        if (proc.exitCode === 0) {
          return loc
        }
      } catch {}
    }
  }

  // Default to 'workerd' and let it fail with a clear error
  return 'workerd'
}

async function waitForWorkerd(timeoutMs: number): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${WORKERD_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        return true
      }
    } catch {
      // Not ready yet
    }
    await Bun.sleep(HEALTH_CHECK_INTERVAL)
  }

  return false
}

async function runNodeHelloWorld(): Promise<TestResult> {
  const start = Date.now()
  const name = 'Node.js Hello World (basic fetch)'

  try {
    // Simple test: fetch the root endpoint and verify response
    const response = await fetch(`${WORKERD_URL}/`, {
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return {
        name,
        passed: false,
        duration: Date.now() - start,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = (await response.json()) as {
      message?: string
      runtime?: string
    }

    if (data.message !== 'Hello from Bun worker!') {
      return {
        name,
        passed: false,
        duration: Date.now() - start,
        error: `Unexpected message: ${data.message}`,
      }
    }

    if (data.runtime !== 'workerd') {
      return {
        name,
        passed: false,
        duration: Date.now() - start,
        error: `Unexpected runtime: ${data.runtime}`,
      }
    }

    return {
      name,
      passed: true,
      duration: Date.now() - start,
    }
  } catch (err) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function runBunTests(): Promise<{ exitCode: number; output: string }> {
  console.log('\n📋 Running Bun worker tests...\n')

  const proc = spawn(['bun', 'test', 'src/bun/'], {
    cwd: workerdRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      WORKERD_RUNNING: '1',
    },
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  await proc.exited

  return {
    exitCode: proc.exitCode ?? 1,
    output: stdout + stderr,
  }
}

async function main(): Promise<void> {
  console.log('🚀 Workerd Test Runner')
  console.log('='.repeat(60))

  // Step 1: Find workerd binary
  console.log('\n🔍 Finding workerd binary...')
  const workerdBin = await findWorkerd()
  console.log(`   Using: ${workerdBin}`)

  // Step 2: Start workerd
  console.log('\n🏃 Starting workerd...')
  console.log(`   Config: ${bunHelloDir}/config.capnp`)

  let workerdProc: Subprocess | null = null

  try {
    workerdProc = spawn([workerdBin, 'serve', 'config.capnp'], {
      cwd: bunHelloDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // Give it a moment to start
    await Bun.sleep(1000)

    // Check if it crashed immediately
    if (workerdProc.exitCode !== null) {
      const stderrStream = workerdProc.stderr
      const stderr =
        stderrStream instanceof ReadableStream
          ? await new Response(stderrStream).text()
          : 'Unable to read stderr'
      console.error('❌ Workerd failed to start:')
      console.error(stderr)
      process.exit(1)
    }

    console.log(`   PID: ${workerdProc.pid}`)
    console.log(`   URL: ${WORKERD_URL}`)

    // Step 3: Wait for workerd to be ready
    console.log('\n⏳ Waiting for workerd to be ready...')
    const ready = await waitForWorkerd(STARTUP_TIMEOUT)

    if (!ready) {
      console.error('❌ Workerd failed to start within timeout')
      workerdProc.kill()
      process.exit(1)
    }

    console.log('   ✅ Workerd is ready')

    // Step 4: Run Node.js hello world test
    console.log('\n📦 Running basic connectivity test...')
    const nodeResult = await runNodeHelloWorld()

    if (nodeResult.passed) {
      console.log(`   ✅ ${nodeResult.name} (${nodeResult.duration}ms)`)
    } else {
      console.log(`   ❌ ${nodeResult.name}`)
      console.log(`      Error: ${nodeResult.error}`)
      workerdProc.kill()
      process.exit(1)
    }

    // Step 5: Run Bun worker tests
    const testResult = await runBunTests()
    console.log(testResult.output)

    // Step 6: Cleanup
    console.log('\n🧹 Cleaning up...')
    workerdProc.kill()
    await workerdProc.exited
    console.log('   ✅ Workerd stopped')

    // Exit with test result
    if (testResult.exitCode !== 0) {
      console.log('\n❌ Tests failed')
      process.exit(testResult.exitCode)
    }

    console.log('\n✅ All tests passed')
    process.exit(0)
  } catch (err) {
    console.error('\n❌ Error:', err instanceof Error ? err.message : err)

    if (workerdProc) {
      workerdProc.kill()
    }

    process.exit(1)
  }
}

// Run
main()
