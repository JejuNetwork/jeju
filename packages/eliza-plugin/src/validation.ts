/**
 * Validation utilities for eliza-plugin
 *
 * Fail-fast validation instead of defensive fallbacks
 */

import { z } from "zod";
import type { Memory, IAgentRuntime } from "@elizaos/core";
import { JEJU_SERVICE_NAME } from "./service";

// ============================================================================
// Core Extraction Utilities
// ============================================================================

/**
 * Extract and validate message text content
 * Throws if text is missing or empty
 */
export function getMessageText(message: Memory): string {
  const text = message.content?.text;
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("Message text is required");
  }
  return text;
}

/**
 * Extract message text, returns empty string if not provided
 * Use this only for optional text where empty is valid
 */
export function getOptionalMessageText(message: Memory): string {
  const text = message.content?.text;
  return typeof text === "string" ? text : "";
}

/**
 * Standard validate function for all actions
 */
export function validateServiceExists(runtime: IAgentRuntime): boolean {
  return !!runtime.getService(JEJU_SERVICE_NAME);
}

// ============================================================================
// Response Validation Utilities
// ============================================================================

/**
 * Validate API response data exists
 * Throws if response data is missing
 */
export function expectResponseData<T>(
  response: { data?: T },
  errorMessage = "API response missing data",
): T {
  if (response.data === undefined || response.data === null) {
    throw new Error(errorMessage);
  }
  return response.data;
}

/**
 * Validate an array from API response
 * Throws if the array field is missing
 */
export function expectArray<T>(
  data: Record<string, unknown>,
  field: string,
  errorMessage?: string,
): T[] {
  const arr = data[field];
  if (!Array.isArray(arr)) {
    throw new Error(errorMessage ?? `Expected array at '${field}'`);
  }
  return arr as T[];
}

/**
 * Expect a value to be defined (not null/undefined)
 * Throws with descriptive error if missing
 */
export function expect<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${name} to be defined`);
  }
  return value;
}

// ============================================================================
// Common Zod Schemas
// ============================================================================

/** Ethereum address */
const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

/** Positive ETH amount string */
const ethAmountSchema = z.string().regex(/^\d+(\.\d+)?$/, "Invalid ETH amount");

/** Report types for moderation */
const reportTypeSchema = z.enum([
  "spam",
  "scam",
  "abuse",
  "illegal",
  "tos_violation",
  "other",
]);

/** Case status for moderation */
const caseStatusSchema = z.enum([
  "pending",
  "under_review",
  "resolved",
  "appealed",
  "closed",
]);

/** Evidence position */
const evidencePositionSchema = z.enum(["for", "against"]);

// ============================================================================
// Message Content Schemas for Actions
// ============================================================================

/** Base content schema with optional text */
const baseContentSchema = z.object({
  text: z.string().optional(),
});

/** Evidence submission content */
export const evidenceContentSchema = baseContentSchema.extend({
  caseId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  ipfsHash: z.string().optional(),
  summary: z.string().optional(),
  position: evidencePositionSchema.optional(),
  stake: ethAmountSchema.optional(),
});

/** Evidence support content */
export const evidenceSupportSchema = baseContentSchema.extend({
  evidenceId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  support: z.boolean().optional(),
  comment: z.string().optional(),
  stake: ethAmountSchema.optional(),
});

/** Case creation content */
export const caseContentSchema = baseContentSchema.extend({
  entity: addressSchema.optional(),
  reportType: reportTypeSchema.optional(),
  description: z.string().optional(),
  evidence: z.string().optional(),
  stake: ethAmountSchema.optional(),
});

/** Case lookup content */
export const caseIdSchema = baseContentSchema.extend({
  caseId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  status: caseStatusSchema.optional(),
});

/** Appeal content */
export const appealContentSchema = baseContentSchema.extend({
  caseId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  reason: z.string().optional(),
  stake: ethAmountSchema.optional(),
});

/** Label content */
export const labelContentSchema = baseContentSchema.extend({
  target: addressSchema.optional(),
  label: z.string().optional(),
  score: z.number().min(0).max(10000).optional(),
  reason: z.string().optional(),
  expiresIn: z.number().optional(),
});

/** Bounty creation content */
export const bountyContentSchema = baseContentSchema.extend({
  title: z.string().optional(),
  description: z.string().optional(),
  reward: ethAmountSchema.optional(),
  deadline: z.number().optional(),
  tags: z.array(z.string()).optional(),
});

/** Bounty claim/lookup content */
export const bountyIdSchema = baseContentSchema.extend({
  bountyId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
});

/** Work submission content */
export const workSubmissionSchema = baseContentSchema.extend({
  bountyId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  workContent: z.string().optional(),
  proofOfWork: z.string().optional(),
});

/** Submission approval/rejection content */
export const submissionActionSchema = baseContentSchema.extend({
  submissionId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  feedback: z.string().optional(),
});

/** Project creation content */
export const projectContentSchema = baseContentSchema.extend({
  name: z.string().optional(),
  description: z.string().optional(),
  repository: z.string().optional(),
  budget: ethAmountSchema.optional(),
  mine: z.boolean().optional(),
});

/** Task creation content */
export const taskContentSchema = baseContentSchema.extend({
  projectId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  reward: ethAmountSchema.optional(),
  dueDate: z.number().optional(),
});

/** Guardian registration content */
export const guardianContentSchema = baseContentSchema.extend({
  name: z.string().optional(),
  stake: ethAmountSchema.optional(),
});

// ============================================================================
// Type Exports from Schemas
// ============================================================================

export type EvidenceContent = z.infer<typeof evidenceContentSchema>;
export type EvidenceSupportContent = z.infer<typeof evidenceSupportSchema>;
export type CaseContent = z.infer<typeof caseContentSchema>;
export type CaseIdContent = z.infer<typeof caseIdSchema>;
export type AppealContent = z.infer<typeof appealContentSchema>;
export type LabelContent = z.infer<typeof labelContentSchema>;
export type BountyContent = z.infer<typeof bountyContentSchema>;
export type BountyIdContent = z.infer<typeof bountyIdSchema>;
export type WorkSubmissionContent = z.infer<typeof workSubmissionSchema>;
export type SubmissionActionContent = z.infer<typeof submissionActionSchema>;
export type ProjectContent = z.infer<typeof projectContentSchema>;
export type TaskContent = z.infer<typeof taskContentSchema>;
export type GuardianContent = z.infer<typeof guardianContentSchema>;

// ============================================================================
// Content Parsing Utilities
// ============================================================================

/**
 * Parse and validate message content with a schema
 * Returns undefined fields as undefined (doesn't throw for missing optional fields)
 */
export function parseContent<T extends z.ZodType>(
  message: Memory,
  schema: T,
): z.infer<T> {
  const result = schema.safeParse(message.content);
  if (!result.success) {
    throw new Error(`Invalid message content: ${result.error.message}`);
  }
  return result.data;
}

// ============================================================================
// Provider Validation
// ============================================================================

export interface ValidatedProvider {
  name: string;
  address: string;
  resources: {
    gpuType: string;
    gpuCount: number;
  };
  pricing: {
    pricePerHour: bigint | number;
    pricePerHourFormatted?: string;
  };
}

export function validateProvider(provider: {
  name: string;
  address: string;
  resources?: { gpuType?: string; gpuCount?: number };
  pricing?: { pricePerHour?: bigint | number; pricePerHourFormatted?: string };
}): ValidatedProvider {
  if (!provider.resources?.gpuType) {
    throw new Error(`Provider ${provider.name} missing gpuType`);
  }
  if (provider.resources.gpuCount === undefined) {
    throw new Error(`Provider ${provider.name} missing gpuCount`);
  }
  if (provider.pricing?.pricePerHour === undefined) {
    throw new Error(`Provider ${provider.name} missing pricing`);
  }

  return {
    name: provider.name,
    address: provider.address,
    resources: {
      gpuType: provider.resources.gpuType,
      gpuCount: provider.resources.gpuCount,
    },
    pricing: {
      pricePerHour: provider.pricing.pricePerHour,
      pricePerHourFormatted: provider.pricing.pricePerHourFormatted,
    },
  };
}

// ============================================================================
// API Response Validators
// ============================================================================

export interface PoolStats {
  tvl: number;
  volume24h: number;
  totalPools: number;
  totalSwaps: number;
}

const poolStatsSchema = z.object({
  tvl: z.number(),
  volume24h: z.number(),
  totalPools: z.number(),
  totalSwaps: z.number(),
});

export function validatePoolStats(data: Record<string, unknown>): PoolStats {
  return poolStatsSchema.parse(data);
}

export interface NodeStats {
  totalNodes: number;
  activeNodes: number;
  totalStake: string;
  averageUptime: number;
  capacity: string;
}

const nodeStatsSchema = z.object({
  totalNodes: z.number(),
  activeNodes: z.number(),
  totalStake: z.string(),
  averageUptime: z.number(),
  capacity: z.string(),
});

export function validateNodeStats(data: Record<string, unknown>): NodeStats {
  return nodeStatsSchema.parse(data);
}

export interface IntentQuote {
  amountIn: string;
  amountOut: string;
  fee: string;
  estimatedTimeSeconds: number;
}

const intentQuoteSchema = z.object({
  amountIn: z.string(),
  amountOut: z.string(),
  fee: z.string(),
  estimatedTimeSeconds: z.number(),
});

export function validateIntentQuote(
  data: Record<string, unknown>,
): IntentQuote {
  return intentQuoteSchema.parse(data);
}

export interface IntentInfo {
  intentId: string;
  status: string;
  sourceChain: string;
  destChain: string;
  amountIn: string;
  amountOut: string;
  solver: string;
  txHash?: string;
}

const intentInfoSchema = z.object({
  intentId: z.string(),
  status: z.string(),
  sourceChain: z.string(),
  destChain: z.string(),
  amountIn: z.string(),
  amountOut: z.string(),
  solver: z.string(),
  txHash: z.string().optional(),
});

export function validateIntentInfo(data: Record<string, unknown>): IntentInfo {
  return intentInfoSchema.parse(data);
}

// ============================================================================
// List Formatting Utilities
// ============================================================================

/**
 * Format a numbered list
 */
export function formatNumberedList<T>(
  items: T[],
  formatter: (item: T) => string,
  maxItems = 10,
): string {
  return items
    .slice(0, maxItems)
    .map((item, i) => `${i + 1}. ${formatter(item)}`)
    .join("\n");
}
