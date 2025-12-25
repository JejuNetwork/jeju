/**
 * Safe Prompt Builder for Agents
 *
 * Ensures prompts stay under model context limits and consolidates prompt
 * building logic to prevent context window overflow.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import { get_encoding } from 'tiktoken'

// Model context limits (conservative estimates)
const MODEL_LIMITS = {
  'unsloth/Qwen3-4B-128K': 128000,
  'Qwen/Qwen2.5-3B-Instruct': 32768,
  'Qwen/Qwen2.5-7B-Instruct': 32768,
  'Qwen/Qwen2.5-14B-Instruct': 32768,
  'Qwen/Qwen2.5-32B-Instruct': 32768,
  'Qwen/Qwen2.5-72B-Instruct': 32768,
  'meta-llama/Llama-3.1-8B-Instruct': 128000,
  'meta-llama/Llama-3.1-70B-Instruct': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'claude-3-5-sonnet': 200000,
  'claude-3-opus': 200000,
  default: 32768,
} as const satisfies Record<string, number>

const DEFAULT_TOKEN_LIMIT = MODEL_LIMITS.default

// Lazy-loaded encoder
let encoder: ReturnType<typeof get_encoding> | null = null

function getEncoder() {
  if (!encoder) {
    encoder = get_encoding('cl100k_base')
  }
  return encoder
}

/**
 * Count tokens in a string using tiktoken
 */
export function countTokensSync(text: string): number {
  return getEncoder().encode(text).length
}

/**
 * Get the context limit for a model
 */
export function getModelTokenLimit(model: string): number {
  return MODEL_LIMITS[model as keyof typeof MODEL_LIMITS] ?? DEFAULT_TOKEN_LIMIT
}

/**
 * Truncate text to fit within a token limit
 */
export function truncateToTokenLimitSync(
  text: string,
  maxTokens: number,
  options: { ellipsis?: boolean } = {},
): { text: string; tokens: number; truncated: boolean } {
  const enc = getEncoder()
  const tokens = enc.encode(text)

  if (tokens.length <= maxTokens) {
    return { text, tokens: tokens.length, truncated: false }
  }

  // Truncate tokens
  const truncatedTokens = tokens.slice(0, maxTokens)
  let truncatedText = new TextDecoder().decode(enc.decode(truncatedTokens))

  if (options.ellipsis) {
    truncatedText = `${truncatedText.trimEnd()}...`
  }

  return {
    text: truncatedText,
    tokens: truncatedTokens.length,
    truncated: true,
  }
}

export interface PromptSection {
  name: string
  content: string
  priority: number // Higher = more important, kept if truncation needed
  minTokens?: number // Minimum tokens to keep (for critical sections)
}

/**
 * Builds a safe prompt that fits within model context limits
 *
 * @param sections - Ordered prompt sections with priorities
 * @param model - Model name (for context limit lookup)
 * @param safetyMargin - Tokens to reserve (default: 2000)
 * @returns Truncated prompt that fits within context limit
 */
export function buildSafePrompt(
  sections: PromptSection[],
  model = 'Qwen/Qwen2.5-3B-Instruct',
  safetyMargin = 2000,
): {
  prompt: string
  truncated: boolean
  originalTokens: number
  finalTokens: number
} {
  // Get model limit
  const modelLimit = getModelTokenLimit(model)
  const maxPromptTokens = modelLimit - safetyMargin

  // Build initial prompt
  const fullPrompt = sections
    .sort((a, b) => b.priority - a.priority) // Highest priority first
    .map((s) => s.content)
    .join('\n\n')

  // Count tokens
  const estimatedTokens = countTokensSync(fullPrompt)

  // Check if within limit
  if (estimatedTokens <= maxPromptTokens) {
    return {
      prompt: fullPrompt,
      truncated: false,
      originalTokens: estimatedTokens,
      finalTokens: estimatedTokens,
    }
  }

  // Need to truncate - use priority-based approach
  logger.warn(
    `Prompt exceeds limit: ${estimatedTokens} > ${maxPromptTokens}, truncating`,
    {
      model,
      estimatedTokens,
      limit: maxPromptTokens,
    },
  )

  // Keep high-priority sections, truncate low-priority
  const sortedSections = [...sections].sort((a, b) => b.priority - a.priority)
  let currentTokens = 0
  const keptSections: string[] = []

  for (const section of sortedSections) {
    const sectionTokens = countTokensSync(section.content)
    const minRequired = section.minTokens ?? 0

    if (currentTokens + sectionTokens <= maxPromptTokens) {
      // Fits completely
      keptSections.push(section.content)
      currentTokens += sectionTokens
    } else if (currentTokens + minRequired <= maxPromptTokens) {
      // Truncate this section to fit
      const available = maxPromptTokens - currentTokens
      const truncated = truncateToTokenLimitSync(section.content, available, {
        ellipsis: true,
      })
      keptSections.push(truncated.text)
      currentTokens += truncated.tokens
      break // Stop here
    } else {
      // Can't fit even minimum - skip lower priority sections
      break
    }
  }

  const finalPrompt = keptSections.join('\n\n')
  const finalTokens = countTokensSync(finalPrompt)

  logger.info('Prompt truncated successfully', {
    original: estimatedTokens,
    final: finalTokens,
    sectionsKept: keptSections.length,
    sectionsTotal: sections.length,
  })

  return {
    prompt: finalPrompt,
    truncated: true,
    originalTokens: estimatedTokens,
    finalTokens,
  }
}

/**
 * Quick prompt builder for simple cases
 * Automatically truncates if needed
 */
export function buildPrompt(
  systemPrompt: string,
  userPrompt: string,
  model = 'Qwen/Qwen2.5-3B-Instruct',
): string {
  const result = buildSafePrompt(
    [
      { name: 'system', content: systemPrompt, priority: 100, minTokens: 500 },
      { name: 'user', content: userPrompt, priority: 90, minTokens: 1000 },
    ],
    model,
  )

  if (result.truncated) {
    logger.warn(
      `Prompt was truncated from ${result.originalTokens} to ${result.finalTokens} tokens`,
    )
  }

  return result.prompt
}

/**
 * Estimate if a prompt will fit within model limits
 */
export function willPromptFit(
  prompt: string,
  model = 'Qwen/Qwen2.5-3B-Instruct',
  safetyMargin = 2000,
): { fits: boolean; tokens: number; limit: number } {
  const tokens = countTokensSync(prompt)
  const limit = getModelTokenLimit(model) - safetyMargin

  return {
    fits: tokens <= limit,
    tokens,
    limit,
  }
}
