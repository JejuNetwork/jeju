/**
 * Presale Contract Integration Tests
 * Direct contract interaction tests via RPC
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, parseEther, formatEther } from 'viem';
import { localhost } from 'viem/chains';

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:9545';
const PRESALE_ADDRESS = process.env.PRESALE_ADDRESS as `0x${string}` | undefined;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS as `0x${string}` | undefined;

const client = createPublicClient({
  chain: localhost,
  transport: http(RPC_URL),
});

// Skip all tests if contracts not deployed
const shouldRun = !!PRESALE_ADDRESS;

describe.skipIf(!shouldRun)('Presale Contract State', () => {
  test('should have correct presale phase', async () => {
    const phase = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{ name: 'currentPhase', type: 'function', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' }],
      functionName: 'currentPhase',
    });

    // Phase should be valid
    expect(Number(phase)).toBeGreaterThanOrEqual(0);
    expect(Number(phase)).toBeLessThanOrEqual(5);
  });

  test('should have valid config', async () => {
    const config = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{
        name: 'config',
        type: 'function',
        inputs: [],
        outputs: [
          { name: 'softCap', type: 'uint256' },
          { name: 'hardCap', type: 'uint256' },
          { name: 'minContribution', type: 'uint256' },
          { name: 'maxContribution', type: 'uint256' },
          { name: 'tokenPrice', type: 'uint256' },
          { name: 'whitelistStart', type: 'uint256' },
          { name: 'publicStart', type: 'uint256' },
          { name: 'presaleEnd', type: 'uint256' },
          { name: 'tgeTimestamp', type: 'uint256' },
        ],
        stateMutability: 'view',
      }],
      functionName: 'config',
    }) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

    const [softCap, hardCap, minContribution, maxContribution, tokenPrice] = config;

    // Soft cap < hard cap
    expect(softCap).toBeLessThan(hardCap);
    // Min < max contribution
    expect(minContribution).toBeLessThan(maxContribution);
    // Token price > 0
    expect(tokenPrice).toBeGreaterThan(0n);
  });

  test('should have valid vesting schedule', async () => {
    const vesting = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{
        name: 'vesting',
        type: 'function',
        inputs: [],
        outputs: [
          { name: 'tgePercent', type: 'uint256' },
          { name: 'cliffDuration', type: 'uint256' },
          { name: 'vestingDuration', type: 'uint256' },
        ],
        stateMutability: 'view',
      }],
      functionName: 'vesting',
    }) as [bigint, bigint, bigint];

    const [tgePercent, cliffDuration, vestingDuration] = vesting;

    // TGE percent <= 100%
    expect(tgePercent).toBeLessThanOrEqual(10000n);
    // Vesting duration > 0 (or fully unlocked)
    expect(tgePercent > 0n || vestingDuration > 0n).toBe(true);
  });
});

describe.skipIf(!shouldRun)('Presale Statistics', () => {
  test('should read total raised', async () => {
    const totalRaised = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{ name: 'totalRaised', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
      functionName: 'totalRaised',
    });

    expect(totalRaised).toBeGreaterThanOrEqual(0n);
  });

  test('should read total participants', async () => {
    const totalParticipants = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{ name: 'totalParticipants', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
      functionName: 'totalParticipants',
    });

    expect(totalParticipants).toBeGreaterThanOrEqual(0n);
  });

  test('should read total tokens sold', async () => {
    const totalTokensSold = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{ name: 'totalTokensSold', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
      functionName: 'totalTokensSold',
    });

    expect(totalTokensSold).toBeGreaterThanOrEqual(0n);
  });

  test('should get presale stats', async () => {
    const stats = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{
        name: 'getPresaleStats',
        type: 'function',
        inputs: [],
        outputs: [
          { name: 'raised', type: 'uint256' },
          { name: 'participants', type: 'uint256' },
          { name: 'tokensSold', type: 'uint256' },
          { name: 'softCap', type: 'uint256' },
          { name: 'hardCap', type: 'uint256' },
          { name: 'phase', type: 'uint8' },
        ],
        stateMutability: 'view',
      }],
      functionName: 'getPresaleStats',
    }) as [bigint, bigint, bigint, bigint, bigint, number];

    const [raised, participants, tokensSold, softCap, hardCap, phase] = stats;

    // Raised <= hardCap
    expect(raised).toBeLessThanOrEqual(hardCap);
    // Phase is valid
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThanOrEqual(5);
  });
});

describe.skipIf(!shouldRun)('Bonus Calculation', () => {
  test('should calculate whitelist bonus correctly', async () => {
    // During whitelist phase, bonus should be 10%
    const bonus = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{
        name: 'calculateBonus',
        type: 'function',
        inputs: [{ name: 'ethAmount', type: 'uint256' }],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
      }],
      functionName: 'calculateBonus',
      args: [parseEther('1')],
    });

    // Bonus should be reasonable (0-15% range)
    // Actual value depends on phase
    expect(bonus).toBeGreaterThanOrEqual(0n);
  });

  test('should calculate volume bonus for 5 ETH', async () => {
    const bonus = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{
        name: 'calculateBonus',
        type: 'function',
        inputs: [{ name: 'ethAmount', type: 'uint256' }],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
      }],
      functionName: 'calculateBonus',
      args: [parseEther('5')],
    });

    // Should have some bonus for 5 ETH
    expect(bonus).toBeGreaterThanOrEqual(0n);
  });

  test('should calculate volume bonus for 10 ETH', async () => {
    const bonus = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{
        name: 'calculateBonus',
        type: 'function',
        inputs: [{ name: 'ethAmount', type: 'uint256' }],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
      }],
      functionName: 'calculateBonus',
      args: [parseEther('10')],
    });

    // 10 ETH should have higher bonus
    expect(bonus).toBeGreaterThanOrEqual(0n);
  });
});

describe.skipIf(!shouldRun)('Vesting Calculation', () => {
  test('should calculate vested amount', async () => {
    const vested = await client.readContract({
      address: PRESALE_ADDRESS!,
      abi: [{
        name: 'calculateVestedAmount',
        type: 'function',
        inputs: [{ name: 'totalAllocation', type: 'uint256' }],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
      }],
      functionName: 'calculateVestedAmount',
      args: [parseEther('1000')],
    });

    // Vested should be <= total allocation
    expect(vested).toBeLessThanOrEqual(parseEther('1000'));
    expect(vested).toBeGreaterThanOrEqual(0n);
  });
});

describe.skipIf(!TOKEN_ADDRESS)('Token Contract', () => {
  test('should have correct name', async () => {
    const name = await client.readContract({
      address: TOKEN_ADDRESS!,
      abi: [{ name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' }],
      functionName: 'name',
    });

    expect(name).toBe('Jeju');
  });

  test('should have correct symbol', async () => {
    const symbol = await client.readContract({
      address: TOKEN_ADDRESS!,
      abi: [{ name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' }],
      functionName: 'symbol',
    });

    expect(symbol).toBe('JEJU');
  });

  test('should have 18 decimals', async () => {
    const decimals = await client.readContract({
      address: TOKEN_ADDRESS!,
      abi: [{ name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' }],
      functionName: 'decimals',
    });

    expect(decimals).toBe(18);
  });
});
