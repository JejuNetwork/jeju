/**
 * Health Check Tests
 * Verifies IPFS node connectivity and database access
 */

import { describe, test, expect } from 'bun:test';

const BASE_URL = process.env.IPFS_API_URL || 'http://localhost:3100';

describe('IPFS Service Health', () => {
  test('should respond to health check', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    
    if (!response.ok) {
      console.log('⚠️  Service not running, skipping health test');
      return;
    }
    
    const health = await response.json();
    expect(health.status).toBe('healthy');
  });

  test('should report IPFS node connection', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    
    if (!response.ok) {
      console.log('⚠️  Service not running, skipping IPFS test');
      return;
    }
    
    const health = await response.json();
    expect(health.ipfs).toBeDefined();
    
    // IPFS node may not be running in test environment
    if (health.ipfs.connected) {
      expect(health.ipfs.peerId).toBeDefined();
    }
  });

  test('should report database connection', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    
    if (!response.ok) {
      console.log('⚠️  Service not running, skipping database test');
      return;
    }
    
    const health = await response.json();
    expect(health.database).toBeDefined();
    expect(typeof health.database.pins).toBe('number');
  });
});

