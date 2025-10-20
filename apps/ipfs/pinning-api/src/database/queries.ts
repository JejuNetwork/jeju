/**
 * Database queries for pin management
 */

import { db, pins, payments } from './schema';
import { eq, and, or, sql } from 'drizzle-orm';

export const database = {
  // Create new pin
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
    const [result] = await db.insert(pins).values(data).returning({ id: pins.id });
    return result.id.toString();
  },

  // Get pin by ID
  async getPin(id: string) {
    const [result] = await db.select().from(pins).where(eq(pins.id, parseInt(id)));
    return result;
  },

  // List pins with filters
  async listPins(filters: {
    cid?: string;
    name?: string;
    status?: string;
    limit: number;
    offset: number;
  }) {
    let query = db.select().from(pins);

    if (filters.cid) {
      query = query.where(eq(pins.cid, filters.cid)) as any;
    }

    if (filters.status) {
      query = query.where(eq(pins.status, filters.status)) as any;
    }

    return query.limit(filters.limit).offset(filters.offset);
  },

  // Update pin
  async updatePin(id: string, data: Partial<typeof pins.$inferInsert>) {
    await db.update(pins).set(data).where(eq(pins.id, parseInt(id)));
  },

  // Count total pins
  async countPins() {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(pins);
    return result.count;
  },

  // Record payment
  async recordPayment(data: {
    pinId: number;
    amount: string;
    token: string;
    txHash: string;
    payer: string;
    verified: boolean;
  }) {
    await db.insert(payments).values(data);
  },

  // Get pins by owner
  async getPinsByOwner(ownerAddress: string) {
    return db.select().from(pins).where(eq(pins.ownerAddress, ownerAddress));
  },

  // Get storage stats
  async getStorageStats() {
    const [result] = await db
      .select({
        totalPins: sql<number>`count(*)`,
        totalSize: sql<number>`sum(${pins.sizeBytes})`,
      })
      .from(pins);
    
    return {
      totalPins: result.totalPins || 0,
      totalSizeBytes: result.totalSize || 0,
      totalSizeGB: (result.totalSize || 0) / (1024 ** 3),
    };
  },
};

export default database;

