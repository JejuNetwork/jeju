/**
 * Database initialization for development
 * Creates database if it doesn't exist
 */

import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

export async function initDatabase() {
  const dbName = process.env.DATABASE_NAME || 'jeju_ipfs';
  const adminUrl = process.env.ADMIN_DATABASE_URL || 'postgresql://localhost:5432/postgres';
  
  console.log(`🔄 Initializing database: ${dbName}`);
  
  try {
    // Connect to postgres system database
    const adminClient = postgres(adminUrl, { max: 1 });
    const adminDb = drizzle(adminClient);
    
    // Check if database exists
    const result = await adminClient`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    
    if (result.length === 0) {
      // Database doesn't exist, create it
      console.log(`📦 Creating database: ${dbName}`);
      await adminClient.unsafe(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database created: ${dbName}`);
    } else {
      console.log(`✅ Database already exists: ${dbName}`);
    }
    
    await adminClient.end();
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    // Don't throw in dev mode - database might already exist
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
}

// Run if called directly
if (import.meta.main) {
  await initDatabase();
  process.exit(0);
}

export default initDatabase;

