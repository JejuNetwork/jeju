/**
 * Health Check Tests
 * Verifies IPFS node connectivity and database access
 * 
 * These tests require a running server. They skip gracefully if unavailable.
 */

import { describe, test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.IPFS_API_URL || 'http://localhost:3100';
let serverAvailable = false;

async function checkServer(): Promise<boolean> {
  const response = await fetch(`${BASE_URL}/health`, { 
    signal: AbortSignal.timeout(2000) 
  }).catch(() => null);
  return response?.ok ?? false;
}

describe('IPFS Service Health', () => {
  beforeAll(async () => {
    serverAvailable = await checkServer();
    if (!serverAvailable) {
      console.log(`⚠️  Server not running at ${BASE_URL} - skipping integration tests`);
    }
  });

  test('should respond to health check', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }
    
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.ok).toBe(true);
    
    const health = await response.json();
    expect(health.status).toBe('healthy');
  });

  test('should report IPFS node connection', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }
    
    const response = await fetch(`${BASE_URL}/health`);
    const health = await response.json();
    expect(health.ipfs).toBeDefined();
    
    // IPFS node may not be running in test environment
    if (health.ipfs.connected) {
      expect(health.ipfs.peerId).toBeDefined();
    }
  });

  test('should report database connection', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }
    
    const response = await fetch(`${BASE_URL}/health`);
    const health = await response.json();
    expect(health.database).toBeDefined();
    expect(typeof health.database.pins).toBe('number');
  });
});
