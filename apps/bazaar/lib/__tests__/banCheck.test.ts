/**
 * Tests for banCheck utility
 */

import { describe, test, expect } from 'bun:test';
import { checkUserBan, checkTradeAllowed } from '../banCheck';

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

