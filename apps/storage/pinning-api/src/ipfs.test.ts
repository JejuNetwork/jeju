/**
 * IPFS Pinning Service Tests
 * Tests database operations using in-memory storage
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupTestDatabase, teardownTestDatabase } from './database/test-setup';

// Import database after setup so it picks up the correct mode
let db: typeof import('./database').default;

describe('IPFS Pinning Service - Database', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    // Dynamic import to get fresh module with correct DATABASE_URL state
    const module = await import('./database');
    db = module.default;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  test('should create a pin record', async () => {
    const pinId = await db.createPin({
      cid: 'QmTest123',
      name: 'test-pin',
      status: 'pinned',
      created: new Date(),
      sizeBytes: 1024,
    });

    expect(pinId).toBeDefined();
    expect(typeof pinId).toBe('string');
  });

  test('should retrieve pin by ID', async () => {
    const pinId = await db.createPin({
      cid: 'QmTest456',
      name: 'test-pin-2',
      status: 'pinned',
      created: new Date(),
    });

    const pin = await db.getPin(pinId);
    expect(pin).toBeDefined();
    expect(pin!.cid).toBe('QmTest456');
    expect(pin!.name).toBe('test-pin-2');
  });

  test('should list pins with filters', async () => {
    await db.createPin({
      cid: 'QmTest789',
      name: 'pinned-file',
      status: 'pinned',
      created: new Date(),
    });

    await db.createPin({
      cid: 'QmTest000',
      name: 'failed-file',
      status: 'failed',
      created: new Date(),
    });

    const pinnedPins = await db.listPins({
      status: 'pinned',
      limit: 10,
      offset: 0,
    });

    expect(pinnedPins.length).toBeGreaterThan(0);
    expect(pinnedPins.every(p => p.status === 'pinned')).toBe(true);
  });

  test('should count total pins', async () => {
    const count = await db.countPins();
    expect(count).toBeGreaterThan(0);
  });

  test('should get storage stats', async () => {
    const stats = await db.getStorageStats();
    expect(stats.totalPins).toBeGreaterThan(0);
    expect(stats.totalSizeBytes).toBeGreaterThanOrEqual(0);
    expect(stats.totalSizeGB).toBeGreaterThanOrEqual(0);
  });

  test('should record payment (no-op in memory mode)', async () => {
    const pinId = await db.createPin({
      cid: 'QmTestPayment',
      name: 'paid-pin',
      status: 'pinned',
      created: new Date(),
    });

    // This is a no-op in memory mode but should not throw
    await db.recordPayment({
      pinId: parseInt(pinId),
      amount: '1000000',
      token: 'USDC',
      txHash: '0x123',
      payer: '0xabc',
      verified: true,
    });
  });

  test('should update pin status', async () => {
    const pinId = await db.createPin({
      cid: 'QmTestUpdate',
      name: 'update-test',
      status: 'pinning',
      created: new Date(),
    });

    await db.updatePin(pinId, { status: 'pinned' });

    const updated = await db.getPin(pinId);
    expect(updated!.status).toBe('pinned');
  });

  test('should get pins by owner', async () => {
    const ownerAddress = '0x1234567890123456789012345678901234567890';
    
    await db.createPin({
      cid: 'QmOwnerTest1',
      name: 'owner-pin-1',
      status: 'pinned',
      created: new Date(),
      ownerAddress,
    });

    await db.createPin({
      cid: 'QmOwnerTest2',
      name: 'owner-pin-2',
      status: 'pinned',
      created: new Date(),
      ownerAddress,
    });

    const ownerPins = await db.getPinsByOwner(ownerAddress);
    expect(ownerPins.length).toBe(2);
    expect(ownerPins.every(p => p.ownerAddress === ownerAddress)).toBe(true);
  });
});
