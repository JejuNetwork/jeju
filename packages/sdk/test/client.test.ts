/**
 * SDK Client Tests
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createJejuClient } from '../src/client';
import type { JejuClient } from '../src/client';
import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';

describe('JejuClient', () => {
  let client: JejuClient;
  const testPrivateKey = generatePrivateKey();

  beforeAll(async () => {
    client = await createJejuClient({
      network: 'localnet',
      privateKey: testPrivateKey,
      smartAccount: false, // Use EOA for tests
    });
  });

  test('creates client with correct address', () => {
    const account = privateKeyToAccount(testPrivateKey);
    expect(client.address).toBe(account.address);
  });

  test('has correct network info', () => {
    expect(client.network).toBe('localnet');
    expect(client.chainId).toBe(1337);
  });

  test('has all modules', () => {
    expect(client.compute).toBeDefined();
    expect(client.storage).toBeDefined();
    expect(client.defi).toBeDefined();
    expect(client.governance).toBeDefined();
    expect(client.names).toBeDefined();
    expect(client.identity).toBeDefined();
    expect(client.crosschain).toBeDefined();
    expect(client.payments).toBeDefined();
    expect(client.a2a).toBeDefined();
    expect(client.staking).toBeDefined();
    expect(client.dws).toBeDefined();
    expect(client.moderation).toBeDefined();
    expect(client.federation).toBeDefined();
    expect(client.otc).toBeDefined();
    expect(client.messaging).toBeDefined();
    expect(client.distributor).toBeDefined();
    expect(client.training).toBeDefined();
  });

  test('compute module has methods', () => {
    expect(typeof client.compute.listProviders).toBe('function');
    expect(typeof client.compute.createRental).toBe('function');
    expect(typeof client.compute.inference).toBe('function');
  });

  test('storage module has methods', () => {
    expect(typeof client.storage.upload).toBe('function');
    expect(typeof client.storage.retrieve).toBe('function');
    expect(typeof client.storage.listPins).toBe('function');
  });

  test('defi module has methods', () => {
    expect(typeof client.defi.getSwapQuote).toBe('function');
    expect(typeof client.defi.swap).toBe('function');
    expect(typeof client.defi.listPools).toBe('function');
  });

  test('governance module has methods', () => {
    expect(typeof client.governance.createProposal).toBe('function');
    expect(typeof client.governance.vote).toBe('function');
    expect(typeof client.governance.listProposals).toBe('function');
  });

  test('crosschain module has methods', () => {
    expect(typeof client.crosschain.getQuote).toBe('function');
    expect(typeof client.crosschain.transfer).toBe('function');
    expect(typeof client.crosschain.getSupportedChains).toBe('function');
  });

  test('crosschain returns supported chains', () => {
    const chains = client.crosschain.getSupportedChains();
    expect(chains).toContain('jeju');
    expect(chains).toContain('base');
    expect(chains).toContain('optimism');
    expect(chains).toContain('arbitrum');
    expect(chains).toContain('ethereum');
  });

  test('staking module has methods', () => {
    expect(typeof client.staking.stake).toBe('function');
    expect(typeof client.staking.unstake).toBe('function');
    expect(typeof client.staking.claimRewards).toBe('function');
    expect(typeof client.staking.getMyStake).toBe('function');
    expect(typeof client.staking.registerRPCProvider).toBe('function');
    expect(typeof client.staking.listRPCProviders).toBe('function');
    expect(client.staking.MIN_STAKE).toBeDefined();
  });

  test('dws module has methods', () => {
    expect(typeof client.dws.createTrigger).toBe('function');
    expect(typeof client.dws.createWorkflow).toBe('function');
    expect(typeof client.dws.executeWorkflow).toBe('function');
    expect(typeof client.dws.getJob).toBe('function');
    expect(typeof client.dws.listMyJobs).toBe('function');
    expect(typeof client.dws.getStats).toBe('function');
  });

  test('moderation module has methods', () => {
    expect(typeof client.moderation.submitEvidence).toBe('function');
    expect(typeof client.moderation.createCase).toBe('function');
    expect(typeof client.moderation.isNetworkBanned).toBe('function');
    expect(typeof client.moderation.createReport).toBe('function');
    expect(typeof client.moderation.issueLabel).toBe('function');
    expect(client.moderation.MIN_EVIDENCE_STAKE).toBeDefined();
    expect(client.moderation.MIN_REPORT_STAKE).toBeDefined();
  });

  test('federation module has methods', () => {
    expect(typeof client.federation.getNetwork).toBe('function');
    expect(typeof client.federation.getAllNetworks).toBe('function');
    expect(typeof client.federation.canParticipateInConsensus).toBe('function');
    expect(typeof client.federation.joinFederation).toBe('function');
    expect(typeof client.federation.getAllRegistries).toBe('function');
  });

  test('otc module has methods', () => {
    expect(typeof client.otc.createConsignment).toBe('function');
    expect(typeof client.otc.createOffer).toBe('function');
    expect(typeof client.otc.getQuote).toBe('function');
    expect(typeof client.otc.listActiveConsignments).toBe('function');
    expect(typeof client.otc.fulfillOffer).toBe('function');
  });

  test('messaging module has methods', () => {
    expect(typeof client.messaging.registerNode).toBe('function');
    expect(typeof client.messaging.registerKey).toBe('function');
    expect(typeof client.messaging.getKey).toBe('function');
    expect(typeof client.messaging.heartbeat).toBe('function');
    expect(client.messaging.MIN_STAKE).toBeDefined();
  });

  test('distributor module has methods', () => {
    expect(typeof client.distributor.createAirdrop).toBe('function');
    expect(typeof client.distributor.claimAirdrop).toBe('function');
    expect(typeof client.distributor.createVesting).toBe('function');
    expect(typeof client.distributor.releaseVested).toBe('function');
    expect(typeof client.distributor.claimStakingRewards).toBe('function');
  });

  test('training module has methods', () => {
    expect(typeof client.training.createRun).toBe('function');
    expect(typeof client.training.joinRun).toBe('function');
    expect(typeof client.training.submitTrainingStep).toBe('function');
    expect(typeof client.training.claimRewards).toBe('function');
    expect(typeof client.training.getRunProgress).toBe('function');
  });
});

describe('JejuClient with Smart Account', () => {
  test.skip('creates smart account client', async () => {
    // This test requires deployed contracts
    const testPrivateKey = generatePrivateKey();
    const client = await createJejuClient({
      network: 'localnet',
      privateKey: testPrivateKey,
      smartAccount: true,
    });

    expect(client.isSmartAccount).toBe(true);
  });
});

