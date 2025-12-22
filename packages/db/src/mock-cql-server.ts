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
import { z } from 'zod';
import { parsePort } from './utils.js';

const DEFAULT_PORT = 4661;
const DEFAULT_DATA_DIR = '.cql-data';

const PORT = parsePort(process.env.CQL_PORT, DEFAULT_PORT);
const DATA_DIR = process.env.CQL_DATA_DIR ?? DEFAULT_DATA_DIR;

// Request validation schema
const CQLRequestSchema = z.object({
  database: z.string().optional(),
  database_id: z.string().optional(),
  type: z.enum(['query', 'exec']).optional(),
  query: z.string().optional(),
  sql: z.string().optional(),
  params: z.array(z.union([z.string(), z.number(), z.null(), z.boolean()])).optional(),
}).refine(data => data.database ?? data.database_id, {
  message: 'Either database or database_id is required',
}).refine(data => data.sql ?? data.query, {
  message: 'Either sql or query is required',
});

// Ensure data directory exists
await Bun.write(`${DATA_DIR}/.gitkeep`, '');

const app = new Hono();
app.use('/*', cors({ origin: '*' }));

// Database instances per database ID
const databases = new Map<string, Database>();

function getDb(databaseId: string): Database {
  const existing = databases.get(databaseId);
  if (existing) {
    return existing;
  }
  const dbPath = `${DATA_DIR}/${databaseId}.sqlite`;
  const db = new Database(dbPath, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  databases.set(databaseId, db);
  console.log(`[CQL Mock] Created database: ${databaseId} at ${dbPath}`);
  return db;
}

// Health check
function handleHealth(c: Context): Response {
  return c.json({ status: 'healthy', mode: 'mock-sqlite' });
}
app.get('/v1/health', handleHealth);
app.get('/api/v1/health', handleHealth);
app.get('/health', handleHealth);

// Status endpoint
function handleStatus(c: Context): Response {
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
async function handleCQLQuery(c: Context): Promise<Response> {
  const rawBody = await c.req.json();
  const parseResult = CQLRequestSchema.safeParse(rawBody);
  
  if (!parseResult.success) {
    return c.json({ success: false, error: parseResult.error.message }, 400);
  }
  
  const body = parseResult.data;
  // Both are guaranteed by the refine validators
  const databaseId = (body.database ?? body.database_id) as string;
  const sql = (body.sql ?? body.query) as string;
  const params = body.params ?? [];
  const isExec = body.type === 'exec' || sql.trim().toUpperCase().match(/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/);
  
  const db = getDb(databaseId);
  const start = performance.now();
  
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
}

// Mount on all possible endpoints
app.post('/v1/query', handleCQLQuery);
app.post('/api/v1/query', handleCQLQuery);
app.post('/v1/exec', handleCQLQuery);
app.post('/api/v1/exec', handleCQLQuery);

// Database info
function handleDbInfo(c: Context): Response {
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
function handleListDbs(c: Context): Response {
  const dbs = Array.from(databases.keys()).map(id => ({
    databaseId: id,
    status: 'active',
  }));
  return c.json({ databases: dbs });
}
app.get('/v1/databases', handleListDbs);
app.get('/api/v1/databases', handleListDbs);

// Create database (no-op in SQLite mode, just ensures it exists)
const CreateDbSchema = z.object({
  database_id: z.string().min(1),
});

async function handleCreateDb(c: Context): Promise<Response> {
  const rawBody = await c.req.json();
  const body = CreateDbSchema.parse(rawBody);
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
