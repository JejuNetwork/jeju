/**
 * Tests for banCheck utility
 */

import { describe, test, expect } from 'bun:test';
import { checkUserBan, checkTradeAllowed, checkJejuTransferAllowed, checkJejuTradeAllowed, BanType, getBanTypeLabel } from '../banCheck';

describe('banCheck', () => {
  test('checkUserBan should return allowed=true when ban manager not configured', async () => {
    const result = await checkUserBan('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`);
    expect(result.allowed).toBe(true);
  });
  
  test('checkTradeAllowed should return true when ban manager not configured', async () => {
    const result = await checkTradeAllowed('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`);
    expect(result).toBe(true);
  });
});

describe('JEJU Token Ban Check', () => {
  test('checkJejuTransferAllowed should return true when JEJU token not configured', async () => {
    const result = await checkJejuTransferAllowed('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`);
    expect(result).toBe(true);
  });

  test('checkJejuTradeAllowed should return allowed=true when no contracts configured', async () => {
    const result = await checkJejuTradeAllowed('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`);
    expect(result.allowed).toBe(true);
  });
});

describe('Ban Type Labels', () => {
  test('should return correct labels for all ban types', () => {
    expect(getBanTypeLabel(BanType.NONE)).toBe('Not Banned');
    expect(getBanTypeLabel(BanType.ON_NOTICE)).toBe('On Notice (Pending Review)');
    expect(getBanTypeLabel(BanType.CHALLENGED)).toBe('Challenged (Market Active)');
    expect(getBanTypeLabel(BanType.PERMANENT)).toBe('Permanently Banned');
  });
});

