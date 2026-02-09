/**
 * API Client Utilities
 *
 * Shared helpers for API requests in frontend hooks.
 */

import { FACTORY_API_URL } from '../config/env'

export const API_BASE = FACTORY_API_URL

type SignMessageAsync = (args: { message: string }) => Promise<string>

const SIGNED_READ_TTL_MS = 4 * 60 * 1000
let cachedReadAuth:
  | {
      address: string
      expiresAt: number
      headers: Record<string, string>
    }
  | null = null

function buildAuthMessage(timestamp: number, nonce: string): string {
  return `Factory Auth\nTimestamp: ${timestamp}\nNonce: ${nonce}`
}

async function getSignedHeaders(
  address: string,
  signMessageAsync: SignMessageAsync,
  options?: { cache?: boolean },
): Promise<Record<string, string>> {
  if (
    options?.cache &&
    cachedReadAuth &&
    cachedReadAuth.address === address &&
    cachedReadAuth.expiresAt > Date.now()
  ) {
    return { ...cachedReadAuth.headers }
  }

  const timestamp = Date.now()
  const nonce = crypto.randomUUID()
  const message = buildAuthMessage(timestamp, nonce)
  const signature = await signMessageAsync({ message })

  const headers = {
    'x-jeju-address': address,
    'x-jeju-timestamp': String(timestamp),
    'x-jeju-nonce': nonce,
    'x-jeju-signature': signature,
    'x-wallet-address': address,
    authorization: `Bearer ${address}`,
  }

  if (options?.cache) {
    cachedReadAuth = {
      address,
      expiresAt: Date.now() + SIGNED_READ_TTL_MS,
      headers,
    }
  }

  return headers
}

/** Build headers with optional wallet address authentication */
export function getHeaders(address?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (address) {
    headers['x-wallet-address'] = address
    headers.authorization = `Bearer ${address}`
  }
  return headers
}

/** Typed fetch wrapper that handles JSON responses */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { address?: string },
): Promise<T> {
  const { address, ...fetchOptions } = options ?? {}
  const headers = {
    ...getHeaders(address),
    ...fetchOptions.headers,
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  })

  return response.json()
}

/** Signed fetch wrapper with wallet signature authentication */
export async function apiFetchSigned<T>(
  path: string,
  options: RequestInit & {
    address: string
    signMessageAsync: SignMessageAsync
    cache?: boolean
  },
): Promise<T> {
  const { address, signMessageAsync, cache, ...fetchOptions } = options
  const signedHeaders = await getSignedHeaders(address, signMessageAsync, {
    cache,
  })
  const headers = {
    ...signedHeaders,
    ...(fetchOptions.headers as Record<string, string> | undefined),
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  })

  return response.json()
}

/** POST request helper */
export async function apiPost<T>(
  path: string,
  body: unknown,
  address?: string,
): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    address,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Signed POST request helper */
export async function apiPostSigned<T>(
  path: string,
  body: unknown,
  address: string,
  signMessageAsync: SignMessageAsync,
  options?: { cache?: boolean },
): Promise<T> {
  return apiFetchSigned<T>(path, {
    method: 'POST',
    address,
    signMessageAsync,
    cache: options?.cache,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** DELETE request helper */
export async function apiDelete<T>(
  path: string,
  body?: unknown,
  address?: string,
): Promise<T> {
  const options: RequestInit & { address?: string } = {
    method: 'DELETE',
    address,
  }
  if (body) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  return apiFetch<T>(path, options)
}

/** Signed DELETE request helper */
export async function apiDeleteSigned<T>(
  path: string,
  body: unknown | undefined,
  address: string,
  signMessageAsync: SignMessageAsync,
  options?: { cache?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {}
  if (body) {
    headers['Content-Type'] = 'application/json'
  }
  return apiFetchSigned<T>(path, {
    method: 'DELETE',
    address,
    signMessageAsync,
    cache: options?.cache,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}
