/**
 * API Key Service Tests
 */

import { describe, test, expect } from 'bun:test';
import {
  createApiKey,
  validateApiKey,
  getApiKeysForAddress,
  revokeApiKeyById,
  getApiKeyStats,
} from '../../src/rpc/services/api-keys.js';

describe('API Key Service', () => {
  const testAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
  const testAddress2 = '0x0987654321098765432109876543210987654321' as `0x${string}`;

  test('creates API key with correct format', () => {
    const { key, record } = createApiKey(testAddress, 'Test Key');

    expect(key).toStartWith('jrpc_');
    expect(key.length).toBeGreaterThan(30);
    expect(record.address).toBe(testAddress);
    expect(record.name).toBe('Test Key');
    expect(record.tier).toBe('FREE');
    expect(record.isActive).toBe(true);
  });

  test('validates correct API key', () => {
    const { key } = createApiKey(testAddress, 'Valid Key');
    const record = validateApiKey(key);

    expect(record).not.toBeNull();
    expect(record?.address).toBe(testAddress);
  });

  test('rejects invalid API key', () => {
    const record = validateApiKey('jrpc_invalid_key_12345');
    expect(record).toBeNull();
  });

  test('increments request count on validation', () => {
    const { key } = createApiKey(testAddress, 'Counter Key');
    
    validateApiKey(key);
    validateApiKey(key);
    const record = validateApiKey(key);

    expect(record?.requestCount).toBe(3);
  });

  test('gets all keys for address', () => {
    createApiKey(testAddress, 'Key 1');
    createApiKey(testAddress, 'Key 2');
    createApiKey(testAddress2, 'Other Key');

    const keys = getApiKeysForAddress(testAddress);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys.every(k => k.address.toLowerCase() === testAddress.toLowerCase())).toBe(true);
  });

  test('revokes API key', () => {
    const { key, record } = createApiKey(testAddress, 'Revoke Test');
    
    const success = revokeApiKeyById(record.id, testAddress);
    expect(success).toBe(true);

    const validatedRecord = validateApiKey(key);
    expect(validatedRecord).toBeNull();
  });

  test('cannot revoke key owned by another address', () => {
    const { record } = createApiKey(testAddress, 'Protected Key');
    
    const success = revokeApiKeyById(record.id, testAddress2);
    expect(success).toBe(false);
  });

  test('returns correct stats', () => {
    const initialStats = getApiKeyStats();
    
    createApiKey(testAddress, 'Stats Test');
    
    const newStats = getApiKeyStats();
    expect(newStats.total).toBe(initialStats.total + 1);
    expect(newStats.active).toBe(initialStats.active + 1);
  });
});
