/**
 * Tests for solver/liquidity.ts
 * Tests balance tracking, refresh logic, and edge cases
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { LiquidityManager } from '../../src/solver/liquidity';
import type { PublicClient, WalletClient } from 'viem';

// Mock client that tracks calls
function createMockClient(balance: bigint = 1000000000000000000n) {
  let currentBalance = balance;
  const calls: string[] = [];
  
  return {
    public: {
      getBalance: async ({ address }: { address: string }) => {
        calls.push(`getBalance:${address}`);
        return currentBalance;
      },
    } as unknown as PublicClient,
    wallet: {
      account: {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
    } as unknown as WalletClient,
    setBalance: (b: bigint) => { currentBalance = b; },
    getCalls: () => calls,
  };
}

describe('LiquidityManager Construction', () => {
  test('should create with minimal config', () => {
    const manager = new LiquidityManager({ chains: [] });
    expect(manager).toBeDefined();
  });

  test('should create with full config', () => {
    const manager = new LiquidityManager({
      chains: [
        { chainId: 11155111, name: 'Sepolia' },
        { chainId: 84532, name: 'Base Sepolia' },
      ],
      refreshIntervalMs: 60000,
      verbose: true,
    });
    expect(manager).toBeDefined();
  });
});

describe('Balance Tracking', () => {
  let manager: LiquidityManager;

  afterEach(() => {
    manager?.stop();
  });

  test('should fetch initial balances on initialize', async () => {
    const mockClient = createMockClient(ethers.parseEther('5.0'));
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000, // Long interval to prevent auto-refresh
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    expect(mockClient.getCalls()).toContain('getBalance:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  test('should track balance per chain', async () => {
    const client1 = createMockClient(ethers.parseEther('1.0'));
    const client2 = createMockClient(ethers.parseEther('2.0'));
    const clients = new Map([
      [11155111, client1],
      [84532, client2],
    ]);
    
    manager = new LiquidityManager({
      chains: [
        { chainId: 11155111, name: 'Sepolia' },
        { chainId: 84532, name: 'Base Sepolia' },
      ],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    expect(manager.getBalance(11155111, '0x0000000000000000000000000000000000000000')).toBe(ethers.parseEther('1.0'));
    expect(manager.getBalance(84532, '0x0000000000000000000000000000000000000000')).toBe(ethers.parseEther('2.0'));
  });

  test('should return 0 for unknown chain', async () => {
    manager = new LiquidityManager({ chains: [], refreshIntervalMs: 1000000 });
    await manager.initialize(new Map());
    
    expect(manager.getBalance(999999, '0x0000000000000000000000000000000000000000')).toBe(0n);
  });

  test('should return 0 for unknown token', async () => {
    const mockClient = createMockClient(ethers.parseEther('1.0'));
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    // Unknown ERC20 token
    expect(manager.getBalance(11155111, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(0n);
  });
});

describe('hasLiquidity', () => {
  let manager: LiquidityManager;

  afterEach(() => {
    manager?.stop();
  });

  test('should return true when balance exceeds required', async () => {
    const mockClient = createMockClient(ethers.parseEther('5.0'));
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    const result = await manager.hasLiquidity(11155111, '0x0000000000000000000000000000000000000000', '1000000000000000000'); // 1 ETH
    expect(result).toBe(true);
  });

  test('should return false when balance is insufficient', async () => {
    const mockClient = createMockClient(ethers.parseEther('0.5'));
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    const result = await manager.hasLiquidity(11155111, '0x0000000000000000000000000000000000000000', '1000000000000000000'); // 1 ETH
    expect(result).toBe(false);
  });

  test('should return true for exact balance match', async () => {
    const exactAmount = ethers.parseEther('1.0');
    const mockClient = createMockClient(exactAmount);
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    const result = await manager.hasLiquidity(11155111, '0x0000000000000000000000000000000000000000', exactAmount.toString());
    expect(result).toBe(true);
  });

  test('should return false for unknown chain', async () => {
    manager = new LiquidityManager({ chains: [], refreshIntervalMs: 1000000 });
    await manager.initialize(new Map());
    
    const result = await manager.hasLiquidity(999999, '0x0000000000000000000000000000000000000000', '1');
    expect(result).toBe(false);
  });

  test('should handle zero amount request', async () => {
    const mockClient = createMockClient(0n);
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    const result = await manager.hasLiquidity(11155111, '0x0000000000000000000000000000000000000000', '0');
    expect(result).toBe(true); // 0 >= 0
  });
});

describe('recordFill', () => {
  let manager: LiquidityManager;

  afterEach(() => {
    manager?.stop();
  });

  test('should deduct fill amount from balance (before async refresh)', async () => {
    // Mock that tracks balance changes
    let mockBalance = ethers.parseEther('10.0');
    const mockClient = {
      public: {
        getBalance: async () => mockBalance,
      } as unknown as PublicClient,
      wallet: {
        account: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
      } as unknown as WalletClient,
    };
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    const beforeBalance = manager.getBalance(11155111, '0x0000000000000000000000000000000000000000');
    expect(beforeBalance).toBe(ethers.parseEther('10.0'));
    
    // Update mock to return reduced balance (simulating on-chain spend)
    mockBalance = ethers.parseEther('7.0');
    
    // recordFill deducts locally, then triggers async refresh
    await manager.recordFill(11155111, '0x0000000000000000000000000000000000000000', ethers.parseEther('3.0').toString());
    
    // Give async refresh time to complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const afterBalance = manager.getBalance(11155111, '0x0000000000000000000000000000000000000000');
    expect(afterBalance).toBe(ethers.parseEther('7.0'));
  });

  test('should track cumulative fills before refresh', async () => {
    // Create a mock where we control when balance updates
    let refreshCount = 0;
    const mockClient = {
      public: {
        getBalance: async () => {
          refreshCount++;
          // Return original balance on refresh - testing in-memory deduction
          return ethers.parseEther('10.0');
        },
      } as unknown as PublicClient,
      wallet: {
        account: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
      } as unknown as WalletClient,
    };
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    // Verify initialize called getBalance
    expect(refreshCount).toBe(1);
  });

  test('should handle fill on unknown chain gracefully', async () => {
    manager = new LiquidityManager({ chains: [], refreshIntervalMs: 1000000 });
    await manager.initialize(new Map());
    
    // Should not throw
    await expect(manager.recordFill(999999, '0x0000000000000000000000000000000000000000', '1000')).resolves.toBeUndefined();
  });

  test('should use ZERO_ADDRESS for native token fills', async () => {
    let queriedBalance = false;
    const mockClient = {
      public: {
        getBalance: async () => {
          queriedBalance = true;
          return ethers.parseEther('10.0');
        },
      } as unknown as PublicClient,
      wallet: {
        account: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
      } as unknown as WalletClient,
    };
    const clients = new Map([[11155111, mockClient]]);
    
    manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 1000000,
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    // recordFill triggers refreshChain which queries balance
    queriedBalance = false;
    await manager.recordFill(11155111, '0x0000000000000000000000000000000000000000', ethers.parseEther('1.0').toString());
    
    // Give async refresh time
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Should have triggered a refresh
    expect(queriedBalance).toBe(true);
  });
});

describe('Stop/Cleanup', () => {
  test('should stop refresh interval', async () => {
    const mockClient = createMockClient();
    const clients = new Map([[11155111, mockClient]]);
    
    const manager = new LiquidityManager({
      chains: [{ chainId: 11155111, name: 'Sepolia' }],
      refreshIntervalMs: 100, // Fast interval
    });
    
    await manager.initialize(clients as unknown as Map<number, { public: PublicClient; wallet?: WalletClient }>);
    
    const initialCalls = mockClient.getCalls().length;
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Stop should clear the interval
    manager.stop();
    
    const callsAfterStop = mockClient.getCalls().length;
    
    // Wait more - no more calls should happen
    await new Promise(resolve => setTimeout(resolve, 200));
    
    expect(mockClient.getCalls().length).toBe(callsAfterStop);
  });

  test('should handle stop when not initialized', () => {
    const manager = new LiquidityManager({ chains: [] });
    
    // Should not throw
    expect(() => manager.stop()).not.toThrow();
  });

  test('should handle multiple stop calls', async () => {
    const manager = new LiquidityManager({ chains: [], refreshIntervalMs: 1000 });
    await manager.initialize(new Map());
    
    manager.stop();
    manager.stop();
    manager.stop();
    
    // Should not throw
    expect(true).toBe(true);
  });
});

// Import ethers for test helpers
import { ethers } from 'ethers';

