/**
 * Otto Runtime Tests
 * Tests entity extraction and action selection helpers
 * Note: processMessage tests require DWS to be running
 */

import { describe, test, expect } from 'bun:test';
import { selectAction, extractEntities } from '../eliza/runtime';

describe('Entity Extraction', () => {
  test('extracts swap entities', () => {
    const entities = extractEntities('swap 100 USDC to ETH');
    expect(entities.amount).toBe('100');
    expect(entities.fromToken).toBe('USDC');
    expect(entities.toToken).toBe('ETH');
  });
  
  test('extracts bridge entities', () => {
    const entities = extractEntities('bridge 1 ETH from ethereum to base');
    expect(entities.amount).toBe('1');
    expect(entities.token).toBe('ETH');
    expect(entities.fromChain).toBe('ethereum');
    expect(entities.toChain).toBe('base');
  });
});

describe('Action Selection (for test compat)', () => {
  test('identifies swap patterns', () => {
    expect(selectAction('swap 1 ETH to USDC')?.name).toBe('SWAP');
    expect(selectAction('trade tokens')?.name).toBe('SWAP');
  });
  
  test('identifies bridge patterns', () => {
    expect(selectAction('bridge tokens')?.name).toBe('BRIDGE');
  });
  
  test('identifies balance patterns', () => {
    expect(selectAction('check my balance')?.name).toBe('BALANCE');
  });
  
  test('identifies price patterns', () => {
    expect(selectAction('what is the price')?.name).toBe('PRICE');
  });
  
  test('identifies connect patterns', () => {
    expect(selectAction('connect wallet')?.name).toBe('CONNECT');
  });
  
  test('identifies help patterns', () => {
    expect(selectAction('help me')?.name).toBe('HELP');
  });
  
  test('returns null for unrecognized', () => {
    expect(selectAction('asdfasdf')).toBeNull();
  });
});
