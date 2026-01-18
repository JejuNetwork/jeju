import {
  createAppConfig,
  getEnvNumber,
  getEnvVar,
  getIpfsGatewayUrl,
  getL2RpcUrl,
  isProductionEnv,
} from '@jejunetwork/config'

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

  // SQLit Sync
  sqlitSyncEnabled: boolean
  sqlitDatabaseId: string
  sqlitSyncInterval: number
  sqlitSyncBatchSize: number

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
  corsOrigins: string[]

  // Indexer mode
  indexerMode: string

  // Staking
  stakingAddress?: string
  ethUsdPrice: number

  // IPFS
  ipfsGateway: string
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

  // SQLit Sync
  sqlitSyncEnabled: getEnvVar('SQLIT_SYNC_ENABLED') === 'true',
  sqlitDatabaseId: getEnvVar('SQLIT_DATABASE_ID') ?? 'indexer-sync',
  sqlitSyncInterval: getEnvNumber('SQLIT_SYNC_INTERVAL') ?? 30000,
  sqlitSyncBatchSize: getEnvNumber('SQLIT_SYNC_BATCH_SIZE') ?? 1000,

  // Chain
  chainId: getEnvNumber('CHAIN_ID') ?? 420691,
  rpcEthHttp: getEnvVar('RPC_ETH_HTTP') ?? getL2RpcUrl(),
  startBlock: getEnvNumber('START_BLOCK') ?? 0,

  // Server
  port: getEnvNumber('PORT') ?? 4350,
  restPort: getEnvNumber('REST_PORT') ?? 4352,
  mcpPort: getEnvNumber('MCP_PORT') ?? 4353,
  a2aPort: getEnvNumber('A2A_PORT') ?? 4351,
  isProduction: isProductionEnv(),

  // Security
  logLevel: getEnvVar('LOG_LEVEL') ?? 'info',
  corsOrigins: (getEnvVar('CORS_ORIGINS') ?? '').split(',').filter(Boolean),

  // Indexer mode
  indexerMode: getEnvVar('INDEXER_MODE') ?? 'postgres',

  // Staking
  stakingAddress: getEnvVar('INDEXER_STAKING_ADDRESS'),
  ethUsdPrice: getEnvNumber('ETH_USD_PRICE') ?? 2000,

  // IPFS - use gateway URL from config, fallback to localhost for local dev
  ipfsGateway:
    getEnvVar('IPFS_GATEWAY') ??
    getIpfsGatewayUrl() ??
    'http://127.0.0.1:4030/cdn',
})

export { config }
export function configureIndexer(updates: Partial<IndexerConfig>): void {
  setIndexerConfig(updates)
}
