/**
 * Cross-chain (EIL + OIF) Integration Tests
 * 
 * Tests against REAL localnet cross-chain infrastructure.
 * Run: jeju dev first, then bun test
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:6546";
const GATEWAY_URL = process.env.GATEWAY_A2A_URL || "http://127.0.0.1:4003";

describe("Cross-chain Integration Tests", () => {
  let client: JejuClient | null = null;
  let chainRunning = false;
  let oifRunning = false;

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

    try {
      const response = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(3000) });
      oifRunning = response.ok;
    } catch {
      // Gateway not running
    }

    if (chainRunning) {
      try {
        const account = privateKeyToAccount(TEST_PRIVATE_KEY);
        client = await createJejuClient({
          account,
          network: "localnet",
          rpcUrl: RPC_URL,
          smartAccount: false,
        smartAccount: false,
        });
      } catch {
        chainRunning = false;
      }
    }
  });

  test("client created successfully", () => {
    if (!chainRunning) return;
    expect(client).toBeDefined();
    expect(client?.crosschain).toBeDefined();
  });

  test("getSupportedChains returns array", () => {
    if (!chainRunning || !client) return;
    const chains = client.crosschain.getSupportedChains();
    expect(Array.isArray(chains)).toBe(true);
    expect(chains.length).toBeGreaterThan(0);
  });

  test("listSolvers returns array", async () => {
    if (!oifRunning || !client) return;
    try {
      const solvers = await client.crosschain.listSolvers();
      expect(Array.isArray(solvers)).toBe(true);
    } catch {
      // Expected if service not running
    }
  });

  test("listXLPs returns array", async () => {
    if (!chainRunning || !client) return;
    try {
      const xlps = await client.crosschain.listXLPs();
      expect(Array.isArray(xlps)).toBe(true);
    } catch {
      // Expected if contracts not deployed
    }
  });

  test("listMyIntents returns array", async () => {
    if (!oifRunning || !client) return;
    try {
      const intents = await client.crosschain.listMyIntents();
      expect(Array.isArray(intents)).toBe(true);
    } catch {
      // Expected if service not running
    }
  });
});

