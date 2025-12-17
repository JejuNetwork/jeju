/**
 * Mock CQL Server for Local Development
 * 
 * Provides a CQL-compatible HTTP API backed by SQLite.
 * Starts automatically when CQL is unavailable in localnet.
 * 
 * Usage: bun run packages/db/src/mock-cql-server.ts
 */

import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const PORT = parseInt(process.env.CQL_PORT ?? '4661');
const DATA_DIR = process.env.CQL_DATA_DIR ?? '.cql-data';

// Ensure data directory exists
await Bun.write(`${DATA_DIR}/.gitkeep`, '');

const app = new Hono();
app.use('/*', cors({ origin: '*' }));

// Database instances per database ID
const databases = new Map<string, Database>();

function getDb(databaseId: string): Database {
  let db = databases.get(databaseId);
  if (!db) {
    const dbPath = `${DATA_DIR}/${databaseId}.sqlite`;
    db = new Database(dbPath, { create: true });
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
    databases.set(databaseId, db);
    console.log(`[CQL Mock] Created database: ${databaseId} at ${dbPath}`);
  }
  return db;
}

// Health check
app.get('/v1/health', (c) => c.json({ status: 'healthy', mode: 'mock-sqlite' }));
app.get('/health', (c) => c.json({ status: 'healthy', mode: 'mock-sqlite' }));

// Query endpoint
app.post('/v1/query', async (c) => {
  const body = await c.req.json<{ database_id: string; query: string; params?: (string | number | null)[] }>();
  const { database_id, query, params = [] } = body;
  
  const db = getDb(database_id);
  const start = performance.now();
  
  try {
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    const executionTime = Math.round(performance.now() - start);
    
    return c.json({
      success: true,
      rows,
      rowCount: rows.length,
      columns: rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [],
      executionTime,
      blockHeight: 0,
    });
  } catch (error) {
    const err = error as Error;
    return c.json({ success: false, error: err.message }, 400);
  }
});

// Execute endpoint (for INSERT, UPDATE, DELETE, CREATE, etc.)
app.post('/v1/exec', async (c) => {
  const body = await c.req.json<{ database_id: string; query: string; params?: (string | number | null)[] }>();
  const { database_id, query, params = [] } = body;
  
  const db = getDb(database_id);
  const start = performance.now();
  
  try {
    const stmt = db.prepare(query);
    const result = stmt.run(...params);
    const executionTime = Math.round(performance.now() - start);
    
    return c.json({
      success: true,
      rowsAffected: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
      executionTime,
      blockHeight: 0,
    });
  } catch (error) {
    const err = error as Error;
    return c.json({ success: false, error: err.message }, 400);
  }
});

// Database info
app.get('/v1/databases/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb(id);
  
  // Get table count
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  
  return c.json({
    databaseId: id,
    status: 'active',
    tables: tables.length,
    mode: 'mock-sqlite',
  });
});

// List databases
app.get('/v1/databases', (c) => {
  const dbs = Array.from(databases.keys()).map(id => ({
    databaseId: id,
    status: 'active',
  }));
  return c.json({ databases: dbs });
});

// Create database (no-op in SQLite mode, just ensures it exists)
app.post('/v1/databases', async (c) => {
  const body = await c.req.json<{ database_id: string }>();
  getDb(body.database_id);
  return c.json({ success: true, databaseId: body.database_id });
});

console.log(`
╔════════════════════════════════════════════════════════════╗
║              CQL Mock Server (SQLite Backend)              ║
╠════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                               ║
║  Data: ${DATA_DIR}/                                          ║
║  Mode: Development (SQLite)                                ║
║                                                            ║
║  This provides a CQL-compatible API for local development. ║
║  Data persists in .cql-data/ directory.                    ║
╚════════════════════════════════════════════════════════════╝
`);

export default {
  port: PORT,
  fetch: app.fetch,
};
