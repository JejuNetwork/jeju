#!/usr/bin/env bun
/**
 * Wallet Production Serve Script
 *
 * Serves the built production assets using Vite preview.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import type { Subprocess } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const PORT = Number(process.env.PORT) || 4015

let process_ref: Subprocess | null = null
let shuttingDown = false

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[Wallet] Shutting down...')
  if (process_ref && process_ref.exitCode === null) {
    process_ref.kill()
  }
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

async function main() {
  const host = getLocalhostHost()
  console.log('[Wallet] Starting production server...')

  // Check if build exists
  if (!existsSync(resolve(APP_DIR, 'dist/index.html'))) {
    console.log('[Wallet] Build not found, running build first...')
    const buildProc = Bun.spawn(['bun', 'run', 'scripts/build.ts'], {
      cwd: APP_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await buildProc.exited
  }

  console.log(`[Wallet] Starting preview server on port ${PORT}...`)

  process_ref = Bun.spawn(['bunx', 'vite', 'preview', '--port', String(PORT), '--host'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  })

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║           Wallet Production Server Ready                    ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(`║  Server:    http://${host}:${PORT}                          ║`)
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('Press Ctrl+C to stop')

  await process_ref.exited
}

main().catch((err) => {
  console.error('[Wallet] Error:', err)
  cleanup()
})
