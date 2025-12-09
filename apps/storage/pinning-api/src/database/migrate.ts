/**
 * Database migration runner
 * Creates all tables for IPFS pin tracking
 */

import { db } from './schema';
import { sql } from 'drizzle-orm';

async function migrate() {
  console.log('🔄 Running database migrations...');
  
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pins (
      id SERIAL PRIMARY KEY,
      cid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      size_bytes BIGINT,
      created TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP,
      origins JSONB,
      metadata JSONB,
      paid_amount TEXT,
      payment_token TEXT,
      payment_tx_hash TEXT,
      owner_address TEXT,
      owner_agent_id BIGINT
    )
  `);
  
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      pin_id BIGINT REFERENCES pins(id),
      amount TEXT NOT NULL,
      token TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      payer TEXT NOT NULL,
      timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
      verified BOOLEAN NOT NULL DEFAULT false
    )
  `);
  
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stats (
      id SERIAL PRIMARY KEY,
      date TIMESTAMP NOT NULL DEFAULT NOW(),
      total_pins BIGINT NOT NULL,
      total_size_bytes BIGINT NOT NULL,
      total_revenue TEXT NOT NULL,
      active_users BIGINT NOT NULL
    )
  `);
  
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pins_owner ON pins(owner_address)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pins_created ON pins(created)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payments_pin ON payments(pin_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer)`);
  
  console.log('✅ Database migrations complete');
  console.log('📊 Tables created: pins, payments, stats');
  console.log('📇 Indexes created: owner, status, created, pin_id, payer');
}

// Run if called directly
if (import.meta.main) {
  await migrate();
  process.exit(0);
}

export default migrate;

