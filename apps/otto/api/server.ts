#!/usr/bin/env bun
/**
 * Otto API Server
 *
 * Development server that wraps the worker with hot reload support.
 * Uses the same createOttoApp from worker.ts for consistency.
 */
import { getLocalhostHost, getNetworkName } from '@jejunetwork/config'
import { createOttoApp } from './worker'

const PORT = Number(process.env.OTTO_PORT) || 4050
const networkName = getNetworkName()
const host = getLocalhostHost()

const app = createOttoApp()

if (import.meta.main) {
  console.log(`🤖 Otto API running at http://${host}:${PORT}`)
  console.log(`   Network: ${networkName}`)
  console.log(`   Health: http://${host}:${PORT}/health`)
  app.listen(PORT)
}

export { app }
