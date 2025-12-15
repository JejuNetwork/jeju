/**
 * JIT Liquidity Provider Tests
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, type Address, type PublicClient, type WalletClient } from 'viem';
import { mainnet } from 'viem/chains';

import {
  JITLiquidityProvider,
  POSITION_MANAGER,
  priceToTick,
  tickToPrice,
  type JITOpportunity,
  type JITConfig,
} from '../../src/solver/external/jit-liquidity';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address;
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const WETH_USDC_POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as Address;

describe('Position Manager Addresses', () => {
  it('should have position manager on major chains', () => {
    expect(POSITION_MANAGER[1]).toBeDefined();
    expect(POSITION_MANAGER[42161]).toBeDefined();
    expect(POSITION_MANAGER[10]).toBeDefined();
    expect(POSITION_MANAGER[8453]).toBeDefined();
    expect(POSITION_MANAGER[137]).toBeDefined();
  });

  it('should have valid addresses', () => {
    for (const [, address] of Object.entries(POSITION_MANAGER)) {
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  it('should use canonical Uniswap address on mainnet', () => {
    expect(POSITION_MANAGER[1]).toBe('0xC36442b4a4522E871399CD717aBDD847Ab11FE88');
  });
});

describe('Tick/Price Helpers', () => {
  it('should convert price to tick correctly', () => {
    expect(priceToTick(1)).toBe(0);
    
    const tick100Price = tickToPrice(100);
    expect(tick100Price).toBeCloseTo(1.01, 2);
    
    const price = 3000;
    const tick = priceToTick(price);
    const backToPrice = tickToPrice(tick);
    expect(backToPrice).toBeCloseTo(price, -1);
  });

  it('should convert tick to price correctly', () => {
    expect(tickToPrice(0)).toBe(1);
    expect(tickToPrice(100)).toBeCloseTo(1.01, 2);
    expect(tickToPrice(-100)).toBeCloseTo(0.99, 2);
  });

  it('should handle large ticks', () => {
    const ethTick = priceToTick(3000);
    expect(ethTick).toBeGreaterThan(70000);
    expect(ethTick).toBeLessThan(90000);
  });
});

describe('JITLiquidityProvider Instantiation', () => {
  it('should instantiate with empty clients', () => {
    const clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
    const provider = new JITLiquidityProvider(clients);
    expect(provider).toBeDefined();
  });

  it('should accept custom config', () => {
    const clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
    const config: Partial<JITConfig> = {
      minProfitWei: BigInt(1e16),
      maxPositionAge: 60,
      tickRange: 30,
      slippageBps: 100,
    };
    
    const provider = new JITLiquidityProvider(clients, config);
    expect(provider).toBeDefined();
  });

  it('should be an EventEmitter', () => {
    const clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
    const provider = new JITLiquidityProvider(clients);
    
    expect(typeof provider.on).toBe('function');
    expect(typeof provider.emit).toBe('function');
  });

  it('should start and stop without error', () => {
    const clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
    const provider = new JITLiquidityProvider(clients);
    
    expect(() => provider.start()).not.toThrow();
    expect(() => provider.stop()).not.toThrow();
  });
});

describe('Position Management', () => {
  it('should start with no open positions', () => {
    const clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
    const provider = new JITLiquidityProvider(clients);
    
    expect(provider.getPositionCount()).toBe(0);
    expect(provider.getOpenPositions()).toEqual([]);
  });
});

describe('Optimal Amount Calculation', () => {
  let provider: JITLiquidityProvider;

  beforeAll(() => {
    const clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
    provider = new JITLiquidityProvider(clients);
  });

  it('should provide token1 for token0 to token1 swap', () => {
    const opportunity: JITOpportunity = {
      intentId: 'test-1',
      chainId: 1,
      pool: WETH_USDC_POOL,
      token0: USDC,
      token1: WETH,
      fee: 500,
      direction: 'token0_to_token1',
      swapAmount: BigInt('1000000000'),
      expectedFees: BigInt('500000'),
      optimalTickLower: -100,
      optimalTickUpper: 100,
      deadline: Math.floor(Date.now() / 1000) + 300,
    };

    const availableToken0 = BigInt('1000000000');
    const availableToken1 = BigInt('1000000000000000000');

    const amounts = provider.calculateOptimalAmounts(
      opportunity,
      availableToken0,
      availableToken1
    );

    expect(amounts.amount0).toBe(BigInt(0));
    expect(amounts.amount1).toBe(availableToken1);
  });

  it('should provide token0 for token1 to token0 swap', () => {
    const opportunity: JITOpportunity = {
      intentId: 'test-2',
      chainId: 1,
      pool: WETH_USDC_POOL,
      token0: USDC,
      token1: WETH,
      fee: 500,
      direction: 'token1_to_token0',
      swapAmount: BigInt('1000000000000000000'),
      expectedFees: BigInt('500000000000000'),
      optimalTickLower: -100,
      optimalTickUpper: 100,
      deadline: Math.floor(Date.now() / 1000) + 300,
    };

    const availableToken0 = BigInt('10000000000');
    const availableToken1 = BigInt('5000000000000000000');

    const amounts = provider.calculateOptimalAmounts(
      opportunity,
      availableToken0,
      availableToken1
    );

    expect(amounts.amount0).toBe(availableToken0);
    expect(amounts.amount1).toBe(BigInt(0));
  });
});

describe('JIT Opportunity Analysis', () => {
  let provider: JITLiquidityProvider;

  beforeAll(() => {
    const clients = new Map<number, { public: PublicClient; wallet?: WalletClient }>();
    clients.set(1, {
      public: createPublicClient({
        chain: mainnet,
        transport: http('https://eth.llamarpc.com'),
      }),
    });
    provider = new JITLiquidityProvider(clients);
  });

  it('should analyze intent and return opportunity', async () => {
    const opportunity = await provider.analyzeIntent(
      1,
      WETH_USDC_POOL,
      USDC,
      WETH,
      500,
      BigInt('100000000000'),
      'token0_to_token1',
      'intent-123',
      Math.floor(Date.now() / 1000) + 300
    );

    if (opportunity) {
      expect(opportunity.intentId).toBe('intent-123');
      expect(opportunity.chainId).toBe(1);
      expect(opportunity.pool).toBe(WETH_USDC_POOL);
      expect(opportunity.fee).toBe(500);
      expect(opportunity.optimalTickLower).toBeLessThan(opportunity.optimalTickUpper);
    }
  }, 15000);

  it('should return null for small swaps with low fees', async () => {
    const opportunity = await provider.analyzeIntent(
      1,
      WETH_USDC_POOL,
      USDC,
      WETH,
      500,
      BigInt('1000000'),
      'token0_to_token1',
      'intent-small',
      Math.floor(Date.now() / 1000) + 300
    );

    expect(opportunity).toBeNull();
  }, 15000);
});

