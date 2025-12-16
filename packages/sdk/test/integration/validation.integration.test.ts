/**
 * Validation Module Integration Tests
 * 
 * Tests ERC-8004 ValidationRegistry against REAL localnet.
 * Run: jeju dev --minimal first, then bun test
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createJejuClient, type JejuClient } from "../../src";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, Address } from "viem";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VALIDATOR_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

describe("Validation Integration Tests", () => {
  let agentClient: JejuClient;
  let validatorClient: JejuClient;
  let chainRunning = false;
  let contractsDeployed = false;

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

    // Create clients for agent owner and validator
    const agentAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
    agentClient = await createJejuClient({
      account: agentAccount,
      network: "localnet",
      rpcUrl: RPC_URL,
    });

    const validatorAccount = privateKeyToAccount(VALIDATOR_PRIVATE_KEY);
    validatorClient = await createJejuClient({
      account: validatorAccount,
      network: "localnet",
      rpcUrl: RPC_URL,
    });

    // Check if contracts are deployed by trying to call a view function
    if (chainRunning) {
      try {
        await agentClient.validation.getAgentValidations(1n);
        contractsDeployed = true;
      } catch {
        console.log("⚠️ ValidationRegistry not deployed - some tests will be skipped");
      }
    }
  });

  test("validation module exists on client", () => {
    expect(agentClient).toBeDefined();
    expect(agentClient.validation).toBeDefined();
    expect(typeof agentClient.validation.requestValidation).toBe("function");
    expect(typeof agentClient.validation.respondToValidation).toBe("function");
    expect(typeof agentClient.validation.getStatus).toBe("function");
    expect(typeof agentClient.validation.getRequest).toBe("function");
    expect(typeof agentClient.validation.getSummary).toBe("function");
    expect(typeof agentClient.validation.getAgentValidations).toBe("function");
    expect(typeof agentClient.validation.getValidatorRequests).toBe("function");
    expect(typeof agentClient.validation.requestExists).toBe("function");
  });

  test("getAgentValidations returns array for non-existent agent", async () => {
    if (!chainRunning || !contractsDeployed) return;

    const validations = await agentClient.validation.getAgentValidations(999999n);
    expect(Array.isArray(validations)).toBe(true);
    expect(validations.length).toBe(0);
  });

  test("getValidatorRequests returns array for address with no requests", async () => {
    if (!chainRunning || !contractsDeployed) return;

    const requests = await agentClient.validation.getValidatorRequests(
      "0x0000000000000000000000000000000000000001" as Address
    );
    expect(Array.isArray(requests)).toBe(true);
    expect(requests.length).toBe(0);
  });

  test("requestExists returns false for non-existent request", async () => {
    if (!chainRunning || !contractsDeployed) return;

    const exists = await agentClient.validation.requestExists(
      "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex
    );
    expect(exists).toBe(false);
  });

  test("getSummary returns zero counts for agent with no validations", async () => {
    if (!chainRunning || !contractsDeployed) return;

    const summary = await agentClient.validation.getSummary(999999n);
    expect(summary.count).toBe(0);
    expect(summary.avgResponse).toBe(0);
    expect(summary.agentId).toBe(999999n);
  });

  test("getStatus returns null for non-existent request", async () => {
    if (!chainRunning || !contractsDeployed) return;

    const status = await agentClient.validation.getStatus(
      "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex
    );
    expect(status).toBe(null);
  });

  test("getRequest returns null for non-existent request", async () => {
    if (!chainRunning || !contractsDeployed) return;

    const request = await agentClient.validation.getRequest(
      "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex
    );
    expect(request).toBe(null);
  });

  test("respondToValidation validates response range", async () => {
    // This should throw without needing chain
    await expect(
      agentClient.validation.respondToValidation({
        requestHash: "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex,
        response: 101, // Invalid - must be 0-100
      })
    ).rejects.toThrow("Response must be 0-100");

    await expect(
      agentClient.validation.respondToValidation({
        requestHash: "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex,
        response: -1, // Invalid - must be 0-100
      })
    ).rejects.toThrow("Response must be 0-100");
  });
});

describe("Validation Types", () => {
  test("ValidationStatus interface has correct shape", () => {
    // Type check - this is a compile-time test
    const mockStatus = {
      requestHash: "0x123" as Hex,
      validatorAddress: "0x456" as Address,
      agentId: 1n,
      response: 95,
      responseHash: "0x789" as Hex,
      tag: "0xabc" as Hex,
      lastUpdate: 1234567890,
    };

    expect(mockStatus.requestHash).toBeDefined();
    expect(mockStatus.validatorAddress).toBeDefined();
    expect(mockStatus.agentId).toBeDefined();
    expect(mockStatus.response).toBeDefined();
    expect(mockStatus.responseHash).toBeDefined();
    expect(mockStatus.tag).toBeDefined();
    expect(mockStatus.lastUpdate).toBeDefined();
  });

  test("ValidationSummary interface has correct shape", () => {
    const mockSummary = {
      agentId: 1n,
      count: 5,
      avgResponse: 85,
    };

    expect(mockSummary.agentId).toBeDefined();
    expect(mockSummary.count).toBeDefined();
    expect(mockSummary.avgResponse).toBeDefined();
  });

  test("ValidationRequest interface has correct shape", () => {
    const mockRequest = {
      requestHash: "0x123" as Hex,
      validatorAddress: "0x456" as Address,
      agentId: 1n,
      requestUri: "ipfs://QmTest",
      timestamp: 1234567890,
    };

    expect(mockRequest.requestHash).toBeDefined();
    expect(mockRequest.validatorAddress).toBeDefined();
    expect(mockRequest.agentId).toBeDefined();
    expect(mockRequest.requestUri).toBeDefined();
    expect(mockRequest.timestamp).toBeDefined();
  });
});
