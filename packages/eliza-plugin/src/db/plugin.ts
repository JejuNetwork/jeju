/**
 * SQLit Database Plugin for ElizaOS
 *
 * Provides a decentralized database adapter using SQLit.
 * Automatically initializes and runs migrations on startup.
 *
 * @example
 * ```typescript
 * import { sqlitDatabasePlugin } from '@jejunetwork/eliza-plugin';
 *
 * const character: Character = {
 *   name: 'MyAgent',
 *   plugins: [sqlitDatabasePlugin],
 *   // ...
 * };
 * ```
 */

import { type IAgentRuntime, logger, type Plugin } from '@elizaos/core'
import { getSQLitDatabaseId } from '@jejunetwork/config'
import { getSQLit } from '@jejunetwork/db'
import { SQLitDatabaseAdapter } from './adapter'
import { checkMigrationStatus, runSQLitMigrations } from './migrations'

/**
 * Create a SQLit database adapter for the given agent
 */
function createSQLitAdapter(agentId: string): SQLitDatabaseAdapter {
  const databaseId = getSQLitDatabaseId() ?? 'eliza'
  return new SQLitDatabaseAdapter(
    agentId as `${string}-${string}-${string}-${string}-${string}`,
    {
      databaseId,
      autoMigrate: true,
    },
  )
}

/**
 * SQLit Database Plugin for ElizaOS
 *
 * This plugin provides:
 * - SQLit-based database adapter
 * - Automatic schema migration on startup
 */
export const sqlitDatabasePlugin: Plugin = {
  name: '@jejunetwork/plugin-sqlit',
  description: 'Decentralized database adapter using SQLit',
  priority: 0, // Load first to ensure database is available

  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    logger.info(
      { src: 'plugin:sqlit', agentId: runtime.agentId },
      'Initializing SQLit database plugin',
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
        { src: 'plugin:sqlit', agentId: runtime.agentId },
        'Database adapter already registered, skipping SQLit initialization',
      )
      return
    }

    // Check SQLit health
    const sqlit = getSQLit()
    const healthy = await sqlit.isHealthy()
    if (!healthy) {
      throw new Error(
        '[SQLit] SQLit is not healthy. ' +
          'Ensure Jeju services are running: cd /path/to/jeju && bun jeju dev\n' +
          'Or start SQLit manually: bun run sqlit',
      )
    }

    // Check and run migrations
    const databaseId = getSQLitDatabaseId() ?? 'eliza'
    const migrated = await checkMigrationStatus(sqlit, databaseId)
    if (!migrated) {
      logger.info({ src: 'plugin:sqlit' }, 'Running SQLit schema migrations...')
      await runSQLitMigrations(sqlit, databaseId)
    }

    // Create and register the adapter
    const adapter = createSQLitAdapter(runtime.agentId)
    runtime.registerDatabaseAdapter(adapter)

    logger.info(
      { src: 'plugin:sqlit', agentId: runtime.agentId, databaseId },
      'SQLit database adapter registered',
    )
  },
}

export default sqlitDatabasePlugin
