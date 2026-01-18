import { getCurrentNetwork } from '@jejunetwork/config'

/**
 * Maximum lengths for different input types to prevent DoS
 */
export const INPUT_LIMITS = {
  /** Short text fields like titles */
  TITLE: 200,
  /** Medium text fields like summaries */
  SUMMARY: 1000,
  /** Long text fields like descriptions */
  DESCRIPTION: 10000,
  /** Very long text fields like full proposals or PoC code */
  CONTENT: 50000,
  /** Array item count limits */
  ARRAY_ITEMS: 100,
  /** Single array item length */
  ARRAY_ITEM: 500,
} as const

/**
 * Patterns that could indicate prompt injection attempts
 * These patterns are designed to catch common injection techniques
 */
const INJECTION_PATTERNS = [
  // System/assistant role manipulation
  /\b(system|assistant)\s*:/gi,
  /\brole\s*:\s*(system|assistant)/gi,
  // Common injection delimiters
  /```\s*(system|instruction|hidden)/gi,
  /\[\[(system|instruction|hidden)\]\]/gi,
  /<(system|instruction|hidden)>/gi,
  // Direct instruction patterns
  /ignore\s+(all\s+)?(previous|above)\s+(instructions?|prompts?)/gi,
  /disregard\s+(all\s+)?(previous|above)\s+(instructions?|prompts?)/gi,
  /forget\s+(all\s+)?(previous|above)\s+(instructions?|prompts?)/gi,
  // Role-play manipulation
  /you\s+are\s+now\s+(a|an)\s+[^\s]+(jailbreak|unrestricted|uncensored)/gi,
  /pretend\s+(to\s+be|you'?re)\s+(a|an)\s+[^\s]+(jailbreak|unrestricted)/gi,
  // Token manipulation (GPT-specific but good to catch)
  /\[?INST\]?/gi,
  /\[\/INST\]/gi,
  /<\|im_(start|end)\|>/gi,
  // JSON/data structure injection
  /"\s*role\s*"\s*:\s*"\s*(system|assistant)\s*"/gi,
]

/**
 * Characters/strings that should be escaped in prompts
 */
const ESCAPE_MAP: Record<string, string> = {
  '```': '` ` `',
  '[[': '[ [',
  ']]': '] ]',
  '{{': '{ {',
  '}}': '} }',
  '<|': '< |',
  '|>': '| >',
}

/**
 * Check if input contains potential prompt injection patterns
 * Returns the matched pattern if found, null otherwise
 */
export function containsInjectionPattern(input: string): RegExp | null {
  for (const pattern of INJECTION_PATTERNS) {
    // Reset regex state (some have global flag)
    pattern.lastIndex = 0
    if (pattern.test(input)) {
      return pattern
    }
  }
  return null
}

/**
 * Error thrown when prompt injection is detected and rejection mode is enabled
 */
export class PromptInjectionError extends Error {
  constructor(
    message: string,
    public readonly inputPreview: string,
  ) {
    super(message)
    this.name = 'PromptInjectionError'
  }
}

/**
 * Escape potentially dangerous delimiter sequences
 */
function escapeDelimiters(input: string): string {
  let result = input
  for (const [pattern, replacement] of Object.entries(ESCAPE_MAP)) {
    result = result.replaceAll(pattern, replacement)
  }
  return result
}

/**
 * Remove ANSI escape codes and control characters
 */
function stripControlChars(input: string): string {
  // Remove ANSI escape codes
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional for security
  const stripped = input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  // Remove other control characters except newlines and tabs
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional for security
  return stripped.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * Truncate input to maximum length with ellipsis
 */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input
  return `${input.slice(0, maxLength - 3)}...`
}

/** Options for sanitizeForPrompt */
export interface SanitizeOptions {
  /** Maximum allowed length (default: INPUT_LIMITS.DESCRIPTION) */
  maxLength?: number
  /** Reject input if injection pattern detected (default: true in production) */
  rejectOnInjection?: boolean
  /** Log warning if injection detected (default: true) */
  warnOnInjection?: boolean
  /** Field name for error messages */
  fieldName?: string
}

/**
 * Sanitize user input before embedding in AI prompts
 *
 * This function:
 * 1. Strips control characters
 * 2. Detects and REJECTS inputs with injection patterns (security-first)
 * 3. Escapes dangerous delimiters
 * 4. Truncates to maximum length
 *
 * @param input - The user-provided input string
 * @param options - Sanitization options
 * @returns Sanitized string safe for prompt embedding
 * @throws PromptInjectionError if injection detected and rejectOnInjection is true
 */
export function sanitizeForPrompt(
  input: string,
  options: SanitizeOptions | number = {},
): string {
  // Handle legacy signature where second arg was maxLength
  const opts: SanitizeOptions =
    typeof options === 'number' ? { maxLength: options } : options

  const {
    maxLength = INPUT_LIMITS.DESCRIPTION,
    rejectOnInjection = getCurrentNetwork() !== 'localnet', // Reject by default in production
    warnOnInjection = true,
    fieldName = 'input',
  } = opts

  if (!input || typeof input !== 'string') {
    return ''
  }

  // Step 1: Strip control characters
  let sanitized = stripControlChars(input)

  // Step 2: Check for injection patterns
  const injectionPattern = containsInjectionPattern(sanitized)
  if (injectionPattern) {
    const preview = sanitized.slice(0, 100)

    if (warnOnInjection) {
      console.warn(
        `[Security] Prompt injection detected in ${fieldName}:`,
        preview,
      )
    }

    if (rejectOnInjection) {
      throw new PromptInjectionError(
        `Potential prompt injection detected in ${fieldName}. ` +
          'Input contains patterns that could manipulate AI behavior.',
        preview,
      )
    }
  }

  // Step 3: Escape dangerous delimiters
  sanitized = escapeDelimiters(sanitized)

  // Step 4: Truncate to max length
  sanitized = truncate(sanitized, maxLength)

  return sanitized
}

/**
 * Sanitize an array of strings for prompt embedding
 * @throws PromptInjectionError if any item contains injection patterns
 */
export function sanitizeArrayForPrompt(
  items: string[],
  maxItems: number = INPUT_LIMITS.ARRAY_ITEMS,
  maxItemLength: number = INPUT_LIMITS.ARRAY_ITEM,
  options: Omit<SanitizeOptions, 'maxLength'> = {},
): string[] {
  if (!Array.isArray(items)) return []

  return items
    .slice(0, maxItems)
    .map((item, index) =>
      sanitizeForPrompt(item, {
        maxLength: maxItemLength,
        fieldName: `${options.fieldName ?? 'item'}[${index}]`,
        ...options,
      }),
    )
    .filter((item) => item.length > 0)
}

/**
 * Wrap user content in clear delimiters for safer prompt construction
 *
 * This wraps the content in clearly marked boundaries so the AI model
 * can better distinguish between instructions and user content
 * @throws PromptInjectionError if injection detected
 */
export function wrapUserContent(
  content: string,
  label: string,
  options: Omit<SanitizeOptions, 'fieldName'> = {},
): string {
  const sanitized = sanitizeForPrompt(content, { ...options, fieldName: label })
  return `<user_provided_${label}>\n${sanitized}\n</user_provided_${label}>`
}

/**
 * Build a safe prompt with user content clearly separated
 */
export function buildSafePrompt(
  systemInstructions: string,
  userContent: Record<string, string>,
): { system: string; user: string } {
  // Build the user portion with wrapped content
  const userParts = Object.entries(userContent)
    .map(([label, content]) => wrapUserContent(content, label))
    .join('\n\n')

  return {
    system: systemInstructions,
    user: userParts,
  }
}

/**
 * Validate input length and throw if exceeded
 */
export function validateInputLength(
  input: string,
  maxLength: number,
  fieldName: string,
): void {
  if (input.length > maxLength) {
    throw new Error(
      `${fieldName} exceeds maximum length of ${maxLength} characters`,
    )
  }
}

/**
 * Validate and sanitize a complete input object
 * @throws PromptInjectionError if any field contains injection patterns
 */
export function validateAndSanitizeInput<
  T extends Record<string, string | string[] | undefined>,
>(
  input: T,
  limits: Partial<Record<keyof T, number>>,
  options: Omit<SanitizeOptions, 'maxLength' | 'fieldName'> = {},
): T {
  const result = { ...input }

  for (const [key, limit] of Object.entries(limits) as [keyof T, number][]) {
    const value = result[key]
    if (typeof value === 'string') {
      validateInputLength(value, limit, String(key))
      result[key] = sanitizeForPrompt(value, {
        maxLength: limit,
        fieldName: String(key),
        ...options,
      }) as T[keyof T]
    } else if (Array.isArray(value)) {
      result[key] = sanitizeArrayForPrompt(
        value,
        INPUT_LIMITS.ARRAY_ITEMS,
        limit,
        { fieldName: String(key), ...options },
      ) as T[keyof T]
    }
  }

  return result
}
