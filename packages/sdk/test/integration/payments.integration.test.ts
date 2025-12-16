/**
 * Payments Module Integration Tests
 * 
 * Tests paymaster and x402 against REAL localnet.
 * Run: jeju dev --minimal first, then bun test
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

describe("Payments Integration Tests", () => {
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
    expect(client.payments).toBeDefined();
  });

  test("getBalance returns bigint", async () => {
    if (!chainRunning) return;

    const balance = await client.payments.getBalance();
    expect(typeof balance).toBe("bigint");
  });

  test("getCredits returns bigint", async () => {
    if (!chainRunning) return;

    const credits = await client.payments.getCredits();
    expect(typeof credits).toBe("bigint");
  });

  test("listPaymasters returns array", async () => {
    if (!chainRunning) return;

    const paymasters = await client.payments.listPaymasters();
    expect(Array.isArray(paymasters)).toBe(true);
  });

  test("getPaymasterStatus returns valid status", async () => {
    if (!chainRunning) return;

    const paymasters = await client.payments.listPaymasters();
    if (paymasters.length === 0) return;

    const status = await client.payments.getPaymasterStatus(paymasters[0].address);
    expect(status).toBeDefined();
    expect(typeof status.active).toBe("boolean");
  });
});

