/**
 * Database schema for IPFS pin tracking
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pgTable, serial, text, timestamp, bigint, boolean, jsonb } from 'drizzle-orm/pg-core';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/jeju_ipfs';
const client = postgres(connectionString);
export const db = drizzle(client);

// Pin records table
export const pins = pgTable('pins', {
  id: serial('id').primaryKey(),
  cid: text('cid').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull(), // 'pinning', 'pinned', 'failed', 'unpinned'
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  created: timestamp('created').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
  origins: jsonb('origins').$type<string[]>(),
  metadata: jsonb('metadata'),
  
  // Payment tracking
  paidAmount: text('paid_amount'), // In token units (e.g., USDC)
  paymentToken: text('payment_token'), // Token address or 'USDC'
  paymentTxHash: text('payment_tx_hash'),
  
  // Owner tracking
  ownerAddress: text('owner_address'),
  ownerAgentId: bigint('owner_agent_id', { mode: 'number' }),
});

// Payment records
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  pinId: bigint('pin_id', { mode: 'number' }).references(() => pins.id),
  amount: text('amount').notNull(),
  token: text('token').notNull(),
  txHash: text('tx_hash').notNull(),
  payer: text('payer').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  verified: boolean('verified').notNull().default(false),
});

// Usage statistics
export const stats = pgTable('stats', {
  id: serial('id').primaryKey(),
  date: timestamp('date').notNull().defaultNow(),
  totalPins: bigint('total_pins', { mode: 'number' }).notNull(),
  totalSizeBytes: bigint('total_size_bytes', { mode: 'number' }).notNull(),
  totalRevenue: text('total_revenue').notNull(),
  activeUsers: bigint('active_users', { mode: 'number' }).notNull(),
});

