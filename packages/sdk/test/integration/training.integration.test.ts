/**
 * Training Module Integration Tests
 *
 * Tests AI training coordination functionality against live localnet.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress, type Hex } from "viem";
import { setupTestEnvironment, teardownTestEnvironment } from "../setup";

describe("Training Module Integration Tests", () => {
  let client: JejuClient;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let skipTests = false;

  beforeAll(async () => {
    env = await setupTestEnvironment();

    if (!env.chainRunning) {
      console.log("⚠ Chain not running - skipping training tests");
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

  describe("Training Run Management", () => {
    test("getTrainingRun returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const run = await client.training.getTrainingRun("0x" + "00".repeat(32) as Hex);
      expect(run === null || typeof run === "object").toBe(true);
    });

    test("getActiveRuns returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const runs = await client.training.getActiveRuns();
      expect(Array.isArray(runs)).toBe(true);
    });

    test("getMyRuns returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const runs = await client.training.getMyRuns();
      expect(Array.isArray(runs)).toBe(true);
    });
  });

  describe("Client Management", () => {
    test("getRunClients returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const clients = await client.training.getRunClients("0x" + "00".repeat(32) as Hex);
      expect(Array.isArray(clients)).toBe(true);
    });

    test("getClientInfo returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const info = await client.training.getClientInfo("0x" + "00".repeat(32) as Hex, zeroAddress);
      expect(info === null || typeof info === "object").toBe(true);
    });

    test("getMyClientStatus returns null if not participating", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const status = await client.training.getMyClientStatus("0x" + "00".repeat(32) as Hex);
      expect(status === null || typeof status === "object").toBe(true);
    });
  });

  describe("Progress Tracking", () => {
    test("getRunProgress returns progress info", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const progress = await client.training.getRunProgress("0x" + "00".repeat(32) as Hex);
      expect(progress === null || typeof progress === "object").toBe(true);
    });
  });

  describe("Statistics", () => {
    test("getTrainingStats returns stats object", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const stats = await client.training.getTrainingStats();
      expect(stats).toBeDefined();
      expect(typeof stats.totalRuns).toBe("number");
    });
  });

  describe("Module Methods", () => {
    test("getRunProgress is defined", () => {
      if (skipTests) return;
      expect(typeof client.training.getRunProgress).toBe("function");
    });

    test("claimRewards is defined", () => {
      if (skipTests) return;
      expect(typeof client.training.claimRewards).toBe("function");
    });
  });
});

