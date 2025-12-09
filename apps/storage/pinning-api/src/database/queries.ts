/**
 * Database queries for pin management
 * 
 * Mode determined by DATABASE_URL:
 * - If set: PostgreSQL (fail-fast if unavailable)
 * - If not set: In-memory storage (development only)
 */

import { db, pins, payments } from './schema';
import { eq, and, sql } from 'drizzle-orm';

// Storage mode determined at startup
const USE_POSTGRES = !!process.env.DATABASE_URL;

if (!USE_POSTGRES) {
  console.log('📦 DATABASE_URL not set - using in-memory storage');
}

// In-memory store for development
const memoryStore = {
  pins: new Map<string, { id: number; cid: string; name: string; status: string; created: Date; sizeBytes: number; ownerAddress?: string }>(),
  nextId: 1,
};

export const database = {
  async createPin(data: {
    cid: string;
    name: string;
    status: string;
    created: Date;
    sizeBytes?: number;
    origins?: string[];
    ownerAddress?: string;
    paidAmount?: string;
    expiresAt?: Date;
  }) {
    if (USE_POSTGRES) {
      const [result] = await db.insert(pins).values(data).returning({ id: pins.id });
      return result.id.toString();
    }
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

  async getPin(id: string) {
    if (USE_POSTGRES) {
      const [result] = await db.select().from(pins).where(eq(pins.id, parseInt(id)));
      return result;
    }
    return memoryStore.pins.get(id);
  },

  async listPins(filters: { cid?: string; name?: string; status?: string; limit: number; offset: number }) {
    if (USE_POSTGRES) {
      const conditions = [];
      if (filters.cid) conditions.push(eq(pins.cid, filters.cid));
      if (filters.status) conditions.push(eq(pins.status, filters.status));
      const query = conditions.length > 0 
        ? db.select().from(pins).where(and(...conditions))
        : db.select().from(pins);
      return query.limit(filters.limit).offset(filters.offset);
    }
    let results = Array.from(memoryStore.pins.values());
    if (filters.cid) results = results.filter(p => p.cid === filters.cid);
    if (filters.status) results = results.filter(p => p.status === filters.status);
    return results.slice(filters.offset, filters.offset + filters.limit);
  },

  async updatePin(id: string, data: Partial<typeof pins.$inferInsert>) {
    if (USE_POSTGRES) {
      await db.update(pins).set(data).where(eq(pins.id, parseInt(id)));
      return;
    }
    const existing = memoryStore.pins.get(id);
    if (existing) memoryStore.pins.set(id, { ...existing, ...data } as typeof existing);
  },

  async countPins() {
    if (USE_POSTGRES) {
      const [result] = await db.select({ count: sql<number>`count(*)` }).from(pins);
      return result.count;
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
  }) {
    if (USE_POSTGRES) {
      await db.insert(payments).values(data);
    }
    // In-memory mode: no payment persistence
  },

  async getPinsByOwner(ownerAddress: string) {
    if (USE_POSTGRES) {
      return db.select().from(pins).where(eq(pins.ownerAddress, ownerAddress));
    }
    return Array.from(memoryStore.pins.values()).filter(p => p.ownerAddress === ownerAddress);
  },

  async getStorageStats() {
    if (USE_POSTGRES) {
      const [result] = await db
        .select({
          totalPins: sql<number>`count(*)`,
          totalSize: sql<number>`coalesce(sum(${pins.sizeBytes}), 0)`,
        })
        .from(pins);
      return {
        totalPins: result.totalPins,
        totalSizeBytes: result.totalSize,
        totalSizeGB: result.totalSize / (1024 ** 3),
      };
    }
    const total = Array.from(memoryStore.pins.values()).reduce((sum, p) => sum + p.sizeBytes, 0);
    return {
      totalPins: memoryStore.pins.size,
      totalSizeBytes: total,
      totalSizeGB: total / (1024 ** 3),
    };
  },
};

export default database;
