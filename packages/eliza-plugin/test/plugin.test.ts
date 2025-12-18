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
    expect(jejuPlugin.actions!.length).toBeGreaterThan(0);
  });

  test('has services', () => {
    expect(jejuPlugin.services).toBeDefined();
    expect(jejuPlugin.services!.length).toBeGreaterThan(0);
  });
});

describe('Plugin Actions - Compute', () => {
  const computeActions = [
    'LIST_COMPUTE_PROVIDERS',
    'LIST_COMPUTE_MODELS',
    'LIST_COMPUTE_RENTALS',
    'CREATE_COMPUTE_RENTAL',
  ];

  for (const name of computeActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Storage', () => {
  const storageActions = [
    'UPLOAD_FILE',
    'RETRIEVE_FILE',
    'LIST_PINS',
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

describe('Plugin Actions - DeFi', () => {
  const defiActions = [
    'LIST_POOLS',
    'LIST_POSITIONS',
    'GET_SWAP_QUOTE',
    'EXECUTE_SWAP',
  ];

  for (const name of defiActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Governance', () => {
  const govActions = [
    'LIST_PROPOSALS',
    'CREATE_PROPOSAL',
    'VOTE_ON_PROPOSAL',
    'GET_VOTING_POWER',
    'DELEGATE_VOTES',
  ];

  for (const name of govActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Names (JNS)', () => {
  const nameActions = [
    'CHECK_NAME_AVAILABLE',
    'REGISTER_NAME',
    'RESOLVE_NAME',
    'LOOKUP_ADDRESS',
    'GET_REGISTRATION_COST',
  ];

  for (const name of nameActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Identity', () => {
  const identityActions = [
    'GET_MY_AGENT',
    'REGISTER_AGENT',
    'CHECK_BAN_STATUS',
    'LIST_AGENTS',
  ];

  for (const name of identityActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Cross-chain', () => {
  const crosschainActions = [
    'GET_SUPPORTED_CHAINS',
    'LIST_SOLVERS',
    'CREATE_INTENT',
  ];

  for (const name of crosschainActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Payments', () => {
  const paymentActions = [
    'GET_BALANCE',
    'GET_CREDITS',
    'SEND_TRANSACTION',
  ];

  for (const name of paymentActions) {
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
