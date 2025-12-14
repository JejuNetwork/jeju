/**
 * Eliza Plugin Tests
 */

import { describe, test, expect } from 'bun:test';
import { jejuPlugin } from '../src';

describe('jejuPlugin', () => {
  test('has correct name', () => {
    expect(jejuPlugin.name).toBe('jeju');
  });

  test('has description', () => {
    expect(jejuPlugin.description).toBeDefined();
    expect(jejuPlugin.description.length).toBeGreaterThan(0);
  });

  test('has providers', () => {
    expect(jejuPlugin.providers).toBeDefined();
    expect(jejuPlugin.providers!.length).toBeGreaterThan(0);
  });

  test('has actions', () => {
    expect(jejuPlugin.actions).toBeDefined();
    expect(jejuPlugin.actions!.length).toBeGreaterThan(10);
  });

  test('has JejuService', () => {
    expect(jejuPlugin.services).toBeDefined();
    expect(jejuPlugin.services!.length).toBe(1);
  });

  test('actions have required properties', () => {
    for (const action of jejuPlugin.actions!) {
      expect(action.name).toBeDefined();
      expect(action.description).toBeDefined();
      expect(action.validate).toBeDefined();
      expect(action.handler).toBeDefined();
    }
  });

  test('providers have required properties', () => {
    for (const provider of jejuPlugin.providers!) {
      expect(provider.name).toBeDefined();
      expect(provider.get).toBeDefined();
    }
  });
});

describe('Plugin Actions', () => {
  const actionNames = [
    'RENT_GPU',
    'RUN_INFERENCE',
    'CREATE_TRIGGER',
    'UPLOAD_FILE',
    'RETRIEVE_FILE',
    'SWAP_TOKENS',
    'ADD_LIQUIDITY',
    'CREATE_PROPOSAL',
    'VOTE_PROPOSAL',
    'REGISTER_NAME',
    'RESOLVE_NAME',
    'REGISTER_AGENT',
    'CROSS_CHAIN_TRANSFER',
    'CHECK_BALANCE',
  ];

  for (const name of actionNames) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

