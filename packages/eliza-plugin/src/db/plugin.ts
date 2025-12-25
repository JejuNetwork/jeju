/**
 * CQL Database Plugin for ElizaOS
 *
 * Provides a decentralized database adapter using CovenantSQL.
 * Automatically initializes and runs migrations on startup.
 *
 * @example
 * ```typescript
 * import { cqlDatabasePlugin } from '@jejunetwork/eliza-plugin';
 *
 * const character: Character = {
 *   name: 'MyAgent',
 *   plugins: [cqlDatabasePlugin],
 *   // ...
 * };
 * ```
 */

import { type IAgentRuntime, logger, type Plugin } from '@elizaos/core'
import { getCQL } from '@jejunetwork/db'
import { CQLDatabaseAdapter } from './adapter'
import { checkMigrationStatus, runCQLMigrations } from './migrations'

/**
 * Create a CQL database adapter for the given agent
 */
function createCQLAdapter(agentId: string): CQLDatabaseAdapter {
  const databaseId = process.env.CQL_DATABASE_ID ?? 'eliza'
  return new CQLDatabaseAdapter(
    agentId as `${string}-${string}-${string}-${string}-${string}`,
    {
      databaseId,
      autoMigrate: true,
    },
  )
}

/**
 * CQL Database Plugin for ElizaOS
 *
 * This plugin provides:
 * - CovenantSQL-based database adapter
 * - Automatic schema migration on startup
 */
export const cqlDatabasePlugin: Plugin = {
  name: '@jejunetwork/plugin-cql',
  description: 'Decentralized database adapter using CovenantSQL',
  priority: 0, // Load first to ensure database is available

  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    logger.info(
      { src: 'plugin:cql', agentId: runtime.agentId },
      'Initializing CQL database plugin',
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
        { src: 'plugin:cql', agentId: runtime.agentId },
        'Database adapter already registered, skipping CQL initialization',
      )
      return
    }

    // Check CQL health
    const cql = getCQL()
    const healthy = await cql.isHealthy()
    if (!healthy) {
      throw new Error(
        '[CQL] CovenantSQL is not healthy. ' +
          'Ensure Jeju services are running: cd /path/to/jeju && bun jeju dev\n' +
          'Or start CQL manually: bun run cql',
      )
    }

    // Check and run migrations
    const databaseId = process.env.CQL_DATABASE_ID ?? 'eliza'
    const migrated = await checkMigrationStatus(cql, databaseId)
    if (!migrated) {
      logger.info({ src: 'plugin:cql' }, 'Running CQL schema migrations...')
      await runCQLMigrations(cql, databaseId)
    }

    // Create and register the adapter
    const adapter = createCQLAdapter(runtime.agentId)
    runtime.registerDatabaseAdapter(adapter)

    logger.info(
      { src: 'plugin:cql', agentId: runtime.agentId, databaseId },
      'CQL database adapter registered',
    )
  },
}

export default cqlDatabasePlugin
