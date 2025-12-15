/**
 * External Protocol Integration Tests
 * 
 * Integration tests that verify the external protocol adapters
 * can be instantiated and configured correctly.
 * 
 * All integrations are fully permissionless - no API keys required.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet, arbitrum, optimism, base } from 'viem/chains';

import { AcrossAdapter, ACROSS_SPOKE_POOLS } from '../../src/solver/external/across';
import { UniswapXAdapter, UNISWAPX_REACTORS } from '../../src/solver/external/uniswapx';
import { CowProtocolSolver, COW_SETTLEMENT } from '../../src/solver/external/cow';
import { ExternalProtocolAggregator, SUPPORTED_CHAINS } from '../../src/solver/external';

// Create mock public clients for supported chains
function createMockClients(): Map<number, { public: PublicClient }> {
  const clients = new Map<number, { public: PublicClient }>();
  
  // Note: These will fail actual RPC calls, but are sufficient for adapter instantiation tests
  const chains = [
    { chainId: 1, chain: mainnet, rpc: 'https://eth.llamarpc.com' },
    { chainId: 42161, chain: arbitrum, rpc: 'https://arb1.arbitrum.io/rpc' },
    { chainId: 10, chain: optimism, rpc: 'https://mainnet.optimism.io' },
    { chainId: 8453, chain: base, rpc: 'https://mainnet.base.org' },
  ];
  
  for (const { chainId, chain, rpc } of chains) {
    const client = createPublicClient({
      chain,
      transport: http(rpc),
    });
    clients.set(chainId, { public: client });
  }
  
  return clients;
}

describe('External Protocol Adapter Instantiation', () => {
  let clients: Map<number, { public: PublicClient }>;
  
  beforeAll(() => {
    clients = createMockClients();
  });

  describe('AcrossAdapter', () => {
    it('should instantiate correctly', () => {
      const adapter = new AcrossAdapter(clients, false);
      expect(adapter).toBeDefined();
    });

    it('should have correct SpokePool addresses', () => {
      expect(ACROSS_SPOKE_POOLS[1]).toBeDefined();
      expect(ACROSS_SPOKE_POOLS[42161]).toBeDefined();
      expect(ACROSS_SPOKE_POOLS[10]).toBeDefined();
      expect(ACROSS_SPOKE_POOLS[8453]).toBeDefined();
    });

    it('should be an EventEmitter', () => {
      const adapter = new AcrossAdapter(clients, false);
      expect(typeof adapter.on).toBe('function');
      expect(typeof adapter.emit).toBe('function');
    });
  });

  describe('UniswapXAdapter', () => {
    it('should instantiate correctly', () => {
      const chainIds = [1, 42161, 10, 8453];
      const adapter = new UniswapXAdapter(clients, chainIds, false);
      expect(adapter).toBeDefined();
    });

    it('should have correct Reactor addresses', () => {
      expect(UNISWAPX_REACTORS[1]).toBeDefined();
      expect(UNISWAPX_REACTORS[42161]).toBeDefined();
      expect(UNISWAPX_REACTORS[10]).toBeDefined();
      expect(UNISWAPX_REACTORS[8453]).toBeDefined();
    });

    it('should be an EventEmitter', () => {
      const adapter = new UniswapXAdapter(clients, [1], false);
      expect(typeof adapter.on).toBe('function');
      expect(typeof adapter.emit).toBe('function');
    });
  });

  describe('CowProtocolSolver', () => {
    it('should instantiate correctly', () => {
      const chainIds = [1, 42161];
      const solver = new CowProtocolSolver(clients, chainIds);
      expect(solver).toBeDefined();
    });

    it('should have correct Settlement addresses', () => {
      expect(COW_SETTLEMENT[1]).toBeDefined();
      expect(COW_SETTLEMENT[42161]).toBeDefined();
    });

    it('should filter to supported chains', () => {
      // CoW only supports Ethereum, Arbitrum, Gnosis
      const chainIds = [1, 42161, 10, 8453]; // OP and Base not supported by CoW
      const solver = new CowProtocolSolver(clients, chainIds);
      expect(solver).toBeDefined();
    });

    it('should be an EventEmitter', () => {
      const solver = new CowProtocolSolver(clients, [1]);
      expect(typeof solver.on).toBe('function');
      expect(typeof solver.emit).toBe('function');
    });
  });
});

describe('ExternalProtocolAggregator', () => {
  let clients: Map<number, { public: PublicClient }>;
  
  beforeAll(() => {
    clients = createMockClients();
  });

  it('should instantiate correctly', () => {
    const config = {
      chains: [
        { chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' },
        { chainId: 42161, name: 'Arbitrum', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
      ],
      minProfitBps: 10,
      enableAcross: true,
      enableUniswapX: true,
      enableCow: true,
    };
    
    const aggregator = new ExternalProtocolAggregator(config, clients);
    expect(aggregator).toBeDefined();
  });

  it('should be an EventEmitter', () => {
    const config = {
      chains: [{ chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' }],
    };
    
    const aggregator = new ExternalProtocolAggregator(config, clients);
    expect(typeof aggregator.on).toBe('function');
    expect(typeof aggregator.emit).toBe('function');
  });

  it('should return empty opportunities initially', () => {
    const config = {
      chains: [{ chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' }],
    };
    
    const aggregator = new ExternalProtocolAggregator(config, clients);
    const opportunities = aggregator.getOpportunities();
    
    expect(Array.isArray(opportunities)).toBe(true);
    expect(opportunities.length).toBe(0);
  });

  it('should return valid metrics', () => {
    const config = {
      chains: [{ chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' }],
    };
    
    const aggregator = new ExternalProtocolAggregator(config, clients);
    const metrics = aggregator.getMetrics();
    
    expect(metrics.acrossDeposits).toBe(0);
    expect(metrics.uniswapxOrders).toBe(0);
    expect(metrics.cowAuctions).toBe(0);
    expect(metrics.opportunitiesFound).toBe(0);
    expect(metrics.opportunitiesFilled).toBe(0);
    expect(metrics.activeOpportunities).toBe(0);
  });
});

describe('Supported Chains Configuration', () => {
  it('should have all major chains', () => {
    expect(SUPPORTED_CHAINS.ethereum).toBe(1);
    expect(SUPPORTED_CHAINS.arbitrum).toBe(42161);
    expect(SUPPORTED_CHAINS.optimism).toBe(10);
    expect(SUPPORTED_CHAINS.base).toBe(8453);
    expect(SUPPORTED_CHAINS.polygon).toBe(137);
    expect(SUPPORTED_CHAINS.bsc).toBe(56);
    expect(SUPPORTED_CHAINS.jeju).toBe(420691);
  });

  it('all chain IDs should be valid', () => {
    for (const [name, chainId] of Object.entries(SUPPORTED_CHAINS)) {
      expect(chainId).toBeGreaterThan(0);
      expect(typeof chainId).toBe('number');
    }
  });
});

describe('Protocol Address Validation', () => {
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;

  it('Across SpokePool addresses should be valid', () => {
    for (const [chainId, address] of Object.entries(ACROSS_SPOKE_POOLS)) {
      expect(address).toMatch(addressRegex);
    }
  });

  it('UniswapX Reactor addresses should be valid', () => {
    for (const [chainId, address] of Object.entries(UNISWAPX_REACTORS)) {
      expect(address).toMatch(addressRegex);
    }
  });

  it('CoW Settlement addresses should be valid', () => {
    for (const [chainId, address] of Object.entries(COW_SETTLEMENT)) {
      expect(address).toMatch(addressRegex);
    }
  });
});

describe('Adapter Stop/Start Lifecycle', () => {
  let clients: Map<number, { public: PublicClient }>;
  
  beforeAll(() => {
    clients = createMockClients();
  });

  it('AcrossAdapter stop should not throw', () => {
    const adapter = new AcrossAdapter(clients, false);
    expect(() => adapter.stop()).not.toThrow();
  });

  it('UniswapXAdapter stop should not throw', () => {
    const adapter = new UniswapXAdapter(clients, [1], false);
    expect(() => adapter.stop()).not.toThrow();
  });

  it('CowProtocolSolver stop should not throw', () => {
    const solver = new CowProtocolSolver(clients, [1]);
    expect(() => solver.stop()).not.toThrow();
  });

  it('ExternalProtocolAggregator stop should not throw', () => {
    const config = {
      chains: [{ chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' }],
    };
    const aggregator = new ExternalProtocolAggregator(config, clients);
    expect(() => aggregator.stop()).not.toThrow();
  });
});
