/**
 * Token Counter Utilities
 *
 * Accurate token counting for LLM models with support for tiktoken and approximation.
 * Used for prompt building, context management, and token budget allocation.
 *
 * @module @jejunetwork/shared/tokens
 */

import type { Tiktoken } from 'js-tiktoken'

// Lazy-load encoding to avoid startup overhead
let encoding: Tiktoken | null = null

/**
 * Get the tiktoken encoding (lazy-loaded)
 */
async function getEncoding(): Promise<Tiktoken> {
  if (!encoding) {
    const { encodingForModel } = await import('js-tiktoken')
    encoding = encodingForModel('gpt-5')
  }
  return encoding
}

/**
 * Count tokens in text using tiktoken for accurate counting
 *
 * @param text - Text to count tokens for
 * @returns Number of tokens
 *
 * @example
 * ```typescript
 * const tokens = await countTokens('Hello, world!')
 * // Returns: ~3 tokens
 * ```
 */
export async function countTokens(text: string): Promise<number> {
  const enc = await getEncoding()
  const tokens = enc.encode(text)
  return tokens.length
}

/**
 * Count tokens synchronously using character-based approximation
 *
 * Provides a quick token count estimate (1 token per 4 characters).
 * Less accurate than countTokens but faster for real-time use.
 *
 * @param text - Text to count tokens for
 * @returns Approximate number of tokens
 *
 * @example
 * ```typescript
 * const tokens = countTokensSync('Hello, world!')
 * // Returns: ~4 tokens (approximation)
 * ```
 */
export function countTokensSync(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Truncate text to fit within token limit using binary search
 *
 * @param text - Text to truncate
 * @param maxTokens - Maximum token limit
 * @param options - Truncation options
 * @returns Truncated text and final token count
 *
 * @example
 * ```typescript
 * const result = await truncateToTokenLimit(longText, 1000)
 * // Returns: { text: 'truncated...', tokens: 1000 }
 * ```
 */
export async function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  options: {
    ellipsis?: boolean
    preserveEnd?: boolean
  } = {},
): Promise<{ text: string; tokens: number }> {
  const { ellipsis = true, preserveEnd = false } = options

  const currentTokens = await countTokens(text)

  if (currentTokens <= maxTokens) {
    return { text, tokens: currentTokens }
  }

  const ellipsisText = ellipsis ? '...' : ''
  const ellipsisTokens = ellipsis ? await countTokens(ellipsisText) : 0
  const targetTokens = maxTokens - ellipsisTokens

  let low = 0
  let high = text.length
  let bestLength = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const slice = preserveEnd
      ? text.slice(text.length - mid)
      : text.slice(0, mid)
    const tokens = await countTokens(slice)

    if (tokens <= targetTokens) {
      bestLength = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  const truncated = preserveEnd
    ? ellipsisText + text.slice(text.length - bestLength)
    : text.slice(0, bestLength) + ellipsisText

  const finalTokens = await countTokens(truncated)

  return { text: truncated, tokens: finalTokens }
}

/**
 * Truncate text synchronously using character-based approximation
 *
 * @param text - Text to truncate
 * @param maxTokens - Maximum token limit
 * @param options - Truncation options
 * @returns Truncated text and approximate token count
 */
export function truncateToTokenLimitSync(
  text: string,
  maxTokens: number,
  options: {
    ellipsis?: boolean
    preserveEnd?: boolean
  } = {},
): { text: string; tokens: number } {
  const { ellipsis = true, preserveEnd = false } = options

  const currentTokens = countTokensSync(text)

  if (currentTokens <= maxTokens) {
    return { text, tokens: currentTokens }
  }

  const ellipsisText = ellipsis ? '...' : ''
  const ellipsisTokens = ellipsis ? countTokensSync(ellipsisText) : 0
  const targetTokens = maxTokens - ellipsisTokens

  const targetChars = Math.floor(targetTokens * 4)

  const truncated = preserveEnd
    ? ellipsisText + text.slice(text.length - targetChars)
    : text.slice(0, targetChars) + ellipsisText

  const finalTokens = countTokensSync(truncated)

  return { text: truncated, tokens: finalTokens }
}

/**
 * Model-specific INPUT CONTEXT token limits.
 * Output limits are separate from input limits on modern models.
 */
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  // OpenAI
  'gpt-5.1': 128000,
  'gpt-5-nano': 128000,
  'gpt-5.1-turbo': 128000,
  'gpt-5': 8192,
  'gpt-5.2': 128000,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,

  // Qwen models
  'qwen/qwen3-32b': 131072,
  'unsloth/Qwen3-4B-128K': 131072,
  'unsloth/Qwen3-8B-128K': 131072,
  'unsloth/Qwen3-14B-128K': 131072,
  'unsloth/Qwen3-32B-128K': 131072,
  'OpenPipe/Qwen3-14B-Instruct': 32768,
  'Qwen/Qwen2.5-32B-Instruct': 131072,

  // Groq Models
  'llama-3.1-8b-instant': 131072,
  'llama-3.3-70b-versatile': 131072,
  'llama-3.1-70b-versatile': 131072,
  'meta-llama/llama-guard-4-12b': 131072,
  'openai/gpt-oss-120b': 131072,
  'openai/gpt-oss-20b': 131072,
  'meta-llama/llama-4-maverick-17b-128e-instruct': 131072,
  'meta-llama/llama-4-scout-17b-16e-instruct': 131072,
  'moonshotai/kimi-k2-instruct-0905': 262144,
  'mixtral-8x7b-32768': 32768,

  // Anthropic Claude 4.5
  'claude-opus-4-5': 200000,
  'claude-sonnet-4-5': 200000,

  // Google
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-2.0-flash': 1000000,
}

/**
 * Get maximum token limit for a model
 *
 * @param model - Model identifier
 * @returns Maximum input token limit (default: 8192)
 */
export function getModelTokenLimit(model: string): number {
  return MODEL_TOKEN_LIMITS[model] ?? 8192
}

/**
 * Calculate safe context limit with safety margin
 *
 * @param model - Model name
 * @param _outputTokens - Expected output tokens (unused, kept for compatibility)
 * @param safetyMargin - Safety margin to reserve (default: 2%)
 * @returns Safe input context limit (minimum 1000 tokens)
 */
export function getSafeContextLimit(
  model: string,
  _outputTokens = 8000,
  safetyMargin = 0.02,
): number {
  const inputLimit = getModelTokenLimit(model)
  const safeLimit = Math.floor(inputLimit * (1 - safetyMargin))
  return Math.max(1000, safeLimit)
}

/**
 * Budget tokens across multiple sections based on priority
 *
 * @param totalTokens - Total tokens available
 * @param sections - Sections with name, priority, and optional minTokens
 * @returns Token allocation per section
 *
 * @example
 * ```typescript
 * const budget = budgetTokens(10000, [
 *   { name: 'system', priority: 1, minTokens: 1000 },
 *   { name: 'user', priority: 3, minTokens: 500 },
 *   { name: 'context', priority: 2 }
 * ])
 * // Returns: { system: 2000, user: 6000, context: 2000 }
 * ```
 */
export function budgetTokens(
  totalTokens: number,
  sections: Array<{ name: string; priority: number; minTokens?: number }>,
): Record<string, number> {
  const budget: Record<string, number> = {}

  // First, allocate minimum tokens to each section
  let remaining = totalTokens

  for (const section of sections) {
    const min = section.minTokens ?? 0
    remaining -= min
    budget[section.name] = min
  }

  // If we're already over budget, scale down proportionally
  if (remaining < 0) {
    const scale = totalTokens / (totalTokens - remaining)
    for (const section of sections) {
      budget[section.name] = Math.floor((section.minTokens ?? 0) * scale)
    }
    return budget
  }

  // Distribute remaining tokens by priority
  const totalPriority = sections.reduce((sum, s) => sum + s.priority, 0)

  for (const section of sections) {
    const share = (section.priority / totalPriority) * remaining
    budget[section.name] = (budget[section.name] ?? 0) + Math.floor(share)
  }

  return budget
}

/**
 * Models requiring max_completion_tokens instead of max_tokens
 *
 * GPT-5.x and reasoning models (o1, o3, o4) use max_completion_tokens
 * to separately track reasoning tokens vs output tokens.
 */
const MODELS_REQUIRING_MAX_COMPLETION_TOKENS = ['gpt-5', 'o1', 'o3', 'o4']

/**
 * Check if a model requires max_completion_tokens parameter
 *
 * @param model - Model identifier (e.g., "gpt-5.2", "o1-mini")
 * @returns true if model requires max_completion_tokens
 */
export function requiresMaxCompletionTokens(model: string): boolean {
  return MODELS_REQUIRING_MAX_COMPLETION_TOKENS.some((prefix) =>
    model.startsWith(prefix),
  )
}

/**
 * Build token limit parameter for OpenAI-compatible API request
 *
 * Automatically uses correct parameter name based on model.
 *
 * @param model - Model identifier
 * @param maxTokens - Maximum tokens to generate
 * @returns Object with correct parameter name
 *
 * @example
 * ```typescript
 * const body = {
 *   model: 'gpt-5.2',
 *   messages: [...],
 *   ...buildMaxTokensParam('gpt-5.2', 4096)
 * }
 * // Returns: { max_completion_tokens: 4096 }
 * ```
 */
export function buildMaxTokensParam(
  model: string,
  maxTokens: number,
): { max_tokens: number } | { max_completion_tokens: number } {
  return requiresMaxCompletionTokens(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens }
}
