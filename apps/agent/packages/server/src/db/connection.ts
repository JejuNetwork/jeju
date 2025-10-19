import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { logger } from '@elizaos/core';
import * as schema from './schema';

export type DatabaseConnection = ReturnType<typeof drizzle> | ReturnType<typeof drizzlePglite>;

interface ConnectionOptions {
  postgresUrl?: string;
  dataDir?: string;
}

let db: DatabaseConnection | null = null;
let pgPool: Pool | null = null;
let pgliteConnection: PGlite | null = null;

export async function createDatabaseConnection(
  options: ConnectionOptions
): Promise<DatabaseConnection> {
  if (db) {
    return db;
  }

  if (options.postgresUrl) {
    // PostgreSQL connection
    logger.info('[MessageDB] Connecting to PostgreSQL database...');
    pgPool = new Pool({
      connectionString: options.postgresUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    });

    db = drizzle(pgPool, { schema });
    logger.success('[MessageDB] Connected to PostgreSQL database');
  } else {
    // PGLite connection (default)
    const dataDir = options.dataDir || '.eliza/message-server/db';
    logger.info(`[MessageDB] Initializing PGLite database at: ${dataDir}`);

    pgliteConnection = new PGlite(dataDir);
    await pgliteConnection.waitReady;

    db = drizzlePglite(pgliteConnection, { schema });
    logger.success('[MessageDB] PGLite database initialized');
  }

  return db;
}

export function getDatabase(): DatabaseConnection {
  if (!db) {
    throw new Error('Database not initialized. Call createDatabaseConnection first.');
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }

  if (pgliteConnection) {
    await pgliteConnection.close();
    pgliteConnection = null;
  }

  db = null;
  logger.info('[MessageDB] Database connection closed');
}
