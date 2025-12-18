/**
 * Agent Integration Tests
 * Tests helper functions - actual AI tests require DWS running
 */

import { describe, test, expect } from 'bun:test';
import { selectAction, extractEntities } from '../../eliza/runtime';

describe('Action Selection', () => {
  test('identifies trading intents', () => {
    expect(selectAction('swap eth')?.name).toBe('SWAP');
    expect(selectAction('trade tokens')?.name).toBe('SWAP');
    expect(selectAction('bridge assets')?.name).toBe('BRIDGE');
  });
  
  test('identifies info intents', () => {
    expect(selectAction('check balance')?.name).toBe('BALANCE');
    expect(selectAction('what is the price')?.name).toBe('PRICE');
    expect(selectAction('help please')?.name).toBe('HELP');
  });
  
  test('identifies connect intent', () => {
    expect(selectAction('connect my wallet')?.name).toBe('CONNECT');
  });
});

describe('Entity Extraction', () => {
  test('extracts swap entities', () => {
    const e = extractEntities('swap 1.5 ETH to USDC');
    expect(e.amount).toBe('1.5');
    expect(e.fromToken).toBe('ETH');
    expect(e.toToken).toBe('USDC');
  });
  
  test('extracts bridge entities', () => {
    const e = extractEntities('bridge 2 ETH from ethereum to base');
    expect(e.amount).toBe('2');
    expect(e.token).toBe('ETH');
    expect(e.fromChain).toBe('ethereum');
    expect(e.toChain).toBe('base');
  });
});
