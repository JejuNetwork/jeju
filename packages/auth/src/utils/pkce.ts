/**
 * PKCE Utilities
 *
 * Proof Key for Code Exchange (RFC 7636) implementation.
 * Used for secure OAuth without a client secret.
 */

import { z } from 'zod'

/**
 * PKCE parameters for OAuth flows
 */
export interface PKCEParams {
  codeVerifier: string
  codeChallenge: string
  state: string
  nonce: string
}

/**
 * PKCE parameters Zod schema
 */
export const PKCEParamsSchema = z.object({
  codeVerifier: z.string().min(43).max(128),
  codeChallenge: z.string().min(1),
  state: z.string().min(16),
  nonce: z.string().min(1),
})

/**
 * Generate a cryptographically secure random string
 */
function generateRandomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  // Use URL-safe base64
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
    .slice(0, length)
}

/**
 * Generate code verifier (43-128 characters)
 */
export function generateCodeVerifier(): string {
  return generateRandomString(64)
}

/**
 * Generate code challenge from verifier using S256 method
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hash)

  // Base64url encode
  return btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Generate state parameter
 */
export function generateState(): string {
  return generateRandomString(32)
}

/**
 * Generate nonce
 */
export function generateNonce(): string {
  return generateRandomString(16)
}

/**
 * Generate complete PKCE parameters
 */
export async function generatePKCE(): Promise<PKCEParams> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateState()
  const nonce = generateNonce()

  return {
    codeVerifier,
    codeChallenge,
    state,
    nonce,
  }
}

/**
 * Store PKCE params (client-side only)
 */
export function storePKCEParams(params: PKCEParams, key = 'jeju_pkce'): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(key, JSON.stringify(params))
  }
}

/**
 * Retrieve stored PKCE params
 */
export function retrievePKCEParams(key = 'jeju_pkce'): PKCEParams | null {
  if (typeof sessionStorage === 'undefined') {
    return null
  }

  const stored = sessionStorage.getItem(key)
  if (!stored) {
    return null
  }

  sessionStorage.removeItem(key)
  const parseResult = PKCEParamsSchema.safeParse(JSON.parse(stored))
  if (!parseResult.success) {
    return null
  }
  return parseResult.data
}

/**
 * Validate state parameter
 */
export function validatePKCEState(received: string, expected: string): boolean {
  return received === expected
}

/**
 * Generate and store PKCE params
 */
export async function generateAndStorePKCE(
  key = 'jeju_pkce',
): Promise<PKCEParams> {
  const params = await generatePKCE()
  storePKCEParams(params, key)
  return params
}

/**
 * @deprecated Use individual functions instead: storePKCEParams, retrievePKCEParams, validatePKCEState, generateAndStorePKCE
 */
export const PKCEUtils = {
  store: storePKCEParams,
  retrieve: retrievePKCEParams,
  validateState: validatePKCEState,
  generateAndStore: generateAndStorePKCE,
}
