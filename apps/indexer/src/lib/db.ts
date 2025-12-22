import { DataSource, DefaultNamingStrategy } from 'typeorm'
import * as models from '../model'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

function parsePort(portStr: string, _defaultPort: number): number {
  const port = parseInt(portStr, 10)
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${portStr}. Must be between 1 and 65535.`)
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
      throw new Error(`Invalid ${name}: ${value}. Must be a positive integer.`)
    }
    return defaultValue
  }
  return parsed
}

const DB_CONFIG = {
  host: IS_PRODUCTION
    ? requireEnv('DB_HOST')
    : process.env.DB_HOST || 'localhost',
  port: IS_PRODUCTION
    ? parsePort(requireEnv('DB_PORT'), 23798)
    : parsePort(process.env.DB_PORT || '23798', 23798),
  database: IS_PRODUCTION
    ? requireEnv('DB_NAME')
    : process.env.DB_NAME || 'indexer',
  username: IS_PRODUCTION
    ? requireEnv('DB_USER')
    : process.env.DB_USER || 'postgres',
  password: IS_PRODUCTION
    ? requireEnv('DB_PASS')
    : process.env.DB_PASS || 'postgres',
}

const POOL_CONFIG = {
  poolSize: parsePositiveInt(
    process.env.DB_POOL_SIZE || '10',
    10,
    'DB_POOL_SIZE',
  ),
  connectionTimeoutMillis: parsePositiveInt(
    process.env.DB_CONNECT_TIMEOUT || '10000',
    10000,
    'DB_CONNECT_TIMEOUT',
  ),
  idleTimeoutMillis: parsePositiveInt(
    process.env.DB_IDLE_TIMEOUT || '30000',
    30000,
    'DB_IDLE_TIMEOUT',
  ),
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

export async function getDataSource(): Promise<DataSource> {
  if (dataSource?.isInitialized) return dataSource

  const entities = Object.values(models).filter(
    (v): boolean =>
      typeof v === 'function' && v.prototype?.constructor !== undefined,
  ) as (new (
    ...args: never[]
  ) => object)[]

  dataSource = new DataSource({
    type: 'postgres',
    ...DB_CONFIG,
    entities,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: process.env.DB_LOGGING === 'true',
    extra: {
      max: POOL_CONFIG.poolSize,
      connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
      idleTimeoutMillis: POOL_CONFIG.idleTimeoutMillis,
    },
  })

  await dataSource.initialize()
  console.log(
    `Database connected: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database} (pool: ${POOL_CONFIG.poolSize})`,
  )
  return dataSource
}

export async function closeDataSource(): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.destroy()
    dataSource = null
  }
}

export { DataSource }
