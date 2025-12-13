import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getTestDataSource, closeTestDataSource, isDatabaseAvailable } from './setup';
import type { DataSource } from 'typeorm';

let ds: DataSource | null = null;
let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await isDatabaseAvailable();
  if (dbAvailable) {
    ds = await getTestDataSource();
  }
});

afterAll(async () => {
  await closeTestDataSource();
});

describe('Database Integration', () => {
  it('should check database availability', async () => {
    if (!dbAvailable) {
      console.log('⏭️ Database not available - skipping integration tests');
      console.log('   Run: bun run db:up to start the database');
      return;
    }
    expect(ds).toBeDefined();
    expect(ds?.isInitialized).toBe(true);
  });

  it('should execute raw SQL queries', async () => {
    if (!dbAvailable || !ds) return;
    
    const result = await ds.query('SELECT 1 as value');
    expect(result[0].value).toBe(1);
  });

  it('should have registered_agent table', async () => {
    if (!dbAvailable || !ds) return;

    const { RegisteredAgent } = await import('../../src/model');
    const repo = ds.getRepository(RegisteredAgent);
    const count = await repo.count();
    expect(typeof count).toBe('number');
  });

  it('should insert and query agents', async () => {
    if (!dbAvailable || !ds) return;

    const { RegisteredAgent, Account } = await import('../../src/model');
    const agentRepo = ds.getRepository(RegisteredAgent);
    const accountRepo = ds.getRepository(Account);

    // Create test account first
    const account = accountRepo.create({
      id: 'test-account-1',
      address: '0x1234567890123456789012345678901234567890',
      isContract: false,
      transactionCount: 0,
      firstSeen: new Date(),
      lastSeen: new Date(),
    });
    await accountRepo.save(account);

    // Create test agent
    const agent = agentRepo.create({
      id: 'test-agent-1',
      agentId: 1n,
      owner: account,
      name: 'Test Agent',
      description: 'A test agent for integration testing',
      tags: ['test', 'integration'],
      tokenURI: 'ipfs://test',
      stakeToken: '0x0000000000000000000000000000000000000000',
      stakeAmount: 1000n,
      stakeTier: 2,
      registeredAt: new Date(),
      active: true,
      isBanned: false,
      serviceType: 'rest',
      category: 'agent',
      x402Support: false,
      mcpTools: [],
      a2aSkills: [],
    });
    await agentRepo.save(agent);

    // Query it back
    const found = await agentRepo.findOne({ where: { agentId: 1n } });
    expect(found).toBeDefined();
    expect(found?.name).toBe('Test Agent');
    expect(found?.tags).toContain('test');
  });

  it('should filter agents by active status', async () => {
    if (!dbAvailable || !ds) return;

    const { RegisteredAgent } = await import('../../src/model');
    const repo = ds.getRepository(RegisteredAgent);

    const activeAgents = await repo.find({ where: { active: true } });
    const inactiveAgents = await repo.find({ where: { active: false } });

    // All our test agents should be active
    expect(activeAgents.length).toBeGreaterThan(0);
    expect(inactiveAgents.length).toBe(0);
  });

  it('should query with TypeORM query builder', async () => {
    if (!dbAvailable || !ds) return;

    const { RegisteredAgent } = await import('../../src/model');
    const repo = ds.getRepository(RegisteredAgent);

    const results = await repo.createQueryBuilder('a')
      .where('a.active = :active', { active: true })
      .andWhere('a.stakeTier >= :tier', { tier: 1 })
      .orderBy('a.stakeTier', 'DESC')
      .getMany();

    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle tag array queries', async () => {
    if (!dbAvailable || !ds) return;

    const { RegisteredAgent } = await import('../../src/model');
    const repo = ds.getRepository(RegisteredAgent);

    // PostgreSQL array contains query
    const results = await repo.createQueryBuilder('a')
      .where("a.tags && ARRAY[:...tags]::text[]", { tags: ['test'] })
      .getMany();

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].tags).toContain('test');
  });
});

describe('Search Integration', () => {
  it('should run full-text search query', async () => {
    if (!dbAvailable || !ds) return;

    // Test the raw search query that search.ts uses
    const rawQuery = `
      SELECT a.*, 
        ts_rank_cd(
          to_tsvector('english', COALESCE(a.name, '') || ' ' || COALESCE(a.description, '')),
          plainto_tsquery('english', $1),
          32
        ) as rank
      FROM registered_agent a
      WHERE a.active = $2
        AND (
          to_tsvector('english', COALESCE(a.name, '') || ' ' || COALESCE(a.description, ''))
          @@ plainto_tsquery('english', $1)
          OR LOWER(a.name) LIKE LOWER($3)
        )
      ORDER BY rank DESC
      LIMIT $4
    `;

    const results = await ds.query(rawQuery, ['test', true, '%test%', 10]);
    expect(Array.isArray(results)).toBe(true);
    
    if (results.length > 0) {
      expect(results[0].name).toBeDefined();
      expect(results[0].rank).toBeDefined();
    }
  });
});

describe('Provider Integration', () => {
  it('should insert and query compute providers', async () => {
    if (!dbAvailable || !ds) return;

    const { ComputeProvider } = await import('../../src/model');
    const repo = ds.getRepository(ComputeProvider);

    const provider = repo.create({
      id: 'test-compute-1',
      address: '0xabcdef1234567890abcdef1234567890abcdef12',
      name: 'Test Compute Provider',
      endpoint: 'https://compute.test.local',
      agentId: 1,
      stake: 1000n,
      isActive: true,
      registeredAt: new Date(),
      lastHeartbeat: new Date(),
    });
    await repo.save(provider);

    const found = await repo.findOne({ where: { address: provider.address.toLowerCase() } });
    expect(found).toBeDefined();
    expect(found?.name).toBe('Test Compute Provider');
  });

  it('should insert and query storage providers', async () => {
    if (!dbAvailable || !ds) return;

    const { StorageProvider } = await import('../../src/model');
    const repo = ds.getRepository(StorageProvider);

    const provider = repo.create({
      id: 'test-storage-1',
      address: '0x1234abcdef1234567890abcdef1234567890abcd',
      name: 'Test Storage Provider',
      endpoint: 'https://storage.test.local',
      agentId: 1,
      stake: 500n,
      isActive: true,
      registeredAt: new Date(),
      lastHeartbeat: new Date(),
      totalStorageBytes: 1000000n,
      usedStorageBytes: 500000n,
    });
    await repo.save(provider);

    const found = await repo.findOne({ where: { address: provider.address.toLowerCase() } });
    expect(found).toBeDefined();
    expect(found?.totalStorageBytes).toBe(1000000n);
  });
});
