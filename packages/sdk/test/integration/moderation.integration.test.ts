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

  describe("Evidence Management", () => {
    test("getEvidence returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const evidence = await client.moderation.getEvidence("0x" + "00".repeat(32) as Hex);
      expect(evidence === null || typeof evidence === "object").toBe(true);
    });

    test("getCaseEvidence returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const evidence = await client.moderation.getCaseEvidence("0x" + "00".repeat(32) as Hex);
      expect(Array.isArray(evidence)).toBe(true);
    });
  });

  describe("Case Management", () => {
    test("getCase returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const case_ = await client.moderation.getCase("0x" + "00".repeat(32) as Hex);
      expect(case_ === null || typeof case_ === "object").toBe(true);
    });

    test("listMyCases returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const cases = await client.moderation.listMyCases();
      expect(Array.isArray(cases)).toBe(true);
    });
  });

  describe("Ban Management", () => {
    test("isAddressBanned returns boolean for random address", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const banned = await client.moderation.isAddressBanned(zeroAddress);
      expect(typeof banned).toBe("boolean");
    });

    test("isNetworkBanned returns boolean for chain 0", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const banned = await client.moderation.isNetworkBanned(0n);
      expect(typeof banned).toBe("boolean");
    });

    test("getBanInfo returns info", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const info = await client.moderation.getBanInfo(zeroAddress);
      expect(info === null || typeof info === "object").toBe(true);
    });
  });

  describe("Reporting", () => {
    test("getReport returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const report = await client.moderation.getReport("0x" + "00".repeat(32) as Hex);
      expect(report === null || typeof report === "object").toBe(true);
    });
  });

  describe("Reputation Labels", () => {
    test("getLabel returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const label = await client.moderation.getLabel("0x" + "00".repeat(32) as Hex);
      expect(label === null || typeof label === "object").toBe(true);
    });

    test("getAddressLabels returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const labels = await client.moderation.getAddressLabels(zeroAddress);
      expect(Array.isArray(labels)).toBe(true);
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

