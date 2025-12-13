/**
 * CovenantSQL Adapter - Decentralized storage database with memory fallback.
 */

export interface CQLConfig {
  /** Block producer endpoint */
  blockProducerEndpoint: string;
  /** Database ID */
  databaseId: string;
  /** Private key for authentication */
  privateKey: string;
  /** Connection timeout in ms */
  timeout: number;
  /** Enable query logging */
  logging: boolean;
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
    this.config = {
      blockProducerEndpoint: config?.blockProducerEndpoint ?? process.env.CQL_BLOCK_PRODUCER_ENDPOINT ?? '',
      databaseId: config?.databaseId ?? process.env.CQL_DATABASE_ID ?? '',
      privateKey: config?.privateKey ?? process.env.CQL_PRIVATE_KEY ?? '',
      timeout: config?.timeout ?? 30000,
      logging: config?.logging ?? process.env.CQL_LOGGING === 'true',
    };

    this.mode = this.config.blockProducerEndpoint ? 'cql' : 'memory';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.mode === 'cql' && !await this.healthCheck()) {
      console.warn('[CQL] Connection failed, using memory mode');
      this.mode = 'memory';
    }

    this.initialized = true;
    console.log(`[CQL] Initialized in ${this.mode} mode`);
  }

  async healthCheck(): Promise<boolean> {
    if (this.mode === 'memory') return true;

    const response = await fetch(`${this.config.blockProducerEndpoint}/v1/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch((e: Error) => {
      console.warn('[CQL] Health check failed:', e.message);
      return null;
    });
    
    return response?.ok ?? false;
  }

  async createPin(data: Omit<Pin, 'id'>): Promise<string> {
    if (this.mode === 'memory') {
      const id = this.nextId++;
      const pin: Pin = { ...data, id };
      this.inMemory.set(id.toString(), pin);
      return id.toString();
    }

    const result = await this.query<{ lastInsertId: string }>(
      `INSERT INTO pins (cid, name, status, size_bytes, created, expires_at, origins, metadata, paid_amount, payment_token, payment_tx_hash, owner_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        data.cid,
        data.name,
        data.status,
        data.sizeBytes,
        data.created.toISOString(),
        data.expiresAt?.toISOString(),
        data.origins ? JSON.stringify(data.origins) : null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.paidAmount,
        data.paymentToken,
        data.paymentTxHash,
        data.ownerAddress,
      ]
    );

    return result.lastInsertId;
  }

  async getPin(id: string): Promise<Pin | null> {
    if (this.mode === 'memory') {
      return this.inMemory.get(id) ?? null;
    }

    const result = await this.query<Pin>(
      'SELECT * FROM pins WHERE id = $1',
      [parseInt(id, 10)]
    );

    return result ?? null;
  }

  async getPinByCid(cid: string): Promise<Pin | null> {
    if (this.mode === 'memory') {
      for (const pin of this.inMemory.values()) {
        if (pin.cid === cid) return pin;
      }
      return null;
    }

    const result = await this.query<Pin>(
      'SELECT * FROM pins WHERE cid = $1',
      [cid]
    );

    return result ?? null;
  }

  async listPins(options: { cid?: string; status?: string; limit?: number; offset?: number } = {}): Promise<Pin[]> {
    const { cid, status, limit = 10, offset = 0 } = options;

    if (this.mode === 'memory') {
      let pins = Array.from(this.inMemory.values());
      if (cid) pins = pins.filter(p => p.cid === cid);
      if (status) pins = pins.filter(p => p.status === status);
      return pins.slice(offset, offset + limit);
    }

    let sql = 'SELECT * FROM pins';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (cid) {
      conditions.push(`cid = $${params.length + 1}`);
      params.push(cid);
    }
    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY created DESC LIMIT ${limit} OFFSET ${offset}`;

    return this.queryAll<Pin>(sql, params);
  }

  async updatePin(id: string, data: Partial<Pin>): Promise<void> {
    if (this.mode === 'memory') {
      const pin = this.inMemory.get(id);
      if (pin) {
        this.inMemory.set(id, { ...pin, ...data });
      }
      return;
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.status !== undefined) {
      sets.push(`status = $${params.length + 1}`);
      params.push(data.status);
    }
    if (data.sizeBytes !== undefined) {
      sets.push(`size_bytes = $${params.length + 1}`);
      params.push(data.sizeBytes);
    }
    if (data.expiresAt !== undefined) {
      sets.push(`expires_at = $${params.length + 1}`);
      params.push(data.expiresAt?.toISOString());
    }

    if (sets.length === 0) return;

    params.push(parseInt(id, 10));
    await this.query(
      `UPDATE pins SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
  }

  async deletePin(id: string): Promise<void> {
    if (this.mode === 'memory') {
      this.inMemory.delete(id);
      return;
    }

    await this.query('DELETE FROM pins WHERE id = $1', [parseInt(id, 10)]);
  }

  async countPins(status?: string): Promise<number> {
    if (this.mode === 'memory') {
      if (status) {
        return Array.from(this.inMemory.values()).filter(p => p.status === status).length;
      }
      return this.inMemory.size;
    }

    let sql = 'SELECT COUNT(*) as count FROM pins';
    const params: unknown[] = [];

    if (status) {
      sql += ' WHERE status = $1';
      params.push(status);
    }

    const result = await this.query<{ count: number }>(sql, params);
    return result?.count ?? 0;
  }

  async getStorageStats(): Promise<StorageStats> {
    if (this.mode === 'memory') {
      const pins = Array.from(this.inMemory.values());
      const totalPins = pins.filter(p => p.status === 'pinned').length;
      const totalSizeBytes = pins.reduce((sum, p) => sum + (p.sizeBytes ?? 0), 0);
      return {
        totalPins,
        totalSizeBytes,
        totalSizeGB: totalSizeBytes / (1024 ** 3),
      };
    }

    const countResult = await this.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM pins WHERE status = 'pinned'"
    );
    const totalPins = countResult?.count ?? 0;

    const sizeResult = await this.query<{ total: number }>(
      'SELECT COALESCE(SUM(size_bytes), 0) as total FROM pins'
    );
    const totalSizeBytes = sizeResult?.total ?? 0;

    return {
      totalPins,
      totalSizeBytes,
      totalSizeGB: totalSizeBytes / (1024 ** 3),
    };
  }

  private async query<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (this.mode === 'memory') {
      return null;
    }

    if (this.config.logging) {
      console.log(`[CQL] ${sql}`, params);
    }

    try {
      const response = await fetch(`${this.config.blockProducerEndpoint}/v1/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Database-ID': this.config.databaseId,
          'X-Private-Key': this.config.privateKey,
        },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`CQL query failed: ${error}`);
      }

      const data = await response.json() as { rows: T[] };
      return data.rows[0] ?? null;
    } catch (error) {
      if (this.config.logging) {
        console.error('[CQL] Query error:', error);
      }
      throw error;
    }
  }

  private async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.mode === 'memory') {
      return [];
    }

    if (this.config.logging) {
      console.log(`[CQL] ${sql}`, params);
    }

    try {
      const response = await fetch(`${this.config.blockProducerEndpoint}/v1/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Database-ID': this.config.databaseId,
          'X-Private-Key': this.config.privateKey,
        },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`CQL query failed: ${error}`);
      }

      const data = await response.json() as { rows: T[] };
      return data.rows;
    } catch (error) {
      if (this.config.logging) {
        console.error('[CQL] Query error:', error);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.initialized = false;
    this.inMemory.clear();
  }
}

let globalDB: CQLDatabase | null = null;

/**
 * Get or create global CQL database
 */
export function getCQLDatabase(config?: Partial<CQLConfig>): CQLDatabase {
  if (globalDB) return globalDB;

  globalDB = new CQLDatabase(config);
  return globalDB;
}

/**
 * Reset global database (for testing)
 */
export function resetCQLDatabase(): void {
  globalDB = null;
}
