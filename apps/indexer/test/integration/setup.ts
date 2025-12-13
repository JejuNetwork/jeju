import { DataSource } from 'typeorm';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || '23798'),
  database: process.env.TEST_DB_NAME || 'indexer_test',
  username: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASS || 'postgres',
};

let testDataSource: DataSource | null = null;

export async function getTestDataSource(): Promise<DataSource> {
  if (testDataSource?.isInitialized) return testDataSource;

  const models = await import('../../src/model');
  const entities = Object.values(models).filter(
    (v): boolean => typeof v === 'function' && v.prototype?.constructor !== undefined
  ) as Function[];

  testDataSource = new DataSource({
    type: 'postgres',
    ...TEST_DB_CONFIG,
    entities,
    synchronize: true, // Auto-create tables for tests
    dropSchema: true, // Clean slate each time
    logging: false,
  });

  await testDataSource.initialize();
  return testDataSource;
}

export async function closeTestDataSource(): Promise<void> {
  if (testDataSource?.isInitialized) {
    await testDataSource.destroy();
    testDataSource = null;
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker ps');
    return true;
  } catch {
    return false;
  }
}

export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const ds = await getTestDataSource();
    await ds.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function skipIfNoDatabase(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const available = await isDatabaseAvailable();
    if (!available) {
      console.log('⏭️ Skipping: Database not available');
      return;
    }
    await fn();
  };
}
