import { DataSource, DefaultNamingStrategy } from 'typeorm';

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const DB_CONFIG = {
  host: requireEnv('DB_HOST', IS_PRODUCTION ? undefined : 'localhost'),
  port: parseInt(requireEnv('DB_PORT', IS_PRODUCTION ? undefined : '23798')),
  database: requireEnv('DB_NAME', IS_PRODUCTION ? undefined : 'indexer'),
  username: requireEnv('DB_USER', IS_PRODUCTION ? undefined : 'postgres'),
  password: requireEnv('DB_PASS', IS_PRODUCTION ? undefined : 'postgres'),
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
