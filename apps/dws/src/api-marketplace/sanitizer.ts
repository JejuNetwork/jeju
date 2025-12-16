/**
 * Response Sanitizer
 *
 * Scrubs API keys, tokens, and sensitive data from responses
 * to prevent credential leakage.
 */

import type { SanitizationConfig } from './types';

// ============================================================================
// Default Patterns
// ============================================================================

/**
 * Common patterns that might contain API keys
 */
export const DEFAULT_KEY_PATTERNS: RegExp[] = [
  // OpenAI-style keys
  /sk-[a-zA-Z0-9]{20,}/g,
  /sk-proj-[a-zA-Z0-9_-]{20,}/g,
  /sk-or-v1-[a-zA-Z0-9]{20,}/g,

  // Anthropic keys
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,

  // Generic hex keys (32+ chars)
  /[a-f0-9]{32,}/gi,

  // Bearer tokens in text
  /bearer\s+[a-zA-Z0-9._-]{20,}/gi,

  // API key patterns in URLs/text
  /api[_-]?key[=:]["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  /apikey[=:]["']?[a-zA-Z0-9_-]{16,}["']?/gi,

  // Authorization headers leaked in responses
  /authorization[=:]\s*["']?(?:bearer|key|token)\s+[a-zA-Z0-9._-]+["']?/gi,

  // Common provider-specific patterns
  /AIza[a-zA-Z0-9_-]{35}/g, // Google
  /xai-[a-zA-Z0-9]{20,}/g, // xAI
  /tvly-[a-zA-Z0-9]{20,}/g, // Tavily
  /fc-[a-zA-Z0-9]{20,}/g, // Firecrawl
  /CG-[a-zA-Z0-9]{20,}/g, // CoinGecko

  // Generic token patterns
  /access[_-]?token[=:]["']?[a-zA-Z0-9._-]{20,}["']?/gi,
  /refresh[_-]?token[=:]["']?[a-zA-Z0-9._-]{20,}["']?/gi,
  /session[_-]?token[=:]["']?[a-zA-Z0-9._-]{20,}["']?/gi,
];

/**
 * Headers to strip from proxied responses
 */
export const STRIP_HEADERS: string[] = [
  'authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-session-token',
  'set-cookie',
  'cookie',
  'x-request-id', // Provider-specific, might leak info
  'x-ratelimit-remaining', // Hide rate limit info
  'x-ratelimit-limit',
  'x-ratelimit-reset',
];

/**
 * JSON paths that commonly contain sensitive data
 */
export const REDACT_PATHS: string[] = [
  'api_key',
  'apiKey',
  'api-key',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'session_token',
  'sessionToken',
  'secret',
  'password',
  'credentials',
  'authorization',
  'bearer',
];

// ============================================================================
// Sanitization Functions
// ============================================================================

/**
 * Create a sanitization config
 */
export function createSanitizationConfig(
  knownKeys: string[] = [],
  additionalPatterns: RegExp[] = []
): SanitizationConfig {
  return {
    patterns: [...DEFAULT_KEY_PATTERNS, ...additionalPatterns],
    knownKeys,
    stripHeaders: STRIP_HEADERS,
    redactPaths: REDACT_PATHS,
  };
}

/**
 * Sanitize a string by replacing sensitive patterns
 */
export function sanitizeString(
  input: string,
  config: SanitizationConfig
): string {
  let result = input;

  // Replace known keys first (exact match)
  for (const key of config.knownKeys) {
    if (key.length > 8) {
      // Only redact if key is long enough to be meaningful
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), '[REDACTED]');
    }
  }

  // Replace pattern matches
  for (const pattern of config.patterns) {
    // Reset regex lastIndex to ensure fresh match
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }

  return result;
}

/**
 * Sanitize a JSON object recursively
 */
export function sanitizeObject(
  obj: unknown,
  config: SanitizationConfig
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj, config);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, config));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if this key should be fully redacted
      const lowerKey = key.toLowerCase();
      if (config.redactPaths.some((path) => lowerKey.includes(path.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizeObject(value, config);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Sanitize response headers
 */
export function sanitizeHeaders(
  headers: Record<string, string>,
  config: SanitizationConfig
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    // Skip headers that should be stripped
    if (config.stripHeaders.some((h) => lowerKey === h.toLowerCase())) {
      continue;
    }

    // Sanitize header value
    result[key] = sanitizeString(value, config);
  }

  return result;
}

/**
 * Full response sanitization
 */
export function sanitizeResponse(
  body: unknown,
  headers: Record<string, string>,
  config: SanitizationConfig
): { body: unknown; headers: Record<string, string> } {
  return {
    body: sanitizeObject(body, config),
    headers: sanitizeHeaders(headers, config),
  };
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Check if a string might contain an API key
 */
export function mightContainKey(input: string): boolean {
  for (const pattern of DEFAULT_KEY_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(input)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract potential keys from a string (for logging/alerting)
 */
export function extractPotentialKeys(input: string): string[] {
  const keys: string[] = [];

  for (const pattern of DEFAULT_KEY_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = input.match(pattern);
    if (matches) {
      keys.push(...matches);
    }
  }

  // Dedupe and limit
  return [...new Set(keys)].slice(0, 10);
}

/**
 * Create alert if potential key leak detected
 */
export function checkForLeaks(
  response: unknown,
  knownKeys: string[]
): { leaked: boolean; details: string[] } {
  const details: string[] = [];

  const responseStr = typeof response === 'string' ? response : JSON.stringify(response);

  // Check for known keys
  for (const key of knownKeys) {
    if (key.length > 8 && responseStr.includes(key)) {
      details.push(`Known key detected (${key.substring(0, 8)}...)`);
    }
  }

  // Check for pattern matches
  const potentialKeys = extractPotentialKeys(responseStr);
  if (potentialKeys.length > 0) {
    details.push(`Potential key patterns: ${potentialKeys.length} found`);
  }

  return {
    leaked: details.length > 0,
    details,
  };
}
