/**
 * API Client Utilities
 *
 * Shared helpers for API requests in frontend hooks.
 */

import { FACTORY_API_URL } from '../config/env'

export const API_BASE = FACTORY_API_URL

type SignMessageFn = (args: { message: string }) => Promise<string>

/** Build headers with optional wallet address authentication */
export function getHeaders(address?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (address) {
    headers['x-wallet-address'] = address
    headers.authorization = `Bearer ${address}`
  }
  return headers
}

function generateNonce(bytes: number = 16): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function buildAuthMessage(timestamp: number, nonce: string): string {
  return `Factory Auth\nTimestamp: ${timestamp}\nNonce: ${nonce}`
}

export async function getSignedHeaders(
  address: string,
  signMessageAsync: SignMessageFn,
): Promise<Record<string, string>> {
  const nonce = generateNonce()
  const timestamp = Date.now()
  const message = buildAuthMessage(timestamp, nonce)
  const signature = await signMessageAsync({ message })

  return {
    'x-jeju-address': address,
    'x-jeju-timestamp': String(timestamp),
    'x-jeju-nonce': nonce,
    'x-jeju-signature': signature,
  }
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

/** POST request helper with signed auth headers */
export async function apiPostSigned<T>(
  path: string,
  body: unknown,
  address: string | undefined,
  signMessageAsync: SignMessageFn,
): Promise<T> {
  if (!address) {
    throw new Error('Wallet address required')
  }
  const signedHeaders = await getSignedHeaders(address, signMessageAsync)
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...signedHeaders,
    },
    body: JSON.stringify(body),
  })

  return response.json()
}

/** DELETE request helper with signed auth headers */
export async function apiDeleteSigned<T>(
  path: string,
  body: unknown | undefined,
  address: string | undefined,
  signMessageAsync: SignMessageFn,
): Promise<T> {
  if (!address) {
    throw new Error('Wallet address required')
  }
  const signedHeaders = await getSignedHeaders(address, signMessageAsync)
  const headers: Record<string, string> = { ...signedHeaders }
  const options: RequestInit = {
    method: 'DELETE',
    headers,
  }

  if (body) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE}${path}`, options)
  return response.json()
}
