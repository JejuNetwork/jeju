/**
 * Identity Module Integration Tests
 * 
 * Tests ERC-8004 registry against REAL localnet.
 * Run: jeju dev --minimal first, then bun test
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

describe("Identity Integration Tests", () => {
  let client: JejuClient;
  let chainRunning = false;

  beforeAll(async () => {
    // Check if chain is running
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }),
        signal: AbortSignal.timeout(3000),
      });
      chainRunning = response.ok;
    } catch {
      console.log("⚠️ Chain not running - some tests will be skipped");
    }

    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    client = await createJejuClient({
      account,
      network: "localnet",
      rpcUrl: RPC_URL,
    });
  });

  test("client created successfully", () => {
    expect(client).toBeDefined();
    expect(client.identity).toBeDefined();
  });

  test("getMyAgent returns null or agent info", async () => {
    if (!chainRunning) return;

    const agent = await client.identity.getMyAgent();
    // Could be null if not registered, or an object if registered
    expect(agent === null || typeof agent === "object").toBe(true);
  });

  test("amIBanned returns boolean", async () => {
    if (!chainRunning) return;

    const banned = await client.identity.amIBanned();
    expect(typeof banned).toBe("boolean");
  });

  test("listAgents returns array", async () => {
    if (!chainRunning) return;

    const agents = await client.identity.listAgents();
    expect(Array.isArray(agents)).toBe(true);
  });

  test("listAgents with tag filter", async () => {
    if (!chainRunning) return;

    const agents = await client.identity.listAgents(["ai"]);
    expect(Array.isArray(agents)).toBe(true);
  });
});

