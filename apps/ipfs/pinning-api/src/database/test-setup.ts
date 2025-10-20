/**
 * Test database setup
 * Creates a test database and runs migrations
 */

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import migrate from './migrate';

const TEST_DB_NAME = 'jeju_ipfs_test';
const ADMIN_CONNECTION = process.env.ADMIN_DATABASE_URL || 'postgresql://localhost:5432/postgres';

export async function setupTestDatabase() {
  // Connect to postgres admin database
  const adminClient = postgres(ADMIN_CONNECTION, { max: 1 });
  
  try {
    // Drop and recreate test database
    await adminClient.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await adminClient.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
    
    await adminClient.end();
    
    // Connect to test database and run migrations
    process.env.DATABASE_URL = `postgresql://localhost:5432/${TEST_DB_NAME}`;
    
    await migrate();
    
    console.log('✅ Test database setup complete');
  } catch (error) {
    console.error('❌ Test database setup failed:', error);
    await adminClient.end();
    throw error;
  }
}

export async function teardownTestDatabase() {
  const adminClient = postgres(ADMIN_CONNECTION, { max: 1 });
  
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await adminClient.end();
    console.log('✅ Test database cleaned up');
  } catch (error) {
    console.error('⚠️  Test database cleanup failed:', error);
    await adminClient.end();
  }
}

