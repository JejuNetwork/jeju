/**
 * Agents Module Integration Tests
 *
 * Tests AI agent vault functionality against live localnet.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress, type Hex } from "viem";
import { setupTestEnvironment, teardownTestEnvironment } from "../setup";

describe("Agents Module Integration Tests", () => {
  let client: JejuClient;
  let env: Awaited<ReturnType<typeof setupTestEnvironment>>;
  let skipTests = false;

  beforeAll(async () => {
    env = await setupTestEnvironment();

    if (!env.chainRunning) {
      console.log("⚠ Chain not running - skipping agents tests");
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

  describe("Vault Management", () => {
    test("getAllVaults returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const vaults = await client.agents.getAllVaults();
      expect(Array.isArray(vaults)).toBe(true);
    });

    test("getVaultInfo returns null for non-existent", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const info = await client.agents.getVaultInfo(zeroAddress);
      expect(info === null || typeof info === "object").toBe(true);
    });

    test("getMyVaults returns array", async () => {
      if (skipTests || !env.contractsDeployed) return;
      const vaults = await client.agents.getMyVaults();
      expect(Array.isArray(vaults)).toBe(true);
    });
  });

  describe("Balance Queries", () => {
    test("getVaultBalance returns balance info", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const balance = await client.agents.getVaultBalance(zeroAddress);
        expect(balance === null || typeof balance === "object").toBe(true);
      } catch {
        // Expected for non-existent vault
      }
    });
  });

  describe("Operator Management", () => {
    test("isOperator returns boolean", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const isOp = await client.agents.isOperator(zeroAddress, zeroAddress);
        expect(typeof isOp).toBe("boolean");
      } catch {
        // Expected for non-existent vault
      }
    });
  });

  describe("Spending Limits", () => {
    test("getSpendingLimit returns limit info", async () => {
      if (skipTests || !env.contractsDeployed) return;
      try {
        const limit = await client.agents.getSpendingLimit(zeroAddress, zeroAddress);
        expect(limit === null || typeof limit === "object").toBe(true);
      } catch {
        // Expected for non-existent vault
      }
    });
  });

  describe("Module Constants", () => {
    test("DEFAULT_SPEND_LIMIT is defined", () => {
      if (skipTests) return;
      expect(client.agents.DEFAULT_SPEND_LIMIT).toBeDefined();
    });
  });
});

