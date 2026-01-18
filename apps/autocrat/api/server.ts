/**
 * Autocrat API Server Entry Point
 *
 * NOTE: The canonical app + worker implementation lives in `api/worker.ts`.
 * This file exists for backwards compatibility (older scripts import/run it).
 */

export type { App, AutocratEnv, AutocratNetwork } from './worker'
export { createAutocratApp, startAutocratServer } from './worker'

import { startAutocratServer } from './worker'

const isMainModule = typeof Bun !== 'undefined' && import.meta.main
if (isMainModule) {
  startAutocratServer().catch((err: Error) => {
    console.error('[Autocrat] Failed to start:', err.message)
    process.exit(1)
  })
}
