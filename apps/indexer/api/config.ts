import { createAppConfig, getEnvNumber, getEnvVar, isProductionEnv } from '@jejunetwork/config'

export interface IndexerConfig {
  // Database
  dbHost: string
  dbPort: number
  dbName: string
  dbUser: string
  dbPass: string
  dbPoolSize: number
  dbConnectTimeout: number
  dbIdleTimeout: number
  dbLogging: boolean

  // EQLite Sync
  eqliteSyncEnabled: boolean
  eqliteDatabaseId: string
  eqliteSyncInterval: number
  eqliteSyncBatchSize: number

  // Chain
  chainId: number
  rpcEthHttp: string
  startBlock: number

  // Server
  port: number
  restPort: number
  mcpPort: number
  a2aPort: number
  isProduction: boolean

  // Security
  logLevel: string

  // Indexer mode
  indexerMode: string
}

const { config, configure: setIndexerConfig } = createAppConfig<IndexerConfig>({
  // Database - defaults for development
  dbHost: getEnvVar('DB_HOST') ?? 'localhost',
  dbPort: getEnvNumber('DB_PORT') ?? 23798,
  dbName: getEnvVar('DB_NAME') ?? 'indexer',
  dbUser: getEnvVar('DB_USER') ?? 'postgres',
  dbPass: getEnvVar('DB_PASS') ?? 'postgres',
  dbPoolSize: getEnvNumber('DB_POOL_SIZE') ?? 10,
  dbConnectTimeout: getEnvNumber('DB_CONNECT_TIMEOUT') ?? 10000,
  dbIdleTimeout: getEnvNumber('DB_IDLE_TIMEOUT') ?? 30000,
  dbLogging: getEnvVar('DB_LOGGING') === 'true',

  // EQLite Sync
  eqliteSyncEnabled: getEnvVar('EQLITE_SYNC_ENABLED') === 'true',
  eqliteDatabaseId: getEnvVar('EQLITE_DATABASE_ID') ?? 'indexer-sync',
  eqliteSyncInterval: getEnvNumber('EQLITE_SYNC_INTERVAL') ?? 30000,
  eqliteSyncBatchSize: getEnvNumber('EQLITE_SYNC_BATCH_SIZE') ?? 1000,

  // Chain
  chainId: getEnvNumber('CHAIN_ID') ?? 420691,
  rpcEthHttp: getEnvVar('RPC_ETH_HTTP') ?? '',
  startBlock: getEnvNumber('START_BLOCK') ?? 0,

  // Server
  port: getEnvNumber('PORT') ?? 4000,
  restPort: getEnvNumber('REST_PORT') ?? 4001,
  mcpPort: getEnvNumber('MCP_PORT') ?? 4002,
  a2aPort: getEnvNumber('A2A_PORT') ?? 4003,
  isProduction: isProductionEnv(),

  // Security
  logLevel: getEnvVar('LOG_LEVEL') ?? 'info',

  // Indexer mode
  indexerMode: getEnvVar('INDEXER_MODE') ?? 'postgres',
})

export { config }
export function configureIndexer(updates: Partial<IndexerConfig>): void {
  setIndexerConfig(updates)
}
