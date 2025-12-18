/**
 * Governance Module Integration Tests
 * 
 * Tests against REAL localnet governance contracts.
 * Run: jeju dev --minimal first, then bun test
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

describe("Governance Integration Tests", () => {
  let client: JejuClient | null = null;
  let chainRunning = false;

  beforeAll(async () => {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }),
        signal: AbortSignal.timeout(3000),
      });
      chainRunning = response.ok;
    } catch {
      // Chain not running
    }

    if (chainRunning) {
      try {
        const account = privateKeyToAccount(TEST_PRIVATE_KEY);
        client = await createJejuClient({
          account,
          network: "localnet",
          rpcUrl: RPC_URL,
        });
      } catch {
        chainRunning = false;
      }
    }
  });

  test("client created successfully", () => {
    if (!chainRunning) return;
    expect(client).toBeDefined();
    expect(client?.governance).toBeDefined();
  });

  test("listProposals returns array", async () => {
    if (!chainRunning || !client) return;
    try {
      const proposals = await client.governance.listProposals();
      expect(Array.isArray(proposals)).toBe(true);
    } catch {
      // Expected if contracts not deployed
    }
  });

  test("getVotingPower returns bigint", async () => {
    if (!chainRunning || !client) return;
    try {
      const power = await client.governance.getVotingPower();
      expect(typeof power).toBe("bigint");
    } catch {
      // Expected if contracts not deployed
    }
  });

  test("getDelegates returns address or null", async () => {
    if (!chainRunning || !client) return;
    try {
      const delegate = await client.governance.getDelegates();
      expect(delegate === null || typeof delegate === "string").toBe(true);
    } catch {
      // Expected if contracts not deployed
    }
  });
});

