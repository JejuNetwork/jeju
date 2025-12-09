/**
 * Test database setup
 * Uses in-memory storage when PostgreSQL is not available
 */

const USE_POSTGRES = !!process.env.TEST_DATABASE_URL;

export async function setupTestDatabase() {
  if (USE_POSTGRES) {
    const postgres = await import('postgres');
    const TEST_DB_NAME = 'jeju_ipfs_test';
    const ADMIN_CONNECTION = process.env.ADMIN_DATABASE_URL || 'postgresql://localhost:5432/postgres';
    const adminClient = postgres.default(ADMIN_CONNECTION, { max: 1 });
    
    await adminClient.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await adminClient.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
    await adminClient.end();
    
    process.env.DATABASE_URL = `postgresql://localhost:5432/${TEST_DB_NAME}`;
    
    const migrate = await import('./migrate');
    await migrate.default();
    
    console.log('✅ PostgreSQL test database setup complete');
  } else {
    // Use in-memory storage - no setup needed
    delete process.env.DATABASE_URL;
    console.log('✅ Using in-memory storage for tests');
  }
}

export async function teardownTestDatabase() {
  if (USE_POSTGRES) {
    const postgres = await import('postgres');
    const TEST_DB_NAME = 'jeju_ipfs_test';
    const ADMIN_CONNECTION = process.env.ADMIN_DATABASE_URL || 'postgresql://localhost:5432/postgres';
    const adminClient = postgres.default(ADMIN_CONNECTION, { max: 1 });
    
    await adminClient.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await adminClient.end();
    console.log('✅ PostgreSQL test database cleaned up');
  }
  // In-memory mode: cleanup happens automatically
}
