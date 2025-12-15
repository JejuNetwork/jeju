/**
 * Service Integration Tests
 * 
 * Tests individual service integrations in isolation
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { Address } from 'viem';

// Test wallet address
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;

describe('Cache Service', () => {
  test('should set and get values', async () => {
    const { getCache } = await import('../services/cache');
    const cache = getCache();
    
    await cache.set('test-key', { foo: 'bar' }, 5000);
    const result = await cache.get<{ foo: string }>('test-key');
    
    expect(result).toEqual({ foo: 'bar' });
  });

  test('should return null for missing keys', async () => {
    const { getCache } = await import('../services/cache');
    const cache = getCache();
    
    const result = await cache.get('nonexistent-key');
    expect(result).toBeNull();
  });

  test('should delete values', async () => {
    const { getCache } = await import('../services/cache');
    const cache = getCache();
    
    await cache.set('delete-test', 'value');
    await cache.delete('delete-test');
    const result = await cache.get('delete-test');
    
    expect(result).toBeNull();
  });
});

describe('KMS Service', () => {
  test('should encrypt and decrypt data', async () => {
    const { getKMSService } = await import('../services/kms');
    const kms = getKMSService();
    
    const originalData = 'sensitive information';
    const encrypted = await kms.encrypt(originalData, TEST_ADDRESS);
    
    expect(encrypted).not.toBe(originalData);
    expect(encrypted.length).toBeGreaterThan(0);
    
    const decrypted = await kms.decrypt(encrypted, TEST_ADDRESS);
    expect(decrypted).toBe(originalData);
  });

  test('should handle local fallback encryption', async () => {
    const { getKMSService } = await import('../services/kms');
    const kms = getKMSService();
    
    // Force fallback by encrypting (KMS endpoint not available)
    const data = 'test data';
    const encrypted = await kms.encrypt(data, TEST_ADDRESS);
    
    // Should start with 'local:' prefix in fallback mode
    if (encrypted.startsWith('local:')) {
      const decrypted = await kms.decrypt(encrypted, TEST_ADDRESS);
      expect(decrypted).toBe(data);
    }
  });
});

describe('Storage Service', () => {
  test('should upload and retrieve files', async () => {
    const { getStorageService } = await import('../services/storage');
    const storage = getStorageService();
    
    const testData = new TextEncoder().encode('Hello, IPFS!');
    const cid = await storage.upload(testData, 'test.txt', TEST_ADDRESS);
    
    expect(cid).toBeDefined();
    expect(cid.length).toBeGreaterThan(0);
    
    const retrieved = await storage.retrieve(cid);
    expect(new TextDecoder().decode(retrieved)).toBe('Hello, IPFS!');
  });

  test('should generate correct gateway URLs', async () => {
    const { getStorageService } = await import('../services/storage');
    const storage = getStorageService();
    
    const url = storage.getUrl('QmTest123');
    expect(url).toContain('ipfs');
    expect(url).toContain('QmTest123');
  });
});

describe('Cron Service', () => {
  test('should schedule reminders', async () => {
    const { getCronService } = await import('../services/cron');
    const cron = getCronService();
    
    const reminderTime = Date.now() + 60000; // 1 minute from now
    const reminder = await cron.scheduleReminder('todo-123', TEST_ADDRESS, reminderTime);
    
    expect(reminder.id).toBeDefined();
    expect(reminder.todoId).toBe('todo-123');
    expect(reminder.reminderTime).toBe(reminderTime);
    expect(reminder.sent).toBe(false);
  });

  test('should list reminders for owner', async () => {
    const { getCronService } = await import('../services/cron');
    const cron = getCronService();
    
    // Schedule a reminder first
    await cron.scheduleReminder('todo-list-test', TEST_ADDRESS, Date.now() + 60000);
    
    const reminders = await cron.listReminders(TEST_ADDRESS);
    expect(reminders).toBeInstanceOf(Array);
  });
});

describe('JNS Service', () => {
  test('should normalize names correctly', async () => {
    const { getJNSService } = await import('../services/jns');
    const jns = getJNSService();
    
    // Test name normalization via price check (doesn't require registration)
    const price1 = await jns.getRegistrationPrice('test', 1);
    const price2 = await jns.getRegistrationPrice('test.jeju', 1);
    
    // Both should return the same price since they normalize to the same name
    expect(price1).toBe(price2);
  });

  test('should calculate prices based on name length', async () => {
    const { getJNSService } = await import('../services/jns');
    const jns = getJNSService();
    
    const shortNamePrice = await jns.getRegistrationPrice('ab', 1);
    const longNamePrice = await jns.getRegistrationPrice('abcdefgh', 1);
    
    // Short names should be more expensive
    expect(shortNamePrice).toBeGreaterThan(longNamePrice);
  });
});

describe('Cache Keys', () => {
  test('should generate consistent keys', async () => {
    const { cacheKeys } = await import('../services/cache');
    
    const key1 = cacheKeys.todoList(TEST_ADDRESS);
    const key2 = cacheKeys.todoList(TEST_ADDRESS);
    
    expect(key1).toBe(key2);
  });

  test('should include address in keys', async () => {
    const { cacheKeys } = await import('../services/cache');
    
    const key = cacheKeys.todoList(TEST_ADDRESS);
    expect(key).toContain(TEST_ADDRESS.toLowerCase());
  });
});
