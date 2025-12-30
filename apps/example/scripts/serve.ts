#!/usr/bin/env bun
/**
 * Example Production Serve Script
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const API_PORT = Number(process.env.PORT) || 3001

let process_ref: Subprocess | null = null
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[Example] Shutting down...')
  if (process_ref && process_ref.exitCode === null) {
    process_ref.kill()
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
  console.log('[Example] Starting production server...')

  // Check if build exists
  if (!existsSync(resolve(APP_DIR, 'dist/api/index.js'))) {
    console.log('[Example] Build not found, running build first...')
    const buildProc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await buildProc.exited
  }

  console.log(`[Example] Starting API server on port ${API_PORT}...`)

  process_ref = Bun.spawn(['bun', 'run', 'dist/api/index.js'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: String(API_PORT),
      NODE_ENV: 'production',
    },
  })

  const ready = await waitForPort(API_PORT, 30000)
  if (!ready) {
    console.error('[Example] Failed to start server')
    cleanup()
    process.exit(1)
  }

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║          Example Production Server Ready                    ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Server:    http://${host}:${API_PORT}                          ║`)
  console.log(`║  Health:    http://${host}:${API_PORT}/health                   ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop')

  await process_ref.exited
}

main().catch((err) => {
  console.error('[Example] Error:', err)
  cleanup()
})
