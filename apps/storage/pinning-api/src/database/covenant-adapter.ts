/**
 * CovenantSQL Adapter for Storage App
 * 
 * Provides database operations backed by CovenantSQL for full decentralization.
 * Supports both CovenantSQL (production) and in-memory (development) modes.
 */

import { 
  CovenantSQLClient, 
  createCovenantSQLClient, 
  getCovenantSQLClient,
  MigrationManager,
  createTableMigration,
  type TableSchema,
  type ConsistencyLevel 
} from '@jeju/shared/db';

// ============================================================================
// Types
// ============================================================================

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
  ownerAgentId: number | null;
}

export interface Payment {
  id: number;
  pinId: number;
  amount: string;
  token: string;
  txHash: string;
  payer: string;
  timestamp: Date;
  verified: boolean;
}

export interface Stats {
  id: number;
  date: Date;
  totalPins: number;
  totalSizeBytes: number;
  totalRevenue: string;
  activeUsers: number;
}

export interface StorageStats {
  totalPins: number;
  totalSizeBytes: number;
  totalSizeGB: number;
}

export interface ListPinsOptions {
  cid?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Schema Definitions
// ============================================================================

const PINS_SCHEMA: TableSchema = {
  name: 'pins',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false },
    { name: 'cid', type: 'TEXT', nullable: false, unique: true },
    { name: 'name', type: 'TEXT', nullable: false },
    { name: 'status', type: 'TEXT', nullable: false },
    { name: 'size_bytes', type: 'BIGINT', nullable: true },
    { name: 'created', type: 'TIMESTAMP', nullable: false },
    { name: 'expires_at', type: 'TIMESTAMP', nullable: true },
    { name: 'origins', type: 'JSON', nullable: true },
    { name: 'metadata', type: 'JSON', nullable: true },
    { name: 'paid_amount', type: 'TEXT', nullable: true },
    { name: 'payment_token', type: 'TEXT', nullable: true },
    { name: 'payment_tx_hash', type: 'TEXT', nullable: true },
    { name: 'owner_address', type: 'TEXT', nullable: true },
    { name: 'owner_agent_id', type: 'BIGINT', nullable: true },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_pins_cid', columns: ['cid'], unique: true },
    { name: 'idx_pins_status', columns: ['status'] },
    { name: 'idx_pins_owner', columns: ['owner_address'] },
  ],
  consistency: 'strong',
};

const PAYMENTS_SCHEMA: TableSchema = {
  name: 'payments',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false },
    { name: 'pin_id', type: 'BIGINT', nullable: true },
    { name: 'amount', type: 'TEXT', nullable: false },
    { name: 'token', type: 'TEXT', nullable: false },
    { name: 'tx_hash', type: 'TEXT', nullable: false },
    { name: 'payer', type: 'TEXT', nullable: false },
    { name: 'timestamp', type: 'TIMESTAMP', nullable: false },
    { name: 'verified', type: 'BOOLEAN', nullable: false, default: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_payments_pin', columns: ['pin_id'] },
    { name: 'idx_payments_payer', columns: ['payer'] },
    { name: 'idx_payments_tx', columns: ['tx_hash'], unique: true },
  ],
  consistency: 'strong',
};

const STATS_SCHEMA: TableSchema = {
  name: 'stats',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false },
    { name: 'date', type: 'TIMESTAMP', nullable: false },
    { name: 'total_pins', type: 'BIGINT', nullable: false },
    { name: 'total_size_bytes', type: 'BIGINT', nullable: false },
    { name: 'total_revenue', type: 'TEXT', nullable: false },
    { name: 'active_users', type: 'BIGINT', nullable: false },
  ],
  primaryKey: ['id'],
  indexes: [
    { name: 'idx_stats_date', columns: ['date'] },
  ],
  consistency: 'eventual',
};

// ============================================================================
// CovenantSQL Database Adapter
// ============================================================================

export class CovenantStorageDB {
  private client: CovenantSQLClient | null = null;
  private inMemory: Map<string, Pin> = new Map();
  private inMemoryPayments: Map<string, Payment> = new Map();
  private nextId = 1;
  private mode: 'covenant' | 'memory';

  constructor(mode: 'covenant' | 'memory' = 'memory') {
    this.mode = mode;
  }

  async initialize(): Promise<void> {
    if (this.mode === 'covenant') {
      this.client = getCovenantSQLClient();
      await this.client.initialize();
      await this.runMigrations();
    }
    console.log(`[StorageDB] Initialized in ${this.mode} mode`);
  }

  private async runMigrations(): Promise<void> {
    if (!this.client) return;

    const migrationManager = new MigrationManager(this.client);
    migrationManager.register([
      createTableMigration(1, 'create_pins', PINS_SCHEMA),
      createTableMigration(2, 'create_payments', PAYMENTS_SCHEMA),
      createTableMigration(3, 'create_stats', STATS_SCHEMA),
    ]);

    const results = await migrationManager.up();
    for (const result of results) {
      console.log(`[StorageDB] Migration ${result.name}: ${result.success ? 'OK' : 'FAILED'} (${result.duration}ms)`);
      if (!result.success) {
        throw new Error(`Migration failed: ${result.name} - ${result.error}`);
      }
    }
  }

  // ============================================================================
  // Pin Operations
  // ============================================================================

  async createPin(data: Omit<Pin, 'id'>): Promise<string> {
    if (this.mode === 'memory') {
      const id = this.nextId++;
      const pin: Pin = { ...data, id };
      this.inMemory.set(id.toString(), pin);
      return id.toString();
    }

    const result = await this.client!.insert('pins', {
      cid: data.cid,
      name: data.name,
      status: data.status,
      size_bytes: data.sizeBytes,
      created: data.created.toISOString(),
      expires_at: data.expiresAt?.toISOString(),
      origins: data.origins ? JSON.stringify(data.origins) : null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      paid_amount: data.paidAmount,
      payment_token: data.paymentToken,
      payment_tx_hash: data.paymentTxHash,
      owner_address: data.ownerAddress,
      owner_agent_id: data.ownerAgentId,
    });

    return result.lastInsertId ?? '0';
  }

  async getPin(id: string): Promise<Pin | null> {
    if (this.mode === 'memory') {
      return this.inMemory.get(id) ?? null;
    }

    const result = await this.client!.selectOne<Record<string, unknown>>(
      'pins',
      'id = $1',
      [parseInt(id, 10)]
    );

    return result ? this.mapRowToPin(result) : null;
  }

  async getPinByCid(cid: string): Promise<Pin | null> {
    if (this.mode === 'memory') {
      for (const pin of this.inMemory.values()) {
        if (pin.cid === cid) return pin;
      }
      return null;
    }

    const result = await this.client!.selectOne<Record<string, unknown>>(
      'pins',
      'cid = $1',
      [cid]
    );

    return result ? this.mapRowToPin(result) : null;
  }

  async listPins(options: ListPinsOptions = {}): Promise<Pin[]> {
    const { cid, status, limit = 10, offset = 0 } = options;

    if (this.mode === 'memory') {
      let pins = Array.from(this.inMemory.values());
      if (cid) pins = pins.filter(p => p.cid === cid);
      if (status) pins = pins.filter(p => p.status === status);
      return pins.slice(offset, offset + limit);
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (cid) {
      conditions.push(`cid = $${params.length + 1}`);
      params.push(cid);
    }
    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    const rows = await this.client!.select<Record<string, unknown>>('pins', {
      where: conditions.length > 0 ? conditions.join(' AND ') : undefined,
      whereParams: params,
      orderBy: 'created DESC',
      limit,
      offset,
      consistency: 'eventual',
    });

    return rows.map(r => this.mapRowToPin(r));
  }

  async updatePin(id: string, data: Partial<Pin>): Promise<void> {
    if (this.mode === 'memory') {
      const pin = this.inMemory.get(id);
      if (pin) {
        this.inMemory.set(id, { ...pin, ...data });
      }
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.sizeBytes !== undefined) updateData.size_bytes = data.sizeBytes;
    if (data.expiresAt !== undefined) updateData.expires_at = data.expiresAt?.toISOString();
    if (data.metadata !== undefined) updateData.metadata = JSON.stringify(data.metadata);
    if (data.paidAmount !== undefined) updateData.paid_amount = data.paidAmount;
    if (data.paymentToken !== undefined) updateData.payment_token = data.paymentToken;
    if (data.paymentTxHash !== undefined) updateData.payment_tx_hash = data.paymentTxHash;

    await this.client!.update('pins', updateData, 'id = $1', [parseInt(id, 10)]);
  }

  async deletePin(id: string): Promise<void> {
    if (this.mode === 'memory') {
      this.inMemory.delete(id);
      return;
    }

    await this.client!.delete('pins', 'id = $1', [parseInt(id, 10)]);
  }

  async countPins(status?: string): Promise<number> {
    if (this.mode === 'memory') {
      if (status) {
        return Array.from(this.inMemory.values()).filter(p => p.status === status).length;
      }
      return this.inMemory.size;
    }

    return this.client!.count('pins', status ? 'status = $1' : undefined, status ? [status] : undefined);
  }

  // ============================================================================
  // Payment Operations
  // ============================================================================

  async createPayment(data: Omit<Payment, 'id'>): Promise<string> {
    if (this.mode === 'memory') {
      const id = this.nextId++;
      const payment: Payment = { ...data, id };
      this.inMemoryPayments.set(id.toString(), payment);
      return id.toString();
    }

    const result = await this.client!.insert('payments', {
      pin_id: data.pinId,
      amount: data.amount,
      token: data.token,
      tx_hash: data.txHash,
      payer: data.payer,
      timestamp: data.timestamp.toISOString(),
      verified: data.verified,
    });

    return result.lastInsertId ?? '0';
  }

  async verifyPayment(txHash: string): Promise<void> {
    if (this.mode === 'memory') {
      for (const [id, payment] of this.inMemoryPayments) {
        if (payment.txHash === txHash) {
          this.inMemoryPayments.set(id, { ...payment, verified: true });
          break;
        }
      }
      return;
    }

    await this.client!.update('payments', { verified: true }, 'tx_hash = $1', [txHash]);
  }

  // ============================================================================
  // Stats Operations
  // ============================================================================

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

    const countResult = await this.client!.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM pins WHERE status = 'pinned'",
      [],
      { consistency: 'eventual' }
    );
    const totalPins = countResult.rows[0]?.count ?? 0;

    const sizeResult = await this.client!.query<{ total: number }>(
      'SELECT COALESCE(SUM(size_bytes), 0) as total FROM pins',
      [],
      { consistency: 'eventual' }
    );
    const totalSizeBytes = sizeResult.rows[0]?.total ?? 0;

    return {
      totalPins,
      totalSizeBytes,
      totalSizeGB: totalSizeBytes / (1024 ** 3),
    };
  }

  async recordDailyStats(): Promise<void> {
    const stats = await this.getStorageStats();

    if (this.mode === 'memory') {
      return;
    }

    await this.client!.insert('stats', {
      date: new Date().toISOString(),
      total_pins: stats.totalPins,
      total_size_bytes: stats.totalSizeBytes,
      total_revenue: '0',
      active_users: 0,
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private mapRowToPin(row: Record<string, unknown>): Pin {
    return {
      id: row.id as number,
      cid: row.cid as string,
      name: row.name as string,
      status: row.status as string,
      sizeBytes: row.size_bytes as number | null,
      created: new Date(row.created as string),
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      origins: row.origins ? JSON.parse(row.origins as string) : null,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
      paidAmount: row.paid_amount as string | null,
      paymentToken: row.payment_token as string | null,
      paymentTxHash: row.payment_tx_hash as string | null,
      ownerAddress: row.owner_address as string | null,
      ownerAgentId: row.owner_agent_id as number | null,
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalDB: CovenantStorageDB | null = null;

/**
 * Get or create the global storage database
 */
export function getStorageDB(): CovenantStorageDB {
  if (globalDB) return globalDB;

  const mode = process.env.COVENANTSQL_NODES ? 'covenant' : 'memory';
  globalDB = new CovenantStorageDB(mode);
  
  return globalDB;
}

/**
 * Initialize the storage database
 */
export async function initializeStorageDB(): Promise<CovenantStorageDB> {
  const db = getStorageDB();
  await db.initialize();
  return db;
}

/**
 * Reset global DB (for testing)
 */
export function resetStorageDB(): void {
  globalDB = null;
}

