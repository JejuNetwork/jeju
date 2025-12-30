#!/usr/bin/env bun
/**
 * Otto Development Server
 *
 * Starts the Otto bot API server with hot reload.
 */

import { resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const API_PORT = Number(process.env.OTTO_PORT) || 4050

let process_ref: Subprocess | null = null
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[Otto] Shutting down...')
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
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Otto Development Server                        ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  console.log(`[Otto] Starting API server on port ${API_PORT}...`)

  process_ref = Bun.spawn(['bun', '--watch', 'api/server.ts'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      OTTO_PORT: String(API_PORT),
    },
  })

  const ready = await waitForPort(API_PORT, 30000)
  if (!ready) {
    console.error('[Otto] Failed to start API server')
    cleanup()
    process.exit(1)
  }

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    Otto is ready                            ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║  API:       http://${host}:${API_PORT}                          ║`,
  )
  console.log(
    `║  Health:    http://${host}:${API_PORT}/health                   ║`,
  )
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop')

  await process_ref.exited
}

main().catch((err) => {
  console.error('[Otto] Error:', err)
  cleanup()
})
