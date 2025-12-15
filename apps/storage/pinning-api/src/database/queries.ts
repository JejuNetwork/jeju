/**
 * Database queries for pin management
 * 
 * Mode determined by environment:
 * - COVENANTSQL_NODES: CovenantSQL (decentralized)
 * - DATABASE_URL: PostgreSQL (legacy)
 * - Neither: In-memory storage (development only)
 */

import { getCQL, type CQLClient } from "@jeju/db";

// Storage mode determined at startup
type DatabaseMode = "covenantql" | "postgres" | "memory";

const DB_MODE: DatabaseMode = process.env.COVENANTSQL_NODES
  ? "covenantql"
  : process.env.DATABASE_URL
  ? "postgres"
  : "memory";

const CQL_DATABASE_ID = process.env.COVENANTSQL_DATABASE_ID ?? "storage-pins";

console.log(`📦 Storage database mode: ${DB_MODE}`);

// CQL client for decentralized mode
let cqlClient: CQLClient | null = null;

async function getCQLClient(): Promise<CQLClient> {
  if (!cqlClient) {
    cqlClient = getCQL();
    await cqlClient.initialize();
    await ensureCQLTablesExist();
  }
  return cqlClient;
}

async function ensureCQLTablesExist(): Promise<void> {
  const tables = [
    `CREATE TABLE IF NOT EXISTS pins (
      id INTEGER PRIMARY KEY,
      cid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      size_bytes BIGINT,
      created TEXT NOT NULL,
      expires_at TEXT,
      origins TEXT,
      metadata TEXT,
      paid_amount TEXT,
      payment_token TEXT,
      payment_tx_hash TEXT,
      owner_address TEXT,
      owner_agent_id BIGINT
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      pin_id BIGINT,
      amount TEXT NOT NULL,
      token TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      payer TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      total_pins BIGINT NOT NULL,
      total_size_bytes BIGINT NOT NULL,
      total_revenue TEXT NOT NULL,
      active_users BIGINT NOT NULL
    )`,
  ];

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_pins_cid ON pins(cid)`,
    `CREATE INDEX IF NOT EXISTS idx_pins_owner ON pins(owner_address)`,
    `CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_pin_id ON payments(pin_id)`,
  ];

  for (const ddl of tables) {
    await cqlClient!.exec(ddl, [], CQL_DATABASE_ID);
  }

  for (const idx of indexes) {
    await cqlClient!.exec(idx, [], CQL_DATABASE_ID).catch(() => {});
  }

  console.log("[Storage] CovenantSQL tables ensured");
}

// In-memory store for development
const memoryStore = {
  pins: new Map<
    string,
    {
      id: number;
      cid: string;
      name: string;
      status: string;
      created: Date;
      sizeBytes: number;
      ownerAddress?: string;
    }
  >(),
  nextId: 1,
};

interface PinData {
  cid: string;
  name: string;
  status: string;
  created: Date;
  sizeBytes?: number;
  origins?: string[];
  ownerAddress?: string;
  paidAmount?: string;
  expiresAt?: Date;
}

interface PinRecord {
  id: number;
  cid: string;
  name: string;
  status: string;
  created: Date;
  sizeBytes: number;
  ownerAddress?: string;
}

export const database = {
  async createPin(data: PinData): Promise<string> {
    if (DB_MODE === "covenantql") {
      const client = await getCQLClient();
      const id = Date.now();
      await client.exec(
        `INSERT INTO pins (id, cid, name, status, size_bytes, created, origins, owner_address, paid_amount, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.cid,
          data.name,
          data.status,
          data.sizeBytes ?? 0,
          data.created.toISOString(),
          JSON.stringify(data.origins ?? []),
          data.ownerAddress ?? null,
          data.paidAmount ?? null,
          data.expiresAt?.toISOString() ?? null,
        ],
        CQL_DATABASE_ID
      );
      return id.toString();
    }

    // Memory mode
    const id = memoryStore.nextId++;
    memoryStore.pins.set(id.toString(), {
      id,
      cid: data.cid,
      name: data.name,
      status: data.status,
      created: data.created,
      sizeBytes: data.sizeBytes ?? 0,
      ownerAddress: data.ownerAddress,
    });
    return id.toString();
  },

  async getPin(id: string): Promise<PinRecord | undefined> {
    if (DB_MODE === "covenantql") {
      const client = await getCQLClient();
      const result = await client.query<PinRecord>(
        `SELECT id, cid, name, status, size_bytes as "sizeBytes", created, owner_address as "ownerAddress"
         FROM pins WHERE id = ?`,
        [parseInt(id)],
        CQL_DATABASE_ID
      );
      const row = result.rows[0];
      if (row) {
        return {
          ...row,
          created: new Date(row.created as unknown as string),
        };
      }
      return undefined;
    }

    return memoryStore.pins.get(id);
  },

  async listPins(filters: {
    cid?: string;
    name?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<PinRecord[]> {
    if (DB_MODE === "covenantql") {
      const client = await getCQLClient();
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filters.cid) {
        conditions.push("cid = ?");
        params.push(filters.cid);
      }
      if (filters.status) {
        conditions.push("status = ?");
        params.push(filters.status);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await client.query<PinRecord>(
        `SELECT id, cid, name, status, size_bytes as "sizeBytes", created, owner_address as "ownerAddress"
         FROM pins ${where} LIMIT ? OFFSET ?`,
        [...params, filters.limit, filters.offset],
        CQL_DATABASE_ID
      );
      return result.rows.map((row) => ({
        ...row,
        created: new Date(row.created as unknown as string),
      }));
    }

    let results = Array.from(memoryStore.pins.values());
    if (filters.cid) results = results.filter((p) => p.cid === filters.cid);
    if (filters.status) results = results.filter((p) => p.status === filters.status);
    return results.slice(filters.offset, filters.offset + filters.limit);
  },

  async updatePin(id: string, data: Partial<PinRecord>): Promise<void> {
    if (DB_MODE === "covenantql") {
      const client = await getCQLClient();
      const sets: string[] = [];
      const params: unknown[] = [];

      if (data.status !== undefined) {
        sets.push("status = ?");
        params.push(data.status);
      }
      if (data.sizeBytes !== undefined) {
        sets.push("size_bytes = ?");
        params.push(data.sizeBytes);
      }
      if (data.ownerAddress !== undefined) {
        sets.push("owner_address = ?");
        params.push(data.ownerAddress);
      }

      if (sets.length > 0) {
        params.push(parseInt(id));
        await client.exec(
          `UPDATE pins SET ${sets.join(", ")} WHERE id = ?`,
          params,
          CQL_DATABASE_ID
        );
      }
      return;
    }

    const existing = memoryStore.pins.get(id);
    if (existing) {
      memoryStore.pins.set(id, { ...existing, ...data });
    }
  },

  async countPins(): Promise<number> {
    if (DB_MODE === "covenantql") {
      const client = await getCQLClient();
      const result = await client.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM pins`,
        [],
        CQL_DATABASE_ID
      );
      return result.rows[0]?.count ?? 0;
    }

    return memoryStore.pins.size;
  },

  async recordPayment(data: {
    pinId: number;
    amount: string;
    token: string;
    txHash: string;
    payer: string;
    verified: boolean;
  }): Promise<void> {
    if (DB_MODE === "covenantql") {
      const client = await getCQLClient();
      await client.exec(
        `INSERT INTO payments (id, pin_id, amount, token, tx_hash, payer, timestamp, verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          Date.now(),
          data.pinId,
          data.amount,
          data.token,
          data.txHash,
          data.payer,
          new Date().toISOString(),
          data.verified ? 1 : 0,
        ],
        CQL_DATABASE_ID
      );
    }
    // Memory mode: no payment persistence
  },

  async getPinsByOwner(ownerAddress: string): Promise<PinRecord[]> {
    if (DB_MODE === "covenantql") {
      const client = await getCQLClient();
      const result = await client.query<PinRecord>(
        `SELECT id, cid, name, status, size_bytes as "sizeBytes", created, owner_address as "ownerAddress"
         FROM pins WHERE owner_address = ?`,
        [ownerAddress],
        CQL_DATABASE_ID
      );
      return result.rows.map((row) => ({
        ...row,
        created: new Date(row.created as unknown as string),
      }));
    }

    return Array.from(memoryStore.pins.values()).filter(
      (p) => p.ownerAddress === ownerAddress
    );
  },

  async getStorageStats(): Promise<{
    totalPins: number;
    totalSizeBytes: number;
    totalSizeGB: number;
  }> {
    if (DB_MODE === "covenantql") {
      const client = await getCQLClient();
      const result = await client.query<{
        totalPins: number;
        totalSize: number;
      }>(
        `SELECT COUNT(*) as "totalPins", COALESCE(SUM(size_bytes), 0) as "totalSize" FROM pins`,
        [],
        CQL_DATABASE_ID
      );
      const row = result.rows[0] ?? { totalPins: 0, totalSize: 0 };
      return {
        totalPins: row.totalPins,
        totalSizeBytes: row.totalSize,
        totalSizeGB: row.totalSize / 1024 ** 3,
      };
    }

    const total = Array.from(memoryStore.pins.values()).reduce(
      (sum, p) => sum + p.sizeBytes,
      0
    );
    return {
      totalPins: memoryStore.pins.size,
      totalSizeBytes: total,
      totalSizeGB: total / 1024 ** 3,
    };
  },

  /** Get database mode */
  getMode(): DatabaseMode {
    return DB_MODE;
  },
};

export default database;
