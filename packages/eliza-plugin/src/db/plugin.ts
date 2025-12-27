/**
 * EQLite Database Plugin for ElizaOS
 *
 * Provides a decentralized database adapter using EQLite.
 * Automatically initializes and runs migrations on startup.
 *
 * @example
 * ```typescript
 * import { eqliteDatabasePlugin } from '@jejunetwork/eliza-plugin';
 *
 * const character: Character = {
 *   name: 'MyAgent',
 *   plugins: [eqliteDatabasePlugin],
 *   // ...
 * };
 * ```
 */

import { type IAgentRuntime, logger, type Plugin } from '@elizaos/core'
import { getEqliteDatabaseId } from '@jejunetwork/config'
import { getEQLite } from '@jejunetwork/db'
import { EQLiteDatabaseAdapter } from './adapter'
import { checkMigrationStatus, runEQLiteMigrations } from './migrations'

/**
 * Create a EQLite database adapter for the given agent
 */
function createEQLiteAdapter(agentId: string): EQLiteDatabaseAdapter {
  const databaseId = getEqliteDatabaseId() ?? 'eliza'
  return new EQLiteDatabaseAdapter(
    agentId as `${string}-${string}-${string}-${string}-${string}`,
    {
      databaseId,
      autoMigrate: true,
    },
  )
}

/**
 * EQLite Database Plugin for ElizaOS
 *
 * This plugin provides:
 * - EQLite-based database adapter
 * - Automatic schema migration on startup
 */
export const eqliteDatabasePlugin: Plugin = {
  name: '@jejunetwork/plugin-eqlite',
  description: 'Decentralized database adapter using EQLite',
  priority: 0, // Load first to ensure database is available

  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    logger.info(
      { src: 'plugin:eqlite', agentId: runtime.agentId },
      'Initializing EQLite database plugin',
    )

    // Check if a database adapter is already registered
    // Runtime may have optional adapter-checking methods depending on ElizaOS version
    interface RuntimeWithOptionalAdapter {
      adapter?: object
      hasDatabaseAdapter?: () => boolean
      getDatabaseAdapter?: () => object | undefined
      databaseAdapter?: object
    }

    const runtimeWithAdapter = runtime as RuntimeWithOptionalAdapter
    const adapterRegistered =
      typeof runtimeWithAdapter.hasDatabaseAdapter === 'function'
        ? runtimeWithAdapter.hasDatabaseAdapter()
        : Boolean(
            runtimeWithAdapter.getDatabaseAdapter?.() ??
              runtimeWithAdapter.databaseAdapter ??
              runtimeWithAdapter.adapter,
          )

    if (adapterRegistered) {
      logger.info(
        { src: 'plugin:eqlite', agentId: runtime.agentId },
        'Database adapter already registered, skipping EQLite initialization',
      )
      return
    }

    // Check EQLite health
    const eqlite = getEQLite()
    const healthy = await eqlite.isHealthy()
    if (!healthy) {
      throw new Error(
        '[EQLite] EQLite is not healthy. ' +
          'Ensure Jeju services are running: cd /path/to/jeju && bun jeju dev\n' +
          'Or start EQLite manually: bun run eqlite',
      )
    }

    // Check and run migrations
    const databaseId = getEqliteDatabaseId() ?? 'eliza'
    const migrated = await checkMigrationStatus(eqlite, databaseId)
    if (!migrated) {
      logger.info({ src: 'plugin:eqlite' }, 'Running EQLite schema migrations...')
      await runEQLiteMigrations(eqlite, databaseId)
    }

    // Create and register the adapter
    const adapter = createEQLiteAdapter(runtime.agentId)
    runtime.registerDatabaseAdapter(adapter)

    logger.info(
      { src: 'plugin:eqlite', agentId: runtime.agentId, databaseId },
      'EQLite database adapter registered',
    )
  },
}

export default eqliteDatabasePlugin
