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

  test('has actions covering all capabilities', () => {
    expect(jejuPlugin.actions).toBeDefined();
    // Should have 30+ actions covering all Jeju capabilities
    expect(jejuPlugin.actions!.length).toBeGreaterThanOrEqual(30);
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

describe('Plugin Actions - Core', () => {
  const coreActions = [
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

  for (const name of coreActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Extended Compute', () => {
  const computeActions = [
    'LIST_PROVIDERS',
    'LIST_MODELS',
    'LIST_MY_RENTALS',
    'GET_SSH_ACCESS',
  ];

  for (const name of computeActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Extended Storage', () => {
  const storageActions = [
    'PIN_CID',
    'LIST_PINS',
    'UNPIN',
    'GET_STORAGE_STATS',
    'ESTIMATE_STORAGE_COST',
  ];

  for (const name of storageActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - DeFi Pools', () => {
  const poolActions = [
    'LIST_POOLS',
    'GET_POOL_STATS',
    'MY_POSITIONS',
  ];

  for (const name of poolActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - OIF Intents', () => {
  const intentActions = [
    'CREATE_INTENT',
    'TRACK_INTENT',
    'LIST_SOLVERS',
    'LIST_ROUTES',
  ];

  for (const name of intentActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Bazaar', () => {
  const bazaarActions = [
    'LAUNCH_TOKEN',
    'LIST_NFTS',
    'LIST_NAMES_FOR_SALE',
  ];

  for (const name of bazaarActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Moderation', () => {
  const moderationActions = [
    'REPORT_AGENT',
    'LIST_MODERATION_CASES',
  ];

  for (const name of moderationActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Infrastructure', () => {
  const infraActions = [
    'LIST_NODES',
    'GET_NODE_STATS',
  ];

  for (const name of infraActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - A2A', () => {
  const a2aActions = [
    'CALL_AGENT',
    'DISCOVER_AGENTS',
  ];

  for (const name of a2aActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});
