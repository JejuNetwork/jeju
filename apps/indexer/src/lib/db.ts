import { DataSource, DefaultNamingStrategy } from 'typeorm';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const DB_CONFIG = {
  host: IS_PRODUCTION ? requireEnv('DB_HOST') : (process.env.DB_HOST || 'localhost'),
  port: parseInt(IS_PRODUCTION ? requireEnv('DB_PORT') : (process.env.DB_PORT || '23798')),
  database: IS_PRODUCTION ? requireEnv('DB_NAME') : (process.env.DB_NAME || 'indexer'),
  username: IS_PRODUCTION ? requireEnv('DB_USER') : (process.env.DB_USER || 'postgres'),
  password: IS_PRODUCTION ? requireEnv('DB_PASS') : (process.env.DB_PASS || 'postgres'),
};

const POOL_CONFIG = {
  poolSize: parseInt(process.env.DB_POOL_SIZE || '10'),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000'),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
};

function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

class SnakeNamingStrategy extends DefaultNamingStrategy {
  tableName(className: string, customName?: string) {
    return customName || toSnakeCase(className);
  }
  columnName(propertyName: string, customName?: string, prefixes: string[] = []) {
    return toSnakeCase(prefixes.join('_')) + (customName || toSnakeCase(propertyName));
  }
  relationName(propertyName: string) {
    return toSnakeCase(propertyName);
  }
  joinColumnName(relationName: string, referencedColumnName: string) {
    return toSnakeCase(`${relationName}_${referencedColumnName}`);
  }
  joinTableName(firstTableName: string, secondTableName: string) {
    return toSnakeCase(`${firstTableName}_${secondTableName}`);
  }
  joinTableColumnName(tableName: string, propertyName: string, columnName?: string) {
    return `${toSnakeCase(tableName)}_${columnName || toSnakeCase(propertyName)}`;
  }
}

let dataSource: DataSource | null = null;

export async function getDataSource(): Promise<DataSource> {
  if (dataSource?.isInitialized) return dataSource;

  const models = await import('../model');
  const entities = Object.values(models).filter(
    (v): boolean => typeof v === 'function' && v.prototype?.constructor !== undefined
  ) as Function[];

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
  });

  await dataSource.initialize();
  console.log(`Database connected: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database} (pool: ${POOL_CONFIG.poolSize})`);
  return dataSource;
}

export async function closeDataSource(): Promise<void> {
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
    dataSource = null;
  }
}

export { DataSource };
