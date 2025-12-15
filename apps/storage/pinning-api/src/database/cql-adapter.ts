/**
 * CovenantSQL Adapter - Decentralized storage database.
 * 
 * DECENTRALIZED: No fallbacks in production - CQL is required.
 * Set CQL_BLOCK_PRODUCER_ENDPOINT for storage operations.
 */

export interface CQLConfig {
  blockProducerEndpoint: string;
  databaseId: string;
  privateKey: string;
  timeout: number;
  logging: boolean;
  /** If true, throw instead of falling back. Default: true in production */
  strictMode: boolean;
}

export interface Pin {
  id: number;
  cid: string;
  name: string;
  status: string;
  sizeBytes: number | null;
  created: Date;
  expiresAt: Date | null;
  origins: string[] | null;
  metadata: Record<string, unknown> | null;
  paidAmount: string | null;
  paymentToken: string | null;
  paymentTxHash: string | null;
  ownerAddress: string | null;
}

export interface StorageStats {
  totalPins: number;
  totalSizeBytes: number;
  totalSizeGB: number;
}

export class CQLDatabase {
  private config: CQLConfig;
  private initialized = false;
  private inMemory: Map<string, Pin> = new Map();
  private nextId = 1;
  private mode: 'cql' | 'memory';

  constructor(config?: Partial<CQLConfig>) {
    // Default to strict mode in production (NODE_ENV !== 'test')
    const isProduction = process.env.NODE_ENV !== 'test' && process.env.CQL_STRICT_MODE !== 'false';
    
    this.config = {
      blockProducerEndpoint: config?.blockProducerEndpoint ?? process.env.CQL_BLOCK_PRODUCER_ENDPOINT ?? '',
      databaseId: config?.databaseId ?? process.env.CQL_DATABASE_ID ?? '',
      privateKey: config?.privateKey ?? process.env.CQL_PRIVATE_KEY ?? '',
      timeout: config?.timeout ?? 30000,
      logging: config?.logging ?? process.env.CQL_LOGGING === 'true',
      strictMode: config?.strictMode ?? isProduction,
    };
    this.mode = this.config.blockProducerEndpoint ? 'cql' : 'memory';
    
    if (this.mode === 'memory') {
      if (this.config.strictMode) {
        throw new Error(
          'Storage requires CovenantSQL for decentralized persistence.\n' +
          'Set CQL_BLOCK_PRODUCER_ENDPOINT environment variable or start stack:\n' +
          '  docker compose up -d\n' +
          '\n' +
          'Or set CQL_STRICT_MODE=false for testing only (data will NOT persist).'
        );
      }
      console.warn('[CQL] WARNING: No CQL_BLOCK_PRODUCER_ENDPOINT configured. Using in-memory storage.');
      console.warn('[CQL] WARNING: Data will NOT persist across restarts.');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    if (this.mode === 'cql') {
      const health = await this.healthCheck();
      if (!health.healthy) {
        if (this.config.strictMode) {
          throw new Error(`[CQL] Connection failed (${health.error}) and strictMode is enabled. Set CQL_BLOCK_PRODUCER_ENDPOINT correctly.`);
        }
        console.error('[CQL] ERROR: CovenantSQL connection failed. Falling back to memory mode.');
        console.error(`[CQL] ERROR: ${health.error}`);
        console.error('[CQL] ERROR: This means your data will NOT persist. Fix your CQL configuration.');
        this.mode = 'memory';
      } else {
        console.log(`[CQL] Connected to CovenantSQL (latency: ${health.latencyMs}ms)`);
      }
    }
    
    this.initialized = true;
    console.log(`[CQL] Initialized in ${this.mode} mode`);
  }

  /** Returns current storage mode */
  getMode(): 'cql' | 'memory' { return this.mode; }

  /** Returns true if using non-persistent memory storage */
  isMemoryMode(): boolean { return this.mode === 'memory'; }

  async healthCheck(): Promise<{ healthy: boolean; error?: string; latencyMs?: number }> {
    if (this.mode === 'memory') {
      return { healthy: true, latencyMs: 0 };
    }

    const startTime = Date.now();
    try {
      const response = await fetch(`${this.config.blockProducerEndpoint}/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - startTime;
      
      if (!response.ok) {
        const error = `Health check returned ${response.status}: ${response.statusText}`;
        console.error(`[CQL] ${error}`);
        return { healthy: false, error, latencyMs };
      }
      
      return { healthy: true, latencyMs };
    } catch (e) {
      const error = (e as Error).message;
      console.error(`[CQL] Health check failed: ${error}`);
      return { healthy: false, error, latencyMs: Date.now() - startTime };
    }
  }

  async createPin(data: Omit<Pin, 'id'>): Promise<string> {
    if (this.mode === 'memory') {
      const id = this.nextId++;
      this.inMemory.set(id.toString(), { ...data, id });
      return id.toString();
    }

    const result = await this.query<{ lastInsertId: string }>(
      `INSERT INTO pins (cid, name, status, size_bytes, created, expires_at, origins, metadata, paid_amount, payment_token, payment_tx_hash, owner_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [data.cid, data.name, data.status, data.sizeBytes, data.created.toISOString(),
       data.expiresAt?.toISOString(), data.origins ? JSON.stringify(data.origins) : null,
       data.metadata ? JSON.stringify(data.metadata) : null, data.paidAmount,
       data.paymentToken, data.paymentTxHash, data.ownerAddress]
    );
    return result!.lastInsertId;
  }

  async getPin(id: string): Promise<Pin | null> {
    if (this.mode === 'memory') return this.inMemory.get(id) ?? null;
    return this.query<Pin>('SELECT * FROM pins WHERE id = $1', [parseInt(id, 10)]);
  }

  async getPinByCid(cid: string): Promise<Pin | null> {
    if (this.mode === 'memory') {
      for (const pin of this.inMemory.values()) if (pin.cid === cid) return pin;
      return null;
    }
    return this.query<Pin>('SELECT * FROM pins WHERE cid = $1', [cid]);
  }

  async listPins(options: { cid?: string; status?: string; limit?: number; offset?: number } = {}): Promise<Pin[]> {
    const { cid, status, limit = 10, offset = 0 } = options;

    if (this.mode === 'memory') {
      let pins = Array.from(this.inMemory.values());
      if (cid) pins = pins.filter(p => p.cid === cid);
      if (status) pins = pins.filter(p => p.status === status);
      return pins.slice(offset, offset + limit);
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (cid) { conditions.push(`cid = $${params.length + 1}`); params.push(cid); }
    if (status) { conditions.push(`status = $${params.length + 1}`); params.push(status); }

    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    return this.queryAll<Pin>(`SELECT * FROM pins${where} ORDER BY created DESC LIMIT ${limit} OFFSET ${offset}`, params);
  }

  async updatePin(id: string, data: Partial<Pin>): Promise<void> {
    if (this.mode === 'memory') {
      const pin = this.inMemory.get(id);
      if (pin) this.inMemory.set(id, { ...pin, ...data });
      return;
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.status !== undefined) { sets.push(`status = $${params.length + 1}`); params.push(data.status); }
    if (data.sizeBytes !== undefined) { sets.push(`size_bytes = $${params.length + 1}`); params.push(data.sizeBytes); }
    if (data.expiresAt !== undefined) { sets.push(`expires_at = $${params.length + 1}`); params.push(data.expiresAt?.toISOString()); }
    if (sets.length === 0) return;

    params.push(parseInt(id, 10));
    await this.query(`UPDATE pins SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  }

  async deletePin(id: string): Promise<void> {
    if (this.mode === 'memory') { this.inMemory.delete(id); return; }
    await this.query('DELETE FROM pins WHERE id = $1', [parseInt(id, 10)]);
  }

  async countPins(status?: string): Promise<number> {
    if (this.mode === 'memory') {
      return status ? Array.from(this.inMemory.values()).filter(p => p.status === status).length : this.inMemory.size;
    }
    const sql = status ? 'SELECT COUNT(*) as count FROM pins WHERE status = $1' : 'SELECT COUNT(*) as count FROM pins';
    const result = await this.query<{ count: number }>(sql, status ? [status] : []);
    return result?.count ?? 0;
  }

  async getStorageStats(): Promise<StorageStats> {
    if (this.mode === 'memory') {
      const pins = Array.from(this.inMemory.values());
      const totalPins = pins.filter(p => p.status === 'pinned').length;
      const totalSizeBytes = pins.reduce((sum, p) => sum + (p.sizeBytes ?? 0), 0);
      return { totalPins, totalSizeBytes, totalSizeGB: totalSizeBytes / (1024 ** 3) };
    }

    const countResult = await this.query<{ count: number }>("SELECT COUNT(*) as count FROM pins WHERE status = 'pinned'");
    const sizeResult = await this.query<{ total: number }>('SELECT COALESCE(SUM(size_bytes), 0) as total FROM pins');
    const totalSizeBytes = sizeResult?.total ?? 0;
    return { totalPins: countResult?.count ?? 0, totalSizeBytes, totalSizeGB: totalSizeBytes / (1024 ** 3) };
  }

  private async query<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (this.mode === 'memory') return null;
    if (this.config.logging) console.log(`[CQL] ${sql}`, params);

    const response = await fetch(`${this.config.blockProducerEndpoint}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Database-ID': this.config.databaseId, 'X-Private-Key': this.config.privateKey },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) throw new Error(`CQL query failed: ${await response.text()}`);
    const data = await response.json() as { rows: T[] };
    return data.rows[0] ?? null;
  }

  private async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.mode === 'memory') return [];
    if (this.config.logging) console.log(`[CQL] ${sql}`, params);

    const response = await fetch(`${this.config.blockProducerEndpoint}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Database-ID': this.config.databaseId, 'X-Private-Key': this.config.privateKey },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) throw new Error(`CQL query failed: ${await response.text()}`);
    return ((await response.json()) as { rows: T[] }).rows;
  }

  async close(): Promise<void> {
    this.initialized = false;
    this.inMemory.clear();
  }
}

let globalDB: CQLDatabase | null = null;

export function getCQLDatabase(config?: Partial<CQLConfig>): CQLDatabase {
  if (globalDB) return globalDB;
  globalDB = new CQLDatabase(config);
  return globalDB;
}

export function resetCQLDatabase(): void {
  globalDB = null;
}
