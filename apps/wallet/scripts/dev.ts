#!/usr/bin/env bun
/**
 * Wallet Development Server
 *
 * Wraps Vite dev server for local development.
 */

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
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Wallet Development Server                      ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  console.log(`[Wallet] Starting Vite dev server on port ${PORT}...`)

  process_ref = Bun.spawn(['bunx', 'vite', '--port', String(PORT), '--host'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  })

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                    Wallet is ready                          ║')
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
