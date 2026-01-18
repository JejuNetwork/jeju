#!/usr/bin/env bun
/**
 * Gateway Production Serve Script
 *
 * Runs the built production servers locally.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const API_PORT = Number(process.env.GATEWAY_API_PORT) || 4013

interface ProcessInfo {
  name: string
  process: Subprocess
}

const processes: ProcessInfo[] = []
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[Gateway] Shutting down...')

  for (const { name, process } of processes) {
    console.log(`[Gateway] Stopping ${name}...`)
    try {
      process.kill()
    } catch {
      // Process may have already exited
    }
  }

  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

async function waitForPort(port: number, timeout = 30000): Promise<boolean> {
  const host = getLocalhostHost()
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) return true
    } catch {
      // Port not ready yet
    }
    await Bun.sleep(500)
  }
  return false
}

async function main() {
  const host = getLocalhostHost()
  console.log('[Gateway] Starting production server...')

  // Check if frontend build exists
  const distWebPath = resolve(APP_DIR, 'dist/index.html')

  if (!existsSync(distWebPath)) {
    console.log('[Gateway] Build not found, running build first...')
    const buildProc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await buildProc.exited
  }

  // Start the worker from source (avoids Bun auto-serve conflicts with bundle)
  // Frontend is served via IPFS/JNS in real deployments
  console.log(`[Gateway] Starting worker server on port ${API_PORT}...`)

  const proc = Bun.spawn(['bun', 'run', 'api/worker.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(API_PORT),
      NODE_ENV: 'production',
    },
  })

  processes.push({ name: 'worker', process: proc })

  const ready = await waitForPort(API_PORT, 30000)
  if (!ready) {
    console.error('[Gateway] Failed to start server')
    cleanup()
    process.exit(1)
  }

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║           Gateway Production Server Ready                   ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║  Server:    http://${host}:${API_PORT}                          ║`,
  )
  console.log(
    `║  Health:    http://${host}:${API_PORT}/health                   ║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop')

  await proc.exited
}

main().catch((err) => {
  console.error('[Gateway] Error:', err)
  cleanup()
  process.exit(1)
})
