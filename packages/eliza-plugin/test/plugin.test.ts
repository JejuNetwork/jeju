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
    'LIST_PROVIDERS',
    'LIST_MODELS',
    'LIST_MY_RENTALS',
    'RENT_GPU',
    'RUN_INFERENCE',
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
    'PIN_CID',
    'UNPIN',
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
    'MY_POSITIONS',
    'ADD_LIQUIDITY',
    'SWAP_TOKENS',
    'GET_POOL_STATS',
    'LIST_ROUTES',
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
    'CREATE_PROPOSAL',
    'VOTE_PROPOSAL',
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
    'REGISTER_NAME',
    'RESOLVE_NAME',
    'LIST_NAMES_FOR_SALE',
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
    'REGISTER_AGENT',
    'REPORT_AGENT',
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
    'LIST_SOLVERS',
    'CREATE_INTENT',
    'TRACK_INTENT',
    'CROSS_CHAIN_TRANSFER',
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
    'CHECK_BALANCE',
    'CREATE_TRIGGER',
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

describe('Plugin Actions - Games', () => {
  const gameActions = [
    'GET_GAME_STATS',
    'GET_GOLD_BALANCE',
    'TRANSFER_GOLD',
    'GET_ITEM_BALANCE',
    'TRANSFER_ITEM',
    'LINK_GAME_AGENT',
    'GET_PLAYER_INFO',
  ];

  for (const name of gameActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Containers', () => {
  const containerActions = [
    'CREATE_CONTAINER_REPO',
    'GET_CONTAINER_REPO',
    'LIST_MY_REPOS',
    'STAR_CONTAINER_REPO',
    'GRANT_REPO_ACCESS',
    'GET_IMAGE_MANIFEST',
    'GET_SSH_ACCESS',
  ];

  for (const name of containerActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Launchpad', () => {
  const launchpadActions = [
    'CREATE_TOKEN',
    'LAUNCH_TOKEN',
    'CREATE_BONDING_CURVE',
    'BUY_FROM_CURVE',
    'SELL_TO_CURVE',
    'LIST_BONDING_CURVES',
    'LOCK_LP',
    'CREATE_PRESALE',
    'CONTRIBUTE_PRESALE',
    'LIST_PRESALES',
  ];

  for (const name of launchpadActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Moderation', () => {
  const modActions = [
    'SUBMIT_EVIDENCE',
    'SUPPORT_EVIDENCE',
    'GET_EVIDENCE',
    'LIST_CASE_EVIDENCE',
    'CLAIM_EVIDENCE_REWARD',
    'CREATE_MODERATION_CASE',
    'GET_MODERATION_CASE',
    'LIST_MODERATION_CASES',
    'APPEAL_CASE',
    'ISSUE_REPUTATION_LABEL',
    'GET_REPUTATION_LABELS',
    'CHECK_TRUST_STATUS',
  ];

  for (const name of modActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - Work', () => {
  const workActions = [
    'CREATE_BOUNTY',
    'LIST_BOUNTIES',
    'CLAIM_BOUNTY',
    'SUBMIT_BOUNTY_WORK',
    'APPROVE_SUBMISSION',
    'REJECT_SUBMISSION',
    'CREATE_PROJECT',
    'LIST_PROJECTS',
    'CREATE_PROJECT_TASK',
    'GET_PROJECT_TASKS',
    'REGISTER_GUARDIAN',
    'LIST_GUARDIANS',
  ];

  for (const name of workActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});

describe('Plugin Actions - NFTs', () => {
  const nftActions = [
    'LIST_NFTS',
  ];

  for (const name of nftActions) {
    test(`has ${name} action`, () => {
      const action = jejuPlugin.actions!.find((a) => a.name === name);
      expect(action).toBeDefined();
    });
  }
});
