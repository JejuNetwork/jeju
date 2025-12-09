import { describe, test, expect, beforeAll } from 'bun:test';
import { getJejuTokens, getTokenTransfers, getTokenHolders } from '../indexer-client';

// Check if indexer is available
let indexerAvailable = false;

describe('Indexer Client', () => {
  beforeAll(async () => {
    // Try to connect to indexer
    const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql';
    try {
      const response = await fetch(indexerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      });
      indexerAvailable = response.ok;
    } catch {
      indexerAvailable = false;
    }
    
    if (!indexerAvailable) {
      console.log('   ⚠️ Indexer not available at ' + indexerUrl + '. Live tests will be skipped.');
    }
  });

  test('should fetch Jeju tokens', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available');
      return;
    }
    const tokens = await getJejuTokens({ limit: 10 });
    expect(tokens).toBeDefined();
    expect(Array.isArray(tokens)).toBe(true);
  });

  test('should filter tokens with limit', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available');
      return;
    }
    const tokens = await getJejuTokens({ limit: 5 });
    expect(Array.isArray(tokens)).toBe(true);
    if (tokens.length > 0) {
      expect(tokens.length).toBeLessThanOrEqual(5);
    }
  });

  test('should fetch token transfers', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available');
      return;
    }
    const mockAddress = '0x0000000000000000000000000000000000000001';
    const transfers = await getTokenTransfers(mockAddress, 10);
    expect(transfers).toBeDefined();
    expect(Array.isArray(transfers)).toBe(true);
  });

  test('should fetch token holders', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available');
      return;
    }
    const mockAddress = '0x0000000000000000000000000000000000000001';
    const holders = await getTokenHolders(mockAddress, 10);
    expect(holders).toBeDefined();
    expect(Array.isArray(holders)).toBe(true);
  });

  test('should return empty array for non-existent address', async () => {
    if (!indexerAvailable) {
      console.log('⏭️ Skipping: Indexer not available');
      return;
    }
    // Invalid addresses just return empty results - no validation at this layer
    const transfers = await getTokenTransfers('invalid-address', 10);
    expect(Array.isArray(transfers)).toBe(true);
  });
  
  test('indexer client module should be importable', () => {
    expect(typeof getJejuTokens).toBe('function');
    expect(typeof getTokenTransfers).toBe('function');
    expect(typeof getTokenHolders).toBe('function');
  });
});

