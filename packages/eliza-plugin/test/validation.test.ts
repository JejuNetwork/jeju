/**
 * Unit tests for validation utilities
 *
 * Tests Zod schemas, validation helpers, and parsing utilities
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import type { Memory } from "@elizaos/core";
import {
  getMessageText,
  getOptionalMessageText,
  expectResponseData,
  expectArray,
  expect as expectValue,
  parseContent,
  validateProvider,
  validatePoolStats,
  validateNodeStats,
  validateIntentQuote,
  validateIntentInfo,
  formatNumberedList,
  evidenceContentSchema,
  evidenceSupportSchema,
  caseContentSchema,
  caseIdSchema,
  appealContentSchema,
  labelContentSchema,
  bountyContentSchema,
  bountyIdSchema,
  workSubmissionSchema,
  submissionActionSchema,
  projectContentSchema,
  taskContentSchema,
  guardianContentSchema,
  type ValidatedProvider,
  type PoolStats,
  type NodeStats,
  type IntentQuote,
  type IntentInfo,
} from "../src/validation";

// =============================================================================
// Test Helpers
// =============================================================================

function createMemory(content: Record<string, unknown>): Memory {
  return {
    content,
    userId: "test-user",
    agentId: "test-agent",
    roomId: "test-room",
  } as Memory;
}

// =============================================================================
// getMessageText Tests
// =============================================================================

describe("getMessageText", () => {
  test("extracts text from message content", () => {
    const message = createMemory({ text: "Hello world" });
    expect(getMessageText(message)).toBe("Hello world");
  });

  test("throws on missing text", () => {
    const message = createMemory({});
    expect(() => getMessageText(message)).toThrow("Message text is required");
  });

  test("throws on empty text", () => {
    const message = createMemory({ text: "" });
    expect(() => getMessageText(message)).toThrow("Message text is required");
  });

  test("throws on whitespace-only text", () => {
    const message = createMemory({ text: "   " });
    expect(() => getMessageText(message)).toThrow("Message text is required");
  });

  test("throws on non-string text", () => {
    const message = createMemory({ text: 123 });
    expect(() => getMessageText(message)).toThrow("Message text is required");
  });

  test("throws on null text", () => {
    const message = createMemory({ text: null });
    expect(() => getMessageText(message)).toThrow("Message text is required");
  });

  test("handles text with leading/trailing whitespace", () => {
    const message = createMemory({ text: "  valid text  " });
    expect(getMessageText(message)).toBe("  valid text  ");
  });
});

// =============================================================================
// getOptionalMessageText Tests
// =============================================================================

describe("getOptionalMessageText", () => {
  test("extracts text from message content", () => {
    const message = createMemory({ text: "Hello world" });
    expect(getOptionalMessageText(message)).toBe("Hello world");
  });

  test("returns empty string for missing text", () => {
    const message = createMemory({});
    expect(getOptionalMessageText(message)).toBe("");
  });

  test("returns empty string for empty text", () => {
    const message = createMemory({ text: "" });
    expect(getOptionalMessageText(message)).toBe("");
  });

  test("returns empty string for non-string text", () => {
    const message = createMemory({ text: 123 });
    expect(getOptionalMessageText(message)).toBe("");
  });

  test("returns empty string for null", () => {
    const message = createMemory({ text: null });
    expect(getOptionalMessageText(message)).toBe("");
  });
});

// =============================================================================
// expectResponseData Tests
// =============================================================================

describe("expectResponseData", () => {
  test("returns data when present", () => {
    const response = { data: { foo: "bar" } };
    expect(expectResponseData(response)).toEqual({ foo: "bar" });
  });

  test("returns array data", () => {
    const response = { data: [1, 2, 3] };
    expect(expectResponseData(response)).toEqual([1, 2, 3]);
  });

  test("returns primitive data", () => {
    const response = { data: "string value" };
    expect(expectResponseData(response)).toBe("string value");
  });

  test("throws on undefined data", () => {
    const response = {};
    expect(() => expectResponseData(response)).toThrow(
      "API response missing data",
    );
  });

  test("throws on null data", () => {
    const response = { data: null };
    expect(() => expectResponseData(response)).toThrow(
      "API response missing data",
    );
  });

  test("uses custom error message", () => {
    const response = {};
    expect(() => expectResponseData(response, "Custom error")).toThrow(
      "Custom error",
    );
  });

  test("returns falsy but valid data (0)", () => {
    const response = { data: 0 };
    expect(expectResponseData(response)).toBe(0);
  });

  test("returns falsy but valid data (empty string)", () => {
    const response = { data: "" };
    expect(expectResponseData(response)).toBe("");
  });

  test("returns falsy but valid data (false)", () => {
    const response = { data: false };
    expect(expectResponseData(response)).toBe(false);
  });
});

// =============================================================================
// expectArray Tests
// =============================================================================

describe("expectArray", () => {
  test("returns array at field", () => {
    const data = { items: [1, 2, 3] };
    expect(expectArray<number>(data, "items")).toEqual([1, 2, 3]);
  });

  test("returns empty array", () => {
    const data = { items: [] };
    expect(expectArray<number>(data, "items")).toEqual([]);
  });

  test("returns array of objects", () => {
    const data = { users: [{ id: 1 }, { id: 2 }] };
    expect(expectArray<{ id: number }>(data, "users")).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  test("throws on non-array field", () => {
    const data = { items: "not an array" };
    expect(() => expectArray(data, "items")).toThrow(
      "Expected array at 'items'",
    );
  });

  test("throws on missing field", () => {
    const data = { other: [1, 2] };
    expect(() => expectArray(data, "items")).toThrow(
      "Expected array at 'items'",
    );
  });

  test("throws on null field", () => {
    const data = { items: null };
    expect(() => expectArray(data, "items")).toThrow(
      "Expected array at 'items'",
    );
  });

  test("throws on object field", () => {
    const data = { items: { foo: "bar" } };
    expect(() => expectArray(data, "items")).toThrow(
      "Expected array at 'items'",
    );
  });

  test("uses custom error message", () => {
    const data = { items: null };
    expect(() => expectArray(data, "items", "Items must be array")).toThrow(
      "Items must be array",
    );
  });
});

// =============================================================================
// expect (expectValue) Tests
// =============================================================================

describe("expect (value assertion)", () => {
  test("returns value when defined", () => {
    expect(expectValue("hello", "text")).toBe("hello");
  });

  test("returns object when defined", () => {
    const obj = { foo: "bar" };
    expect(expectValue(obj, "config")).toEqual(obj);
  });

  test("returns zero (falsy but defined)", () => {
    expect(expectValue(0, "count")).toBe(0);
  });

  test("returns empty string (falsy but defined)", () => {
    expect(expectValue("", "name")).toBe("");
  });

  test("returns false (falsy but defined)", () => {
    expect(expectValue(false, "enabled")).toBe(false);
  });

  test("throws on null", () => {
    expect(() => expectValue(null, "value")).toThrow(
      "Expected value to be defined",
    );
  });

  test("throws on undefined", () => {
    expect(() => expectValue(undefined, "config")).toThrow(
      "Expected config to be defined",
    );
  });
});

// =============================================================================
// parseContent Tests
// =============================================================================

describe("parseContent", () => {
  const simpleSchema = z.object({
    text: z.string().optional(),
    amount: z.number().optional(),
  });

  test("parses valid content", () => {
    const message = createMemory({ text: "hello", amount: 100 });
    const result = parseContent(message, simpleSchema);
    expect(result.text).toBe("hello");
    expect(result.amount).toBe(100);
  });

  test("handles optional fields", () => {
    const message = createMemory({ text: "hello" });
    const result = parseContent(message, simpleSchema);
    expect(result.text).toBe("hello");
    expect(result.amount).toBeUndefined();
  });

  test("throws on invalid content", () => {
    const strictSchema = z.object({
      name: z.string(),
    });
    const message = createMemory({ name: 123 });
    expect(() => parseContent(message, strictSchema)).toThrow(
      "Invalid message content",
    );
  });

  test("works with complex schema", () => {
    const message = createMemory({
      text: "Create bounty",
      title: "Fix bug",
      reward: "1.5",
    });
    const result = parseContent(message, bountyContentSchema);
    expect(result.title).toBe("Fix bug");
    expect(result.reward).toBe("1.5");
  });
});

// =============================================================================
// validateProvider Tests
// =============================================================================

describe("validateProvider", () => {
  test("validates complete provider", () => {
    const provider = {
      name: "GPU Provider",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      resources: { gpuType: "NVIDIA_H100", gpuCount: 4 },
      pricing: { pricePerHour: 1000000000000000n, pricePerHourFormatted: "0.001" },
    };
    const result = validateProvider(provider);
    expect(result.name).toBe("GPU Provider");
    expect(result.resources.gpuType).toBe("NVIDIA_H100");
    expect(result.resources.gpuCount).toBe(4);
    expect(result.pricing.pricePerHour).toBe(1000000000000000n);
  });

  test("throws on missing gpuType", () => {
    const provider = {
      name: "GPU Provider",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      resources: { gpuCount: 4 },
      pricing: { pricePerHour: 1000n },
    };
    expect(() => validateProvider(provider)).toThrow(
      "Provider GPU Provider missing gpuType",
    );
  });

  test("throws on missing gpuCount", () => {
    const provider = {
      name: "GPU Provider",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      resources: { gpuType: "NVIDIA_H100" },
      pricing: { pricePerHour: 1000n },
    };
    expect(() => validateProvider(provider)).toThrow(
      "Provider GPU Provider missing gpuCount",
    );
  });

  test("throws on missing pricing", () => {
    const provider = {
      name: "GPU Provider",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      resources: { gpuType: "NVIDIA_H100", gpuCount: 4 },
    };
    expect(() => validateProvider(provider)).toThrow(
      "Provider GPU Provider missing pricing",
    );
  });

  test("throws on missing resources", () => {
    const provider = {
      name: "GPU Provider",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      pricing: { pricePerHour: 1000n },
    };
    expect(() => validateProvider(provider)).toThrow(
      "Provider GPU Provider missing gpuType",
    );
  });

  test("handles gpuCount of zero", () => {
    const provider = {
      name: "GPU Provider",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      resources: { gpuType: "NVIDIA_H100", gpuCount: 0 },
      pricing: { pricePerHour: 1000n },
    };
    const result = validateProvider(provider);
    expect(result.resources.gpuCount).toBe(0);
  });

  test("handles number pricing", () => {
    const provider = {
      name: "GPU Provider",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      resources: { gpuType: "NVIDIA_H100", gpuCount: 4 },
      pricing: { pricePerHour: 1000 },
    };
    const result = validateProvider(provider);
    expect(result.pricing.pricePerHour).toBe(1000);
  });
});

// =============================================================================
// validatePoolStats Tests
// =============================================================================

describe("validatePoolStats", () => {
  test("validates complete pool stats", () => {
    const data = {
      tvl: 1000000,
      volume24h: 50000,
      totalPools: 10,
      totalSwaps: 5000,
    };
    const result = validatePoolStats(data);
    expect(result.tvl).toBe(1000000);
    expect(result.volume24h).toBe(50000);
    expect(result.totalPools).toBe(10);
    expect(result.totalSwaps).toBe(5000);
  });

  test("throws on missing tvl", () => {
    const data = {
      volume24h: 50000,
      totalPools: 10,
      totalSwaps: 5000,
    };
    expect(() => validatePoolStats(data)).toThrow();
  });

  test("throws on invalid type", () => {
    const data = {
      tvl: "1000000",
      volume24h: 50000,
      totalPools: 10,
      totalSwaps: 5000,
    };
    expect(() => validatePoolStats(data)).toThrow();
  });

  test("handles zero values", () => {
    const data = {
      tvl: 0,
      volume24h: 0,
      totalPools: 0,
      totalSwaps: 0,
    };
    const result = validatePoolStats(data);
    expect(result.tvl).toBe(0);
  });
});

// =============================================================================
// validateNodeStats Tests
// =============================================================================

describe("validateNodeStats", () => {
  test("validates complete node stats", () => {
    const data = {
      totalNodes: 100,
      activeNodes: 95,
      totalStake: "1000000000000000000000",
      averageUptime: 99.5,
      capacity: "80%",
    };
    const result = validateNodeStats(data);
    expect(result.totalNodes).toBe(100);
    expect(result.activeNodes).toBe(95);
    expect(result.totalStake).toBe("1000000000000000000000");
    expect(result.averageUptime).toBe(99.5);
    expect(result.capacity).toBe("80%");
  });

  test("throws on missing activeNodes", () => {
    const data = {
      totalNodes: 100,
      totalStake: "1000",
      averageUptime: 99.5,
      capacity: "80%",
    };
    expect(() => validateNodeStats(data)).toThrow();
  });

  test("throws on wrong type for averageUptime", () => {
    const data = {
      totalNodes: 100,
      activeNodes: 95,
      totalStake: "1000",
      averageUptime: "99.5%",
      capacity: "80%",
    };
    expect(() => validateNodeStats(data)).toThrow();
  });
});

// =============================================================================
// validateIntentQuote Tests
// =============================================================================

describe("validateIntentQuote", () => {
  test("validates complete intent quote", () => {
    const data = {
      amountIn: "1000000000000000000",
      amountOut: "2500000000",
      fee: "1000000000000000",
      estimatedTimeSeconds: 120,
    };
    const result = validateIntentQuote(data);
    expect(result.amountIn).toBe("1000000000000000000");
    expect(result.amountOut).toBe("2500000000");
    expect(result.fee).toBe("1000000000000000");
    expect(result.estimatedTimeSeconds).toBe(120);
  });

  test("throws on missing field", () => {
    const data = {
      amountIn: "1000",
      amountOut: "2500",
      fee: "10",
    };
    expect(() => validateIntentQuote(data)).toThrow();
  });

  test("throws on invalid type", () => {
    const data = {
      amountIn: 1000,
      amountOut: "2500",
      fee: "10",
      estimatedTimeSeconds: 120,
    };
    expect(() => validateIntentQuote(data)).toThrow();
  });
});

// =============================================================================
// validateIntentInfo Tests
// =============================================================================

describe("validateIntentInfo", () => {
  test("validates complete intent info", () => {
    const data = {
      intentId: "0x1234567890abcdef",
      status: "filled",
      sourceChain: "ethereum",
      destChain: "arbitrum",
      amountIn: "1000000000000000000",
      amountOut: "2500000000",
      solver: "0xabcdef1234567890abcdef1234567890abcdef12",
      txHash: "0xdef456",
    };
    const result = validateIntentInfo(data);
    expect(result.intentId).toBe("0x1234567890abcdef");
    expect(result.status).toBe("filled");
    expect(result.txHash).toBe("0xdef456");
  });

  test("validates intent info without optional txHash", () => {
    const data = {
      intentId: "0x1234567890abcdef",
      status: "pending",
      sourceChain: "ethereum",
      destChain: "arbitrum",
      amountIn: "1000000000000000000",
      amountOut: "2500000000",
      solver: "0xabcdef1234567890abcdef1234567890abcdef12",
    };
    const result = validateIntentInfo(data);
    expect(result.txHash).toBeUndefined();
  });

  test("throws on missing required field", () => {
    const data = {
      intentId: "0x1234",
      status: "pending",
      sourceChain: "ethereum",
      amountIn: "1000",
      amountOut: "2500",
      solver: "0xabc",
    };
    expect(() => validateIntentInfo(data)).toThrow();
  });
});

// =============================================================================
// formatNumberedList Tests
// =============================================================================

describe("formatNumberedList", () => {
  test("formats simple list", () => {
    const items = ["apple", "banana", "cherry"];
    const result = formatNumberedList(items, (item) => item);
    expect(result).toBe("1. apple\n2. banana\n3. cherry");
  });

  test("formats list with custom formatter", () => {
    const items = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const result = formatNumberedList(
      items,
      (item) => `${item.name} (${item.age})`,
    );
    expect(result).toBe("1. Alice (30)\n2. Bob (25)");
  });

  test("respects maxItems limit", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const result = formatNumberedList(items, (n) => n.toString(), 5);
    expect(result).toBe("1. 1\n2. 2\n3. 3\n4. 4\n5. 5");
  });

  test("handles empty list", () => {
    const items: string[] = [];
    const result = formatNumberedList(items, (item) => item);
    expect(result).toBe("");
  });

  test("handles single item", () => {
    const items = ["only"];
    const result = formatNumberedList(items, (item) => item);
    expect(result).toBe("1. only");
  });

  test("uses default maxItems of 10", () => {
    const items = Array.from({ length: 15 }, (_, i) => i + 1);
    const result = formatNumberedList(items, (n) => n.toString());
    const lines = result.split("\n");
    expect(lines.length).toBe(10);
    expect(lines[9]).toBe("10. 10");
  });
});

// =============================================================================
// Zod Schema Tests - evidenceContentSchema
// =============================================================================

describe("evidenceContentSchema", () => {
  test("parses valid evidence content", () => {
    const content = {
      text: "Submit evidence",
      caseId: "0x1234567890abcdef",
      ipfsHash: "QmXyz123",
      summary: "Evidence summary",
      position: "for",
      stake: "1.5",
    };
    const result = evidenceContentSchema.parse(content);
    expect(result.caseId).toBe("0x1234567890abcdef");
    expect(result.position).toBe("for");
    expect(result.stake).toBe("1.5");
  });

  test("accepts partial content", () => {
    const content = { text: "Submit" };
    const result = evidenceContentSchema.parse(content);
    expect(result.text).toBe("Submit");
    expect(result.caseId).toBeUndefined();
  });

  test("validates caseId format", () => {
    const content = { caseId: "invalid-id" };
    expect(() => evidenceContentSchema.parse(content)).toThrow();
  });

  test("validates position enum", () => {
    const content = { position: "invalid" };
    expect(() => evidenceContentSchema.parse(content)).toThrow();
  });

  test("validates stake format", () => {
    const content = { stake: "abc" };
    expect(() => evidenceContentSchema.parse(content)).toThrow();
  });

  test("accepts valid stake formats", () => {
    expect(evidenceContentSchema.parse({ stake: "1.5" }).stake).toBe("1.5");
    expect(evidenceContentSchema.parse({ stake: "100" }).stake).toBe("100");
    expect(evidenceContentSchema.parse({ stake: "0.001" }).stake).toBe("0.001");
  });
});

// =============================================================================
// Zod Schema Tests - caseContentSchema
// =============================================================================

describe("caseContentSchema", () => {
  test("parses valid case content", () => {
    const content = {
      entity: "0x1234567890abcdef1234567890abcdef12345678",
      reportType: "spam",
      description: "This is spam",
      stake: "0.1",
    };
    const result = caseContentSchema.parse(content);
    expect(result.reportType).toBe("spam");
  });

  test("validates address format", () => {
    const content = {
      entity: "0x123", // too short
    };
    expect(() => caseContentSchema.parse(content)).toThrow();
  });

  test("validates report type enum", () => {
    const valid = ["spam", "scam", "abuse", "illegal", "tos_violation", "other"];
    for (const type of valid) {
      const result = caseContentSchema.parse({ reportType: type });
      expect(result.reportType).toBe(type);
    }
  });

  test("rejects invalid report type", () => {
    const content = { reportType: "hacking" };
    expect(() => caseContentSchema.parse(content)).toThrow();
  });
});

// =============================================================================
// Zod Schema Tests - labelContentSchema
// =============================================================================

describe("labelContentSchema", () => {
  test("parses valid label content", () => {
    const content = {
      target: "0x1234567890abcdef1234567890abcdef12345678",
      label: "trusted_developer",
      score: 5000,
      reason: "Verified contributions",
      expiresIn: 365 * 24 * 60 * 60,
    };
    const result = labelContentSchema.parse(content);
    expect(result.score).toBe(5000);
    expect(result.label).toBe("trusted_developer");
  });

  test("validates score range", () => {
    expect(labelContentSchema.parse({ score: 0 }).score).toBe(0);
    expect(labelContentSchema.parse({ score: 10000 }).score).toBe(10000);
    expect(() => labelContentSchema.parse({ score: -1 })).toThrow();
    expect(() => labelContentSchema.parse({ score: 10001 })).toThrow();
  });
});

// =============================================================================
// Zod Schema Tests - bountyContentSchema
// =============================================================================

describe("bountyContentSchema", () => {
  test("parses valid bounty content", () => {
    const content = {
      title: "Fix login bug",
      description: "The login button doesn't work on mobile",
      reward: "0.5",
      deadline: 1735689600,
      tags: ["bug", "frontend", "urgent"],
    };
    const result = bountyContentSchema.parse(content);
    expect(result.title).toBe("Fix login bug");
    expect(result.tags).toEqual(["bug", "frontend", "urgent"]);
  });

  test("handles empty tags array", () => {
    const content = { tags: [] };
    const result = bountyContentSchema.parse(content);
    expect(result.tags).toEqual([]);
  });

  test("validates reward format", () => {
    expect(() => bountyContentSchema.parse({ reward: "abc" })).toThrow();
  });
});

// =============================================================================
// Zod Schema Tests - Address Validation (property-based style)
// =============================================================================

describe("Address validation", () => {
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;

  test("valid addresses", () => {
    const validAddresses = [
      "0x1234567890abcdef1234567890abcdef12345678",
      "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
      "0x0000000000000000000000000000000000000000",
      "0xffffffffffffffffffffffffffffffffffffffff",
    ];

    for (const addr of validAddresses) {
      const result = caseContentSchema.safeParse({ entity: addr });
      expect(result.success).toBe(true);
    }
  });

  test("invalid addresses", () => {
    const invalidAddresses = [
      "1234567890abcdef1234567890abcdef12345678", // missing 0x
      "0x1234", // too short
      "0x1234567890abcdef1234567890abcdef123456789", // too long
      "0xGHIJKL7890abcdef1234567890abcdef12345678", // invalid chars
      "", // empty
      "not-an-address",
    ];

    for (const addr of invalidAddresses) {
      const result = caseContentSchema.safeParse({ entity: addr });
      expect(result.success).toBe(false);
    }
  });
});

// =============================================================================
// Zod Schema Tests - ETH Amount Validation (property-based style)
// =============================================================================

describe("ETH amount validation", () => {
  test("valid ETH amounts", () => {
    const validAmounts = [
      "0",
      "1",
      "100",
      "0.1",
      "0.001",
      "123.456789",
      "1000000",
      "0.000000000000000001",
    ];

    for (const amount of validAmounts) {
      const result = evidenceContentSchema.safeParse({ stake: amount });
      expect(result.success).toBe(true);
    }
  });

  test("invalid ETH amounts", () => {
    const invalidAmounts = [
      "",
      "abc",
      "-1",
      "1,000",
      "1.2.3",
      "1e18",
      "0x1",
      " 1",
      "1 ",
    ];

    for (const amount of invalidAmounts) {
      const result = evidenceContentSchema.safeParse({ stake: amount });
      expect(result.success).toBe(false);
    }
  });
});

// =============================================================================
// Zod Schema Tests - Hex ID Validation
// =============================================================================

describe("Hex ID validation (caseId/bountyId format)", () => {
  test("valid hex IDs", () => {
    const validIds = [
      "0x1",
      "0xabcdef",
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "0xABCDEF",
      "0x0",
    ];

    for (const id of validIds) {
      const result = caseIdSchema.safeParse({ caseId: id });
      expect(result.success).toBe(true);
    }
  });

  test("invalid hex IDs", () => {
    const invalidIds = [
      "1234", // missing 0x
      "0xGHIJ", // invalid hex chars
      "", // empty
      "0x", // no digits after 0x
    ];

    for (const id of invalidIds) {
      const result = caseIdSchema.safeParse({ caseId: id });
      expect(result.success).toBe(false);
    }
  });
});

// =============================================================================
// Edge Cases and Boundary Conditions
// =============================================================================

describe("Edge cases", () => {
  test("very long strings in text fields", () => {
    const longString = "a".repeat(10000);
    const result = bountyContentSchema.parse({
      description: longString,
    });
    expect(result.description).toBe(longString);
  });

  test("unicode in text fields", () => {
    const result = bountyContentSchema.parse({
      title: "修复登录错误 🐛",
      description: "Ελληνικά 日本語 العربية",
    });
    expect(result.title).toBe("修复登录错误 🐛");
  });

  test("very large numbers", () => {
    const result = bountyContentSchema.parse({
      deadline: Number.MAX_SAFE_INTEGER,
    });
    expect(result.deadline).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("score at boundaries", () => {
    expect(labelContentSchema.parse({ score: 0 }).score).toBe(0);
    expect(labelContentSchema.parse({ score: 10000 }).score).toBe(10000);
  });

  test("empty object parses with defaults", () => {
    const result = bountyContentSchema.parse({});
    expect(result.title).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });
});
