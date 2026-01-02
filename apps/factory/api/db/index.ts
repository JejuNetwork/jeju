/**
 * Factory Database Layer
 *
 * Provides a unified interface for database operations.
 * Uses local SQLite for development and DWS SQLit for production.
 *
 * Configuration:
 * - Set USE_SQLIT=true to use the decentralized SQLit network
 * - Default: uses local bun:sqlite for development
 */

import { getEnvVar } from '@jejunetwork/config'

// Determine which backend to use
const USE_SQLIT = getEnvVar('USE_SQLIT') === 'true'

// Re-export everything from the appropriate client
// For now, always use local SQLite as the default
// SQLit integration is available but opt-in

export * from './client'

// Export SQLit initialization for production use
export {
  initSQLitDB,
  closeSQLitDB,
  isSQLitHealthy,
} from './sqlit-client'

// Export the current database mode
export function getDatabaseMode(): 'local' | 'sqlit' {
  return USE_SQLIT ? 'sqlit' : 'local'
}

// Log which database mode is being used
if (typeof process !== 'undefined') {
  console.log(
    `[Factory DB] Using ${USE_SQLIT ? 'DWS SQLit (decentralized)' : 'local SQLite (development)'} database`,
  )
}

