/**
 * Federation Module Integration Tests
 *
 * Tests federation functionality against live localnet.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { setupTestEnvironment, teardownTestEnvironment } from "../setup";

describe("Federation Module Integration Tests", () => {
  let client: JejuClient;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let skipTests = false;

  beforeAll(async () => {
    env = await setupTestEnvironment();

    if (!env.chainRunning) {
      console.log("⚠ Chain not running - skipping federation tests");
      skipTests = true;
      return;
    }

    const account = privateKeyToAccount(env.privateKey);
    client = await createJejuClient({
      account,
      network: "localnet",
      rpcUrl: env.rpcUrl,
      smartAccount: false,
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  describe("Network Queries", () => {
    test("getAllNetworks returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const networks = await client.federation.getAllNetworks();
      expect(Array.isArray(networks)).toBe(true);
    });

    test("getStakedNetworks returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const networks = await client.federation.getStakedNetworks();
      expect(Array.isArray(networks)).toBe(true);
    });

    test("getVerifiedNetworks returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const networks = await client.federation.getVerifiedNetworks();
      expect(Array.isArray(networks)).toBe(true);
    });

    test("getNetwork returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const network = await client.federation.getNetwork(999999n);
      expect(network).toBeNull();
    });
  });

  describe("Registry Queries", () => {
    test("getRegisteredChains returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const chains = await client.federation.getRegisteredChains();
      expect(Array.isArray(chains)).toBe(true);
    });
  });

  describe("Governance Queries", () => {
    test("getProposals returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const proposals = await client.federation.getProposals();
      expect(Array.isArray(proposals)).toBe(true);
    });

    test("getPendingProposals returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const proposals = await client.federation.getPendingProposals();
      expect(Array.isArray(proposals)).toBe(true);
    });

    test("getProposal returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const proposal = await client.federation.getProposal(999999n);
      expect(proposal).toBeNull();
    });
  });

  describe("Sequencer Queries", () => {
    test("getCurrentSequencer returns address or null", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const sequencer = await client.federation.getCurrentSequencer();
      expect(sequencer === null || typeof sequencer === "string").toBe(true);
    });

    test("getSequencerSchedule returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const schedule = await client.federation.getSequencerSchedule();
      expect(Array.isArray(schedule)).toBe(true);
    });
  });

  describe("Federation Client Methods", () => {
    test("canParticipateInConsensus is defined", () => {
      if (skipTests) return;
      expect(typeof client.federation.canParticipateInConsensus).toBe("function");
    });

    test("isSequencerEligible is defined", () => {
      if (skipTests) return;
      expect(typeof client.federation.isSequencerEligible).toBe("function");
    });
  });
});
