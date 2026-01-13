/**
 * Development entry point for Crucible API
 *
 * This file avoids exporting the worker pattern to prevent
 * Bun's auto-serve behavior on port 3000.
 */

import { createCrucibleApp } from './worker'
import { config } from './config'

const app = createCrucibleApp({
  NETWORK: config.network,
  TEE_MODE: 'simulated',
})

const server = app.listen(config.apiPort, () => {
  console.log(`[Crucible] API server running on port ${config.apiPort}`)
  console.log(`[Crucible] Network: ${config.network}`)
  console.log(`[Crucible] Health: http://localhost:${config.apiPort}/health`)
})

process.on('SIGINT', () => {
  server.stop()
  process.exit(0)
})
