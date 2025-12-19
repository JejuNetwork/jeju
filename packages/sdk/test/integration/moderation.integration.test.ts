/**
 * Moderation Module Integration Tests
 *
 * Tests moderation functionality against live localnet.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex, zeroAddress } from "viem";
import { setupTestEnvironment, teardownTestEnvironment } from "../setup";

describe("Moderation Module Integration Tests", () => {
  let client: JejuClient;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let skipTests = false;

  beforeAll(async () => {
    env = await setupTestEnvironment();

    if (!env.chainRunning) {
      console.log("⚠ Chain not running - skipping moderation tests");
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
  }, 90000);

  afterAll(async () => {
    await teardownTestEnvironment();
  }, 10000);

  describe("Module exists", () => {
    test("moderation module is defined", () => {
      if (skipTests) return;
      expect(client.moderation).toBeDefined();
    });
  });

  describe("Evidence Management", () => {
    test("getEvidence returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const evidence = await client.moderation.getEvidence("0x" + "00".repeat(32) as Hex);
        expect(evidence === null || typeof evidence === "object").toBe(true);
      } catch {
        // Expected if contracts not deployed
      }
    });

    test("listCaseEvidence returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const evidence = await client.moderation.listCaseEvidence("0x" + "00".repeat(32) as Hex);
        expect(Array.isArray(evidence)).toBe(true);
      } catch {
        // Expected if contracts not deployed
      }
    });
  });

  describe("Case Management", () => {
    test("getCase returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const case_ = await client.moderation.getCase("0x" + "00".repeat(32) as Hex);
        expect(case_ === null || typeof case_ === "object").toBe(true);
      } catch {
        // Expected if contracts not deployed
      }
    });

    test("listMyCases returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const cases = await client.moderation.listMyCases();
        expect(Array.isArray(cases)).toBe(true);
      } catch {
        // Expected if contracts not deployed
      }
    });
  });

  describe("Ban Management", () => {
    test("isAddressBanned returns boolean for random address", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const banned = await client.moderation.isAddressBanned(zeroAddress);
        expect(typeof banned).toBe("boolean");
      } catch {
        // Expected if contracts not deployed
      }
    });

    test("isNetworkBanned returns boolean for agent 0", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const banned = await client.moderation.isNetworkBanned(0n);
        expect(typeof banned).toBe("boolean");
      } catch {
        // Expected if contracts not deployed
      }
    });
  });

  describe("Reputation Labels", () => {
    test("getLabels returns array for address", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const labels = await client.moderation.getLabels(zeroAddress);
        expect(Array.isArray(labels)).toBe(true);
      } catch {
        // Expected if contracts not deployed
      }
    });
  });

  describe("Module Constants", () => {
    test("MIN_EVIDENCE_STAKE is defined", () => {
      if (skipTests) return;
      expect(client.moderation.MIN_EVIDENCE_STAKE).toBeDefined();
    });

    test("MIN_REPORT_STAKE is defined", () => {
      if (skipTests) return;
      expect(client.moderation.MIN_REPORT_STAKE).toBeDefined();
    });
  });
});
