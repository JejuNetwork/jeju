import { DataSource, DefaultNamingStrategy } from 'typeorm'
import { config } from '../config'
import * as models from '../model'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const IS_PRODUCTION = config.isProduction
const IS_CQL_ONLY_MODE = config.indexerMode === 'cql-only'

function parsePort(portStr: string, defaultPort: number): number {
  const port = parseInt(portStr, 10)
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    return defaultPort
  }
  return port
}

function parsePositiveInt(
  value: string,
  defaultValue: number,
  name: string,
): number {
  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    if (value !== undefined && value !== '') {
      console.warn(`Invalid ${name}: ${value}. Using default: ${defaultValue}`)
    }
    return defaultValue
  }
  return parsed
}

function getDBConfig(): {
  host: string
  port: number
  database: string
  username: string
  password: string
} {
  if (IS_CQL_ONLY_MODE) {
    // Return dummy config - won't be used but needed for TypeORM initialization
    return {
      host: 'localhost',
      port: 5432,
      database: 'indexer',
      username: 'postgres',
      password: 'postgres',
    }
  }

  // In production, require all DB config; in dev use config defaults
  if (IS_PRODUCTION) {
    if (!config.dbHost) throw new Error('DB_HOST required in production')
    if (!config.dbName) throw new Error('DB_NAME required in production')
    if (!config.dbUser) throw new Error('DB_USER required in production')
    if (!config.dbPass) throw new Error('DB_PASS required in production')
  }

  return {
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    username: config.dbUser,
    password: config.dbPass,
  }
}

const POOL_CONFIG = {
  poolSize: config.dbPoolSize,
  connectionTimeoutMillis: config.dbConnectTimeout,
  idleTimeoutMillis: config.dbIdleTimeout,
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

class SnakeNamingStrategy extends DefaultNamingStrategy {
  tableName(className: string, customName?: string) {
    return customName || toSnakeCase(className)
  }
  columnName(
    propertyName: string,
    customName?: string,
    prefixes: string[] = [],
  ) {
    return (
      toSnakeCase(prefixes.join('_')) +
      (customName || toSnakeCase(propertyName))
    )
  }
  relationName(propertyName: string) {
    return toSnakeCase(propertyName)
  }
  joinColumnName(relationName: string, referencedColumnName: string) {
    return toSnakeCase(`${relationName}_${referencedColumnName}`)
  }
  joinTableName(firstTableName: string, secondTableName: string) {
    return toSnakeCase(`${firstTableName}_${secondTableName}`)
  }
  joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ) {
    return `${toSnakeCase(tableName)}_${columnName || toSnakeCase(propertyName)}`
  }
}

let dataSource: DataSource | null = null
let postgresAvailable = false
let schemaVerified = false

/**
 * Get the database mode the indexer is running in
 */
export function getIndexerMode(): 'postgres' | 'cql-only' | 'unavailable' {
  if (IS_CQL_ONLY_MODE) return 'cql-only'
  if (postgresAvailable) return 'postgres'
  return 'unavailable'
}

/**
 * Check if PostgreSQL is available
 */
export function isPostgresAvailable(): boolean {
  return postgresAvailable && dataSource?.isInitialized === true
}

/**
 * Check if database schema has been verified as ready
 */
export function isSchemaReady(): boolean {
  return schemaVerified
}

/**
 * Mark schema as verified (called after verifyDatabaseSchema succeeds)
 */
export function setSchemaVerified(verified: boolean): void {
  schemaVerified = verified
}

/**
 * Initialize and return the DataSource connection.
 * In CQL-only mode, returns null without attempting PostgreSQL connection.
 */
export async function getDataSource(): Promise<DataSource | null> {
  if (IS_CQL_ONLY_MODE) return null
  if (dataSource?.isInitialized) return dataSource

  const entities = Object.values(models).filter(
    (v): boolean =>
      typeof v === 'function' && v.prototype.constructor !== undefined,
  ) as (new (
    ...args: never[]
  ) => object)[]

  const dbConfig = getDBConfig()

  dataSource = new DataSource({
    type: 'postgres',
    ...dbConfig,
    entities,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: config.dbLogging,
    extra: {
      max: POOL_CONFIG.poolSize,
      connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
      idleTimeoutMillis: POOL_CONFIG.idleTimeoutMillis,
    },
  })

  await dataSource.initialize()
  postgresAvailable = true
  console.log(
    `[DB] Connected: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
  )
  return dataSource
}

/**
 * Connect to PostgreSQL with retry logic.
 * Returns DataSource if successful, null if all retries fail.
 */
export async function getDataSourceWithRetry(
  maxRetries = 3,
  retryDelayMs = 2000,
): Promise<DataSource | null> {
  if (IS_CQL_ONLY_MODE) {
    console.log('[DB] CQL-only mode - PostgreSQL disabled')
    return null
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await getDataSource()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[DB] Attempt ${attempt}/${maxRetries} failed: ${message}`)
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs))
      }
    }
  }

  console.error('[DB] All connection attempts failed')
  postgresAvailable = false
  return null
}

export async function closeDataSource(): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.destroy()
    dataSource = null
    postgresAvailable = false
  }
}

/**
 * Verify the database schema exists by checking for required tables.
 * Returns true if schema is ready, false if tables are missing.
 */
export async function verifyDatabaseSchema(ds: DataSource): Promise<boolean> {
  const requiredTables = ['block', 'transaction', 'registered_agent', 'account']

  try {
    for (const table of requiredTables) {
      const result = await ds.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        )`,
        [table],
      )
      const exists = result[0]?.exists === true
      if (!exists) {
        console.warn(`[DB] Required table missing: ${table}`)
        return false
      }
    }
    console.log('[DB] Database schema verified')
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[DB] Schema verification failed: ${message}`)
    return false
  }
}

export { DataSource }
