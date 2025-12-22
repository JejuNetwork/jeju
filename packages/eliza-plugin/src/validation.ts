/**
 * Validation utilities for eliza-plugin
 *
 * Fail-fast validation instead of defensive fallbacks
 * Security-focused utilities for input validation and sanitization
 */

import type { IAgentRuntime, Memory } from '@elizaos/core'
import { z } from 'zod'
import { JEJU_SERVICE_NAME } from './service'

// ============================================================================
// Security Constants
// ============================================================================

/** Maximum message text length to prevent DoS */
export const MAX_MESSAGE_LENGTH = 10_000

/** Maximum JSON input size in bytes */
export const MAX_JSON_SIZE = 1_000_000 // 1MB

/** Maximum JSON parsing depth */
export const MAX_JSON_DEPTH = 10

/** Maximum output length for responses */
export const MAX_OUTPUT_LENGTH = 50_000

/** Fetch timeout in milliseconds */
export const FETCH_TIMEOUT_MS = 30_000

/** Maximum number of items in lists */
export const MAX_LIST_ITEMS = 100

// ============================================================================
// Core Extraction Utilities
// ============================================================================

/**
 * Extract and validate message text content
 * Throws if text is missing or empty
 */
export function getMessageText(message: Memory): string {
  const text = message.content?.text
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Message text is required')
  }
  return text
}

/**
 * Extract message text, returns empty string if not provided
 * Use this only for optional text where empty is valid
 */
export function getOptionalMessageText(message: Memory): string {
  const text = message.content?.text
  return typeof text === 'string' ? text : ''
}

/**
 * Standard validate function for all actions
 */
export function validateServiceExists(runtime: IAgentRuntime): boolean {
  return !!runtime.getService(JEJU_SERVICE_NAME)
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
  errorMessage = 'API response missing data',
): T {
  if (response.data === undefined || response.data === null) {
    throw new Error(errorMessage)
  }
  return response.data
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
  const arr = data[field]
  if (!Array.isArray(arr)) {
    throw new Error(errorMessage ?? `Expected array at '${field}'`)
  }
  return arr as T[]
}

/**
 * Expect a value to be defined (not null/undefined)
 * Throws with descriptive error if missing
 */
export function expect<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${name} to be defined`)
  }
  return value
}

// ============================================================================
// Common Zod Schemas
// ============================================================================

/** Ethereum address */
const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')

/** Positive ETH amount string */
const ethAmountSchema = z.string().regex(/^\d+(\.\d+)?$/, 'Invalid ETH amount')

/** Report types for moderation */
const reportTypeSchema = z.enum([
  'spam',
  'scam',
  'abuse',
  'illegal',
  'tos_violation',
  'other',
])

/** Case status for moderation */
const caseStatusSchema = z.enum([
  'pending',
  'under_review',
  'resolved',
  'appealed',
  'closed',
])

/** Evidence position */
const evidencePositionSchema = z.enum(['for', 'against'])

// ============================================================================
// Message Content Schemas for Actions
// ============================================================================

/** Base content schema with optional text */
const baseContentSchema = z.object({
  text: z.string().optional(),
})

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
})

/** Evidence support content */
export const evidenceSupportSchema = baseContentSchema.extend({
  evidenceId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  support: z.boolean().optional(),
  comment: z.string().optional(),
  stake: ethAmountSchema.optional(),
})

/** Case creation content */
export const caseContentSchema = baseContentSchema.extend({
  entity: addressSchema.optional(),
  reportType: reportTypeSchema.optional(),
  description: z.string().optional(),
  evidence: z.string().optional(),
  stake: ethAmountSchema.optional(),
})

/** Case lookup content */
export const caseIdSchema = baseContentSchema.extend({
  caseId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  status: caseStatusSchema.optional(),
})

/** Appeal content */
export const appealContentSchema = baseContentSchema.extend({
  caseId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  reason: z.string().optional(),
  stake: ethAmountSchema.optional(),
})

/** Label content */
export const labelContentSchema = baseContentSchema.extend({
  target: addressSchema.optional(),
  label: z.string().optional(),
  score: z.number().min(0).max(10000).optional(),
  reason: z.string().optional(),
  expiresIn: z.number().optional(),
})

/** Bounty creation content */
export const bountyContentSchema = baseContentSchema.extend({
  title: z.string().optional(),
  description: z.string().optional(),
  reward: ethAmountSchema.optional(),
  deadline: z.number().optional(),
  tags: z.array(z.string()).optional(),
})

/** Bounty claim/lookup content */
export const bountyIdSchema = baseContentSchema.extend({
  bountyId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
})

/** Work submission content */
export const workSubmissionSchema = baseContentSchema.extend({
  bountyId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  workContent: z.string().optional(),
  proofOfWork: z.string().optional(),
})

/** Submission approval/rejection content */
export const submissionActionSchema = baseContentSchema.extend({
  submissionId: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
  feedback: z.string().optional(),
})

/** Project creation content */
export const projectContentSchema = baseContentSchema.extend({
  name: z.string().optional(),
  description: z.string().optional(),
  repository: z.string().optional(),
  budget: ethAmountSchema.optional(),
  mine: z.boolean().optional(),
})

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
})

/** Guardian registration content */
export const guardianContentSchema = baseContentSchema.extend({
  name: z.string().optional(),
  stake: ethAmountSchema.optional(),
})

// ============================================================================
// Type Exports from Schemas
// ============================================================================

export type EvidenceContent = z.infer<typeof evidenceContentSchema>
export type EvidenceSupportContent = z.infer<typeof evidenceSupportSchema>
export type CaseContent = z.infer<typeof caseContentSchema>
export type CaseIdContent = z.infer<typeof caseIdSchema>
export type AppealContent = z.infer<typeof appealContentSchema>
export type LabelContent = z.infer<typeof labelContentSchema>
export type BountyContent = z.infer<typeof bountyContentSchema>
export type BountyIdContent = z.infer<typeof bountyIdSchema>
export type WorkSubmissionContent = z.infer<typeof workSubmissionSchema>
export type SubmissionActionContent = z.infer<typeof submissionActionSchema>
export type ProjectContent = z.infer<typeof projectContentSchema>
export type TaskContent = z.infer<typeof taskContentSchema>
export type GuardianContent = z.infer<typeof guardianContentSchema>

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
  const result = schema.safeParse(message.content)
  if (!result.success) {
    throw new Error(`Invalid message content: ${result.error.message}`)
  }
  return result.data
}

// ============================================================================
// Provider Validation
// ============================================================================

export interface ValidatedProvider {
  name: string
  address: string
  resources: {
    gpuType: string
    gpuCount: number
  }
  pricing: {
    pricePerHour: bigint | number
    pricePerHourFormatted?: string
  }
}

export function validateProvider(provider: {
  name: string
  address: string
  resources?: { gpuType?: string; gpuCount?: number }
  pricing?: { pricePerHour?: bigint | number; pricePerHourFormatted?: string }
}): ValidatedProvider {
  if (!provider.resources?.gpuType) {
    throw new Error(`Provider ${provider.name} missing gpuType`)
  }
  if (provider.resources.gpuCount === undefined) {
    throw new Error(`Provider ${provider.name} missing gpuCount`)
  }
  if (provider.pricing?.pricePerHour === undefined) {
    throw new Error(`Provider ${provider.name} missing pricing`)
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
  }
}

// ============================================================================
// API Response Validators
// ============================================================================

export interface PoolStats {
  tvl: number
  volume24h: number
  totalPools: number
  totalSwaps: number
}

const poolStatsSchema = z.object({
  tvl: z.number(),
  volume24h: z.number(),
  totalPools: z.number(),
  totalSwaps: z.number(),
})

export function validatePoolStats(data: Record<string, unknown>): PoolStats {
  return poolStatsSchema.parse(data)
}

export interface NodeStats {
  totalNodes: number
  activeNodes: number
  totalStake: string
  averageUptime: number
  capacity: string
}

const nodeStatsSchema = z.object({
  totalNodes: z.number(),
  activeNodes: z.number(),
  totalStake: z.string(),
  averageUptime: z.number(),
  capacity: z.string(),
})

export function validateNodeStats(data: Record<string, unknown>): NodeStats {
  return nodeStatsSchema.parse(data)
}

export interface IntentQuote {
  amountIn: string
  amountOut: string
  fee: string
  estimatedTimeSeconds: number
}

const intentQuoteSchema = z.object({
  amountIn: z.string(),
  amountOut: z.string(),
  fee: z.string(),
  estimatedTimeSeconds: z.number(),
})

export function validateIntentQuote(
  data: Record<string, unknown>,
): IntentQuote {
  return intentQuoteSchema.parse(data)
}

export interface IntentInfo {
  intentId: string
  status: string
  sourceChain: string
  destChain: string
  amountIn: string
  amountOut: string
  solver: string
  txHash?: string
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
})

export function validateIntentInfo(data: Record<string, unknown>): IntentInfo {
  return intentInfoSchema.parse(data)
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
    .slice(0, Math.min(maxItems, MAX_LIST_ITEMS))
    .map((item, i) => `${i + 1}. ${formatter(item)}`)
    .join('\n')
}

// ============================================================================
// Security Utilities
// ============================================================================

/**
 * Validates a URL is safe to fetch (prevents SSRF attacks)
 * Blocks internal IPs, localhost, cloud metadata endpoints, private ranges
 */
export function isUrlSafeToFetch(urlString: string): boolean {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return false
  }

  // Only allow http/https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false
  }

  const hostname = url.hostname.toLowerCase()

  // Block localhost variants
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    return false
  }

  // Block cloud metadata endpoints
  if (
    hostname === '169.254.169.254' || // AWS/GCP/Azure metadata
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.internal' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.corp') ||
    hostname.startsWith('metadata.')
  ) {
    return false
  }

  // Block IPv6 private/special ranges
  if (hostname.startsWith('[') || hostname.includes(':')) {
    // Block all IPv6 for safety - too many edge cases
    return false
  }

  // Block private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number)
    if (
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      a === 0 || // 0.0.0.0/8
      a === 127 || // 127.0.0.0/8
      (a === 169 && b === 254) || // 169.254.0.0/16 link-local
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      a >= 224 || // Multicast/Reserved (224.0.0.0+)
      (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 IETF Protocol
      (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24 TEST-NET-1
      (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 TEST-NET-2
      (a === 203 && b === 0 && c === 113) // 203.0.113.0/24 TEST-NET-3
    ) {
      return false
    }
    // Block if any octet is invalid
    if (a > 255 || b > 255 || c > 255 || d > 255) {
      return false
    }
  }

  // Block numeric hostnames that could be IP addresses in alternative formats
  // This prevents octal (0177.0.0.1), hex (0x7f.0.0.1), decimal (2130706433) bypasses
  if (
    /^\d+$/.test(hostname) ||
    /^0x/i.test(hostname) ||
    /^0\d+\./.test(hostname)
  ) {
    return false
  }

  return true
}

/**
 * Fetch with timeout to prevent indefinite hangs
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'error', // Prevent redirect-based SSRF
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Safely parse JSON with size and depth limits
 */
export function safeJsonParse<T>(
  jsonString: string,
  maxSize: number = MAX_JSON_SIZE,
): T {
  if (jsonString.length > maxSize) {
    throw new Error(`JSON input exceeds maximum size of ${maxSize} bytes`)
  }

  // Simple depth check by counting nested brackets
  let depth = 0
  let maxDepthReached = 0
  for (const char of jsonString) {
    if (char === '{' || char === '[') {
      depth++
      maxDepthReached = Math.max(maxDepthReached, depth)
      if (maxDepthReached > MAX_JSON_DEPTH) {
        throw new Error(
          `JSON exceeds maximum nesting depth of ${MAX_JSON_DEPTH}`,
        )
      }
    } else if (char === '}' || char === ']') {
      depth--
    }
  }

  return JSON.parse(jsonString) as T
}

/**
 * Truncate output to prevent excessive response sizes
 */
export function truncateOutput(
  text: string,
  maxLength: number = MAX_OUTPUT_LENGTH,
): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 20)}\n...[truncated]`
}

/**
 * Sanitize user-provided text to prevent prompt injection
 * Removes or escapes potentially dangerous patterns
 */
export function sanitizeText(text: string): string {
  // Remove null bytes
  let sanitized = text.replace(/\0/g, '')

  // Limit length
  if (sanitized.length > MAX_MESSAGE_LENGTH) {
    sanitized = sanitized.slice(0, MAX_MESSAGE_LENGTH)
  }

  return sanitized
}

/**
 * Sanitize external agent response to prevent context poisoning
 * Marks content as untrusted and limits length
 */
export function sanitizeAgentResponse(response: string): string {
  const sanitized = sanitizeText(response)
  const truncated = truncateOutput(sanitized, 10000) // 10KB max for agent responses
  return truncated
}

/**
 * Validate Ethereum address format strictly
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Validate hex string (transaction hash, etc)
 */
export function isValidHex(hex: string, expectedLength?: number): boolean {
  const pattern = expectedLength
    ? new RegExp(`^0x[a-fA-F0-9]{${expectedLength}}$`)
    : /^0x[a-fA-F0-9]+$/
  return pattern.test(hex)
}

/**
 * Safely extract and validate addresses from text
 */
export function extractAddress(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{40}/)
  if (match && isValidAddress(match[0])) {
    return match[0]
  }
  return null
}

/**
 * Validate message text with length limit
 */
export function getMessageTextSecure(
  message: Memory,
  maxLength: number = MAX_MESSAGE_LENGTH,
): string {
  const text = message.content?.text
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Message text is required')
  }
  return sanitizeText(text.slice(0, maxLength))
}
