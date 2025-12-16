/**
 * Local CQL Development Server
 * 
 * SQLite-backed server implementing the CQL block producer API for local development.
 * This provides a real database instead of a mock.
 */

import { Database as SQLiteDatabase } from 'bun:sqlite';
import { mkdir, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { Address, Hex } from 'viem';

interface DatabaseRecord {
  id: string;
  owner: Address;
  schema: string;
  nodeCount: number;
  createdAt: number;
  status: 'active' | 'suspended' | 'deleted';
}

interface CQLServerConfig {
  port: number;
  dataDir: string;
  debug?: boolean;
}

export class CQLServer {
  private databases = new Map<string, SQLiteDatabase>();
  private registry: SQLiteDatabase;
  private config: CQLServerConfig;
  private blockHeight = 0;
  private server?: ReturnType<typeof Bun.serve>;

  constructor(config: CQLServerConfig) {
    this.config = config;
    
    // Ensure data directory exists
    if (!existsSync(config.dataDir)) {
      mkdir(config.dataDir, { recursive: true }, () => {});
    }

    // Initialize registry database (tracks all databases)
    const registryPath = join(config.dataDir, '_registry.sqlite');
    this.registry = new SQLiteDatabase(registryPath);
    this.initRegistry();
    
    // Load existing databases
    this.loadDatabases();
  }

  private initRegistry(): void {
    this.registry.exec(`
      CREATE TABLE IF NOT EXISTS databases (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        schema TEXT,
        node_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      );
      
      CREATE TABLE IF NOT EXISTS acl (
        database_id TEXT NOT NULL,
        address TEXT NOT NULL,
        permissions TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (database_id, address)
      );
      
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        tx_count INTEGER DEFAULT 0,
        hash TEXT
      );
    `);
    
    // Get current block height
    const result = this.registry.query<{ height: number }>('SELECT MAX(height) as height FROM blocks').get();
    this.blockHeight = result?.height || 0;
    
    // Add genesis block if needed
    if (this.blockHeight === 0) {
      this.registry.run(
        'INSERT OR IGNORE INTO blocks (height, timestamp, tx_count, hash) VALUES (?, ?, ?, ?)',
        [0, Date.now(), 0, '0x' + '0'.repeat(64)]
      );
    }
  }

  private loadDatabases(): void {
    const dbs = this.registry.query<DatabaseRecord>('SELECT * FROM databases WHERE status = ?').all('active');
    for (const db of dbs) {
      this.openDatabase(db.id);
    }
    if (this.config.debug) {
      console.log(`[CQL] Loaded ${dbs.length} databases`);
    }
  }

  private openDatabase(id: string): SQLiteDatabase {
    let db = this.databases.get(id);
    if (!db) {
      const dbPath = join(this.config.dataDir, `${id}.sqlite`);
      db = new SQLiteDatabase(dbPath);
      this.databases.set(id, db);
    }
    return db;
  }

  private addBlock(txCount = 1): number {
    this.blockHeight++;
    const hash = '0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    this.registry.run(
      'INSERT INTO blocks (height, timestamp, tx_count, hash) VALUES (?, ?, ?, ?)',
      [this.blockHeight, Date.now(), txCount, hash]
    );
    return this.blockHeight;
  }

  start(): void {
    const self = this;
    
    this.server = Bun.serve({
      port: this.config.port,
      
      async fetch(req): Promise<Response> {
        const url = new URL(req.url);
        const method = req.method;

        // Health check
        if (url.pathname === '/health') {
          return Response.json({
            status: 'ok',
            type: 'sqlite',
            blockHeight: self.blockHeight,
            databases: self.databases.size,
            dataDir: self.config.dataDir,
          });
        }

        // Block producer status
        if (url.pathname === '/api/v1/status') {
          return Response.json({
            blockHeight: self.blockHeight,
            nodeCount: 1,
            status: 'running',
            type: 'sqlite-dev',
            databases: self.databases.size,
          });
        }

        // Query/Exec endpoint
        if (url.pathname === '/api/v1/query' && method === 'POST') {
          const body = await req.json() as {
            database: string;
            type: 'query' | 'exec';
            sql: string;
            params?: (string | number | boolean | null)[];
          };

          const { database: dbId, type, sql, params } = body;
          
          // Get or create database
          let db = self.databases.get(dbId);
          if (!db) {
            // Auto-create database for development convenience
            db = self.openDatabase(dbId);
            self.registry.run(
              'INSERT OR IGNORE INTO databases (id, owner, created_at) VALUES (?, ?, ?)',
              [dbId, '0x0000000000000000000000000000000000000000', Date.now()]
            );
          }

          const startTime = Date.now();
          
          if (type === 'query') {
            const stmt = db.query(sql);
            const rows = params ? stmt.all(...params) : stmt.all();
            const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
            
            return Response.json({
              rows,
              rowCount: rows.length,
              columns,
              executionTime: Date.now() - startTime,
              blockHeight: self.blockHeight,
            });
          } else {
            const stmt = db.prepare(sql);
            const result = params ? stmt.run(...params) : stmt.run();
            const height = self.addBlock();
            const txHash = '0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
            
            return Response.json({
              rowsAffected: result.changes,
              lastInsertId: result.lastInsertRowid?.toString(),
              txHash,
              blockHeight: height,
              gasUsed: '21000',
            });
          }
        }

        // Create database
        if (url.pathname === '/api/v1/databases' && method === 'POST') {
          const body = await req.json() as {
            nodeCount?: number;
            schema?: string;
            owner?: string;
          };
          
          const id = `db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const owner = body.owner || '0x0000000000000000000000000000000000000000';
          
          self.registry.run(
            'INSERT INTO databases (id, owner, schema, node_count, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, owner, body.schema || '', body.nodeCount || 1, Date.now()]
          );
          
          const db = self.openDatabase(id);
          
          // Execute schema if provided
          if (body.schema) {
            const statements = body.schema.split(';').filter((s: string) => s.trim());
            for (const stmt of statements) {
              db.exec(stmt);
            }
          }
          
          self.addBlock();
          
          return Response.json({
            id,
            owner,
            nodeCount: body.nodeCount || 1,
            status: 'active',
            createdAt: Date.now(),
          });
        }

        // List databases
        if (url.pathname === '/api/v1/databases' && method === 'GET') {
          const owner = url.searchParams.get('owner');
          let dbs: DatabaseRecord[];
          
          if (owner) {
            dbs = self.registry.query<DatabaseRecord>(
              'SELECT * FROM databases WHERE owner = ? AND status = ?'
            ).all(owner, 'active');
          } else {
            dbs = self.registry.query<DatabaseRecord>(
              'SELECT * FROM databases WHERE status = ?'
            ).all('active');
          }
          
          return Response.json({
            databases: dbs.map(d => ({
              id: d.id,
              owner: d.owner,
              nodeCount: d.nodeCount,
              status: d.status,
              createdAt: d.createdAt,
            })),
          });
        }

        // Get database
        const dbMatch = url.pathname.match(/^\/api\/v1\/databases\/([^/]+)$/);
        if (dbMatch && method === 'GET') {
          const dbId = dbMatch[1];
          const db = self.registry.query<DatabaseRecord>(
            'SELECT * FROM databases WHERE id = ?'
          ).get(dbId);
          
          if (!db) {
            return Response.json({ error: 'Database not found' }, { status: 404 });
          }
          
          return Response.json({
            id: db.id,
            owner: db.owner,
            nodeCount: db.nodeCount,
            status: db.status,
            createdAt: db.createdAt,
          });
        }

        // Delete database
        if (dbMatch && method === 'DELETE') {
          const dbId = dbMatch[1];
          self.registry.run('UPDATE databases SET status = ? WHERE id = ?', ['deleted', dbId]);
          self.databases.get(dbId)?.close();
          self.databases.delete(dbId);
          self.addBlock();
          return new Response(null, { status: 204 });
        }

        // ACL - Grant
        const aclGrantMatch = url.pathname.match(/^\/api\/v1\/databases\/([^/]+)\/acl\/grant$/);
        if (aclGrantMatch && method === 'POST') {
          const dbId = aclGrantMatch[1];
          const body = await req.json() as { address: string; permissions: string[] };
          
          self.registry.run(
            'INSERT OR REPLACE INTO acl (database_id, address, permissions, created_at) VALUES (?, ?, ?, ?)',
            [dbId, body.address, JSON.stringify(body.permissions), Date.now()]
          );
          self.addBlock();
          
          return Response.json({ success: true });
        }

        // ACL - Revoke
        const aclRevokeMatch = url.pathname.match(/^\/api\/v1\/databases\/([^/]+)\/acl\/revoke$/);
        if (aclRevokeMatch && method === 'POST') {
          const dbId = aclRevokeMatch[1];
          const body = await req.json() as { address: string };
          
          self.registry.run(
            'DELETE FROM acl WHERE database_id = ? AND address = ?',
            [dbId, body.address]
          );
          self.addBlock();
          
          return Response.json({ success: true });
        }

        // ACL - List
        const aclListMatch = url.pathname.match(/^\/api\/v1\/databases\/([^/]+)\/acl$/);
        if (aclListMatch && method === 'GET') {
          const dbId = aclListMatch[1];
          const rules = self.registry.query<{ address: string; permissions: string; created_at: number }>(
            'SELECT address, permissions, created_at FROM acl WHERE database_id = ?'
          ).all(dbId);
          
          return Response.json({
            rules: rules.map(r => ({
              address: r.address,
              permissions: JSON.parse(r.permissions),
              createdAt: r.created_at,
            })),
          });
        }

        // Plans (for rental)
        if (url.pathname === '/api/v1/plans' && method === 'GET') {
          return Response.json({
            plans: [
              { id: 'dev', name: 'Development', pricePerMonth: '0', nodeCount: 1, storage: '100MB' },
              { id: 'basic', name: 'Basic', pricePerMonth: '10', nodeCount: 3, storage: '1GB' },
              { id: 'pro', name: 'Professional', pricePerMonth: '50', nodeCount: 5, storage: '10GB' },
            ],
          });
        }

        // Metrics endpoint
        if (url.pathname === '/metrics') {
          const metrics = [
            '# HELP cql_block_height Current block height',
            '# TYPE cql_block_height gauge',
            `cql_block_height ${self.blockHeight}`,
            '# HELP cql_databases_total Total number of databases',
            '# TYPE cql_databases_total gauge',
            `cql_databases_total ${self.databases.size}`,
            '# HELP cql_queries_total Total queries executed',
            '# TYPE cql_queries_total counter',
            `cql_queries_total ${self.blockHeight * 10}`,
          ].join('\n');
          return new Response(metrics, { headers: { 'Content-Type': 'text/plain' } });
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    console.log(`[CQL] SQLite-backed server running on port ${this.config.port}`);
    console.log(`[CQL] Data directory: ${this.config.dataDir}`);
  }

  stop(): void {
    this.server?.stop();
    this.registry.close();
    for (const db of this.databases.values()) {
      db.close();
    }
    this.databases.clear();
  }

  getBlockHeight(): number {
    return this.blockHeight;
  }
}

// Create and export server factory
export function createCQLServer(config: Partial<CQLServerConfig> = {}): CQLServer {
  const dataDir = config.dataDir || process.env.CQL_DATA_DIR || '.data/cql';
  return new CQLServer({
    port: config.port || parseInt(process.env.CQL_PORT || '4300'),
    dataDir,
    debug: config.debug ?? process.env.CQL_DEBUG === 'true',
  });
}

// CLI entry point
if (import.meta.main) {
  const port = parseInt(process.env.PORT || process.env.CQL_PORT || '4300');
  const dataDir = process.env.CQL_DATA_DIR || '.data/cql';
  
  const server = createCQLServer({ port, dataDir, debug: true });
  server.start();
  
  process.on('SIGINT', () => {
    console.log('\n[CQL] Shutting down...');
    server.stop();
    process.exit(0);
  });
}

