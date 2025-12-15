/**
 * Names (JNS) Module Integration Tests
 * 
 * Tests JNS registry against REAL localnet.
 * Run: jeju dev --minimal first, then bun test
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

describe("JNS (Names) Integration Tests", () => {
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
    expect(client.names).toBeDefined();
  });

  test("isAvailable returns boolean", async () => {
    if (!chainRunning) return;

    const available = await client.names.isAvailable("test-unique-name-123456");
    expect(typeof available).toBe("boolean");
  });

  test("getRegistrationCost returns bigint", async () => {
    if (!chainRunning) return;

    const cost = await client.names.getRegistrationCost("test", 1);
    expect(typeof cost).toBe("bigint");
    expect(cost > 0n).toBe(true);
  });

  test("resolve returns address or null", async () => {
    if (!chainRunning) return;

    // This may return null if name doesn't exist
    const address = await client.names.resolve("nonexistent-name.jeju");
    expect(address === null || typeof address === "string").toBe(true);
  });

  test("reverseResolve returns name or null", async () => {
    if (!chainRunning) return;

    const name = await client.names.reverseResolve(client.wallet.address);
    expect(name === null || typeof name === "string").toBe(true);
  });

  test("getExpiration returns date or null", async () => {
    if (!chainRunning) return;

    const expiry = await client.names.getExpiration("test.jeju");
    expect(expiry === null || expiry instanceof Date).toBe(true);
  });
});

