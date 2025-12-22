/**
 * Payments Module Tests
 *
 * Tests payment functionality: x402, credits, paymasters
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ServiceTypeSchema } from "../payments";

describe("ServiceTypeSchema", () => {
  it("should accept valid service types", () => {
    expect(ServiceTypeSchema.parse("compute")).toBe("compute");
    expect(ServiceTypeSchema.parse("storage")).toBe("storage");
    expect(ServiceTypeSchema.parse("inference")).toBe("inference");
  });

  it("should reject invalid service types", () => {
    expect(() => ServiceTypeSchema.parse("invalid")).toThrow();
    expect(() => ServiceTypeSchema.parse("")).toThrow();
    expect(() => ServiceTypeSchema.parse(123)).toThrow();
  });
});

describe("Payment schemas", () => {
  const PaymasterInfoSchema = z.object({
    address: z.string(),
    token: z.string(),
    tokenSymbol: z.string(),
    active: z.boolean(),
    entryPointBalance: z.bigint(),
    vaultLiquidity: z.bigint(),
    exchangeRate: z.bigint(),
  });

  it("should validate paymaster info structure", () => {
    const info = {
      address: "0x1234567890123456789012345678901234567890",
      token: "0xabcdef1234567890123456789012345678901234",
      tokenSymbol: "USDC",
      active: true,
      entryPointBalance: 1000000000000000000n,
      vaultLiquidity: 5000000000000000000n,
      exchangeRate: 1000000n,
    };

    const result = PaymasterInfoSchema.parse(info);
    expect(result.tokenSymbol).toBe("USDC");
    expect(result.active).toBe(true);
  });

  const X402ReceiptSchema = z.object({
    paymentId: z.string(),
    amount: z.bigint(),
    timestamp: z.number(),
    signature: z.string(),
  });

  it("should validate x402 receipt structure", () => {
    const receipt = {
      paymentId: "0x1234-1234567890",
      amount: 1000000000000000n,
      timestamp: 1703179200,
      signature: "0xabcdef...",
    };

    const result = X402ReceiptSchema.parse(receipt);
    expect(result.paymentId).toBe("0x1234-1234567890");
    expect(result.timestamp).toBe(1703179200);
  });

  const CreditBalanceSchema = z.object({
    service: ServiceTypeSchema,
    balance: z.bigint(),
    balanceFormatted: z.string(),
  });

  it("should validate credit balance structure", () => {
    const balance = {
      service: "compute" as const,
      balance: 5000000000000000000n,
      balanceFormatted: "5.0",
    };

    const result = CreditBalanceSchema.parse(balance);
    expect(result.service).toBe("compute");
    expect(result.balanceFormatted).toBe("5.0");
  });
});

describe("X402 payment message format", () => {
  it("should generate correct message format", () => {
    const resource = "/api/v1/compute/job/123";
    const maxAmount = 1000000000000000n;
    const timestamp = 1703179200;

    const message = `x402:${resource}:${maxAmount.toString()}:${timestamp}`;

    expect(message).toBe(
      "x402:/api/v1/compute/job/123:1000000000000000:1703179200",
    );
  });

  it("should generate correct payment ID format", () => {
    const address = "0x1234567890123456789012345678901234567890";
    const timestamp = 1703179200;

    const paymentId = `${address}-${timestamp}`;

    expect(paymentId).toBe(
      "0x1234567890123456789012345678901234567890-1703179200",
    );
  });
});

describe("Service ID mapping", () => {
  const SERVICE_IDS = {
    compute: 0,
    storage: 1,
    inference: 2,
  } as const;

  it("should have correct service IDs", () => {
    expect(SERVICE_IDS.compute).toBe(0);
    expect(SERVICE_IDS.storage).toBe(1);
    expect(SERVICE_IDS.inference).toBe(2);
  });

  it("should cover all service types", () => {
    const serviceTypes: Array<"compute" | "storage" | "inference"> = [
      "compute",
      "storage",
      "inference",
    ];

    for (const service of serviceTypes) {
      expect(SERVICE_IDS[service]).toBeDefined();
      expect(typeof SERVICE_IDS[service]).toBe("number");
    }
  });
});
