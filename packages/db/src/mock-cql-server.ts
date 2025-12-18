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
import type { Context } from 'hono';

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
function handleHealth(c: Context) {
  return c.json({ status: 'healthy', mode: 'mock-sqlite' });
}
app.get('/v1/health', handleHealth);
app.get('/api/v1/health', handleHealth);
app.get('/health', handleHealth);

// Status endpoint
function handleStatus(c: Context) {
  return c.json({ 
    status: 'healthy', 
    mode: 'mock-sqlite',
    blockHeight: 0,
    version: '1.0.0-mock',
  });
}
app.get('/v1/status', handleStatus);
app.get('/api/v1/status', handleStatus);

// Combined query/exec handler - CQL client sends both to same endpoint
interface CQLRequest {
  database?: string;  // CQL client uses 'database'
  database_id?: string;  // Legacy format
  type?: 'query' | 'exec';  // CQL client specifies type
  query?: string;  // Legacy format
  sql?: string;  // CQL client uses 'sql'
  params?: (string | number | null | boolean)[];
}

async function handleCQLQuery(c: Context) {
  const body = await c.req.json<CQLRequest>();
  
  // Support both formats
  const databaseId = body.database ?? body.database_id ?? 'default';
  const sql = body.sql ?? body.query ?? '';
  const params = body.params ?? [];
  const isExec = body.type === 'exec' || sql.trim().toUpperCase().match(/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/);
  
  const db = getDb(databaseId);
  const start = performance.now();
  
  try {
    const stmt = db.prepare(sql);
    
    if (isExec) {
      const result = stmt.run(...params);
      const executionTime = Math.round(performance.now() - start);
      
      return c.json({
        success: true,
        rowsAffected: result.changes,
        lastInsertRowid: Number(result.lastInsertRowid),
        executionTime,
        blockHeight: 0,
      });
    } else {
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
    }
  } catch (error) {
    const err = error as Error;
    console.error(`[CQL Mock] Error executing SQL: ${sql}`, err.message);
    return c.json({ success: false, error: err.message }, 400);
  }
}

// Mount on all possible endpoints
app.post('/v1/query', handleCQLQuery);
app.post('/api/v1/query', handleCQLQuery);
app.post('/v1/exec', handleCQLQuery);
app.post('/api/v1/exec', handleCQLQuery);

// Database info
function handleDbInfo(c: Context) {
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
}
app.get('/v1/databases/:id', handleDbInfo);
app.get('/api/v1/databases/:id', handleDbInfo);

// List databases
function handleListDbs(c: Context) {
  const dbs = Array.from(databases.keys()).map(id => ({
    databaseId: id,
    status: 'active',
  }));
  return c.json({ databases: dbs });
}
app.get('/v1/databases', handleListDbs);
app.get('/api/v1/databases', handleListDbs);

// Create database (no-op in SQLite mode, just ensures it exists)
async function handleCreateDb(c: Context) {
  const body = await c.req.json<{ database_id: string }>();
  getDb(body.database_id);
  return c.json({ success: true, databaseId: body.database_id });
}
app.post('/v1/databases', handleCreateDb);
app.post('/api/v1/databases', handleCreateDb);

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
