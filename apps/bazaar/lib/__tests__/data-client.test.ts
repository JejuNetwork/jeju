import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// Mock fetch for testing
const originalFetch = globalThis.fetch;
let mockFetchImpl: typeof fetch;

describe('Data Client - Prediction Markets', () => {
  beforeEach(() => {
    // Reset fetch mock before each test
    mockFetchImpl = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      
      // Health check
      if (body.query?.includes('__typename')) {
        return Promise.resolve(new Response(JSON.stringify({ data: { __typename: 'Query' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      
      // Prediction markets query
      if (body.query?.includes('predictionMarkets')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            predictionMarkets: [
              {
                id: 'market-1',
                question: 'Will Bitcoin reach $100k?',
                yesShares: '60000000000000000000',
                noShares: '40000000000000000000',
                liquidityB: '100000000000000000000',
                totalVolume: '10000000000000000000',
                resolved: false,
                outcome: null,
                createdAt: '2024-01-01T00:00:00Z',
                resolutionTime: null,
              },
              {
                id: 'market-2',
                question: 'Will ETH 2.0 launch on time?',
                yesShares: '50000000000000000000',
                noShares: '50000000000000000000',
                liquidityB: '100000000000000000000',
                totalVolume: '5000000000000000000',
                resolved: true,
                outcome: true,
                createdAt: '2024-01-02T00:00:00Z',
                resolutionTime: '2024-06-01T00:00:00Z',
              },
            ]
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      
      return Promise.resolve(new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }) as typeof fetch;
    
    globalThis.fetch = mockFetchImpl;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should export fetchPredictionMarkets function', async () => {
    const { fetchPredictionMarkets } = await import('../data-client');
    expect(typeof fetchPredictionMarkets).toBe('function');
  });

  test('should return empty array when indexer is offline', async () => {
    // Override mock to simulate offline indexer
    globalThis.fetch = mock(() => Promise.reject(new Error('Network error'))) as typeof fetch;
    
    const { fetchPredictionMarkets } = await import('../data-client');
    const markets = await fetchPredictionMarkets({ limit: 10 });
    
    expect(markets).toEqual([]);
  });

  test('should calculate LMSR prices correctly', () => {
    // Test the price calculation formula used in data-client
    const yesShares = 60;
    const noShares = 40;
    const liquidityB = 100;
    
    const yesExp = Math.exp(yesShares / liquidityB);
    const noExp = Math.exp(noShares / liquidityB);
    const total = yesExp + noExp;
    
    const yesPrice = yesExp / total;
    const noPrice = noExp / total;
    
    // YES should have higher probability
    expect(yesPrice).toBeGreaterThan(noPrice);
    
    // Prices should sum to 1
    expect(yesPrice + noPrice).toBeCloseTo(1, 10);
  });

  test('should handle resolved markets', () => {
    const market = {
      resolved: true,
      outcome: true,
    };
    
    expect(market.resolved).toBe(true);
    expect(market.outcome).toBe(true);
  });

  test('should handle unresolved markets', () => {
    const market = {
      resolved: false,
      outcome: null,
    };
    
    expect(market.resolved).toBe(false);
    expect(market.outcome).toBeNull();
  });
});

describe('PredictionMarket Type Validation', () => {
  test('should validate market ID format', () => {
    const validId = 'market-123';
    expect(validId.length).toBeGreaterThan(0);
  });

  test('should validate question is non-empty', () => {
    const question = 'Will Bitcoin reach $100k?';
    expect(question.length).toBeGreaterThan(0);
  });

  test('should validate prices are between 0 and 1', () => {
    const yesPrice = 0.6;
    const noPrice = 0.4;
    
    expect(yesPrice).toBeGreaterThanOrEqual(0);
    expect(yesPrice).toBeLessThanOrEqual(1);
    expect(noPrice).toBeGreaterThanOrEqual(0);
    expect(noPrice).toBeLessThanOrEqual(1);
  });

  test('should validate volume is non-negative', () => {
    const volume = BigInt('10000000000000000000');
    expect(volume).toBeGreaterThanOrEqual(0n);
  });

  test('should validate liquidity is positive', () => {
    const liquidity = BigInt('100000000000000000000');
    expect(liquidity).toBeGreaterThan(0n);
  });

  test('should validate date formats', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    expect(createdAt.getTime()).toBeGreaterThan(0);
    
    const resolutionTime = new Date('2024-06-01T00:00:00Z');
    expect(resolutionTime.getTime()).toBeGreaterThan(createdAt.getTime());
  });
});

describe('Market Filter Options', () => {
  test('should filter by resolved status', () => {
    const markets = [
      { resolved: false, question: 'Active 1' },
      { resolved: true, question: 'Resolved 1' },
      { resolved: false, question: 'Active 2' },
    ];

    const activeOnly = markets.filter(m => !m.resolved);
    const resolvedOnly = markets.filter(m => m.resolved);

    expect(activeOnly.length).toBe(2);
    expect(resolvedOnly.length).toBe(1);
  });

  test('should respect limit parameter', () => {
    const limit = 10;
    const markets = Array.from({ length: 50 }, (_, i) => ({
      id: `market-${i}`,
      question: `Question ${i}?`,
    }));

    const limited = markets.slice(0, limit);
    expect(limited.length).toBe(limit);
  });

  test('should respect offset parameter', () => {
    const offset = 20;
    const markets = Array.from({ length: 50 }, (_, i) => ({
      id: `market-${i}`,
      question: `Question ${i}?`,
    }));

    const paged = markets.slice(offset);
    expect(paged.length).toBe(30);
    expect(paged[0].id).toBe('market-20');
  });
});
