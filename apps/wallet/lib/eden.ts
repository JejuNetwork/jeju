/**
 * Eden Treaty Clients for Jeju Backend Services
 *
 * Provides fully typed API calls with end-to-end type safety
 * from Elysia routes to client code.
 */

import { treaty } from '@elysiajs/eden'
import type { z } from 'zod'
import { getEnv } from './env'

/** JSON-RPC response structure */
interface JsonRpcResponse<T> {
  result?: T
  error?: { code: number; message: string }
}

// Dynamic import types from backend services
// In production, these would be imported from the actual server type exports
// For now, we define the base URL configuration

const isLocalDev =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'

export const API_URLS = {
  gateway:
    getEnv('VITE_JEJU_GATEWAY_URL') ||
    (isLocalDev ? 'http://localhost:4001' : 'https://gateway.jejunetwork.org'),
  dws:
    getEnv('VITE_JEJU_DWS_URL') ||
    (isLocalDev ? 'http://localhost:4010' : 'https://dws.jejunetwork.org'),
  indexer:
    getEnv('VITE_JEJU_INDEXER_URL') ||
    (isLocalDev ? 'http://localhost:4352' : 'https://indexer.jejunetwork.org'),
  graphql:
    getEnv('VITE_JEJU_GRAPHQL_URL') ||
    (isLocalDev
      ? 'http://localhost:4350/graphql'
      : 'https://indexer.jejunetwork.org/graphql'),
  bundler:
    getEnv('VITE_JEJU_BUNDLER_URL') ||
    (isLocalDev ? 'http://localhost:4337' : 'https://bundler.jejunetwork.org'),
  solver:
    getEnv('VITE_JEJU_SOLVER_URL') ||
    (isLocalDev
      ? 'http://localhost:4010/solver'
      : 'https://solver.jejunetwork.org'),
  compute:
    getEnv('VITE_JEJU_COMPUTE_URL') ||
    (isLocalDev ? 'http://localhost:4100' : 'https://compute.jejunetwork.org'),
  rpc:
    getEnv('VITE_JEJU_RPC_URL') ||
    (isLocalDev ? 'http://localhost:4012' : 'https://rpc.jejunetwork.org'),
}

export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public errors: z.ZodError,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Response type from Eden Treaty calls
 */
export interface EdenResponse<T> {
  data: T | null
  error: {
    status: number
    message: string
    value: unknown
  } | null
}

/**
 * Extract data from Eden response, throwing on error
 *
 * @throws Error if response contains an error or no data
 */
// Type guard for error objects with message property
function isErrorWithMessage(
  err: unknown,
): err is { message: string; value?: unknown; status?: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  )
}

export function extractData<T>(response: {
  data: T | null
  error: unknown
}): T {
  if (response.error) {
    const err = response.error
    if (isErrorWithMessage(err)) {
      throw new APIError(err.message, err.status || 500)
    }
    // Fallback for unknown error shapes
    const errorValue =
      typeof err === 'object' && err !== null && 'value' in err
        ? (err as { value: unknown }).value
        : err
    throw new APIError(
      typeof errorValue === 'string' ? errorValue : 'API Error',
      500,
    )
  }
  if (response.data === null) {
    throw new Error('No data returned from API')
  }
  return response.data
}

/**
 * Safely extract data from Eden response, returning null on error
 */
export function extractDataSafe<T>(response: {
  data: T | null
  error: unknown
}): T | null {
  if (response.error || response.data === null) {
    return null
  }
  return response.data
}

interface FetchOptions extends Omit<RequestInit, 'body'> {
  address?: string
  body?: string
}

/**
 * Type-safe fetch helper with optional schema validation
 */
// Type guard for HeadersInit that can be spread
function isRecordHeaders(
  headers: HeadersInit | undefined,
): headers is Record<string, string> {
  return (
    headers !== undefined &&
    typeof headers === 'object' &&
    !(headers instanceof Headers)
  )
}

export async function fetchApi<T>(
  baseUrl: string,
  endpoint: string,
  options?: FetchOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(isRecordHeaders(options?.headers) ? options.headers : {}),
  }

  if (options?.address) {
    headers['X-Jeju-Address'] = options.address
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new APIError(
      error.error || error.message || 'API request failed',
      response.status,
      error.code,
    )
  }

  return response.json() as Promise<T>
}

/**
 * Helper for POST requests
 */
export async function postApi<T>(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
  options?: Omit<FetchOptions, 'body' | 'method'>,
): Promise<T> {
  return fetchApi<T>(baseUrl, endpoint, {
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Helper for JSON-RPC requests (bundler, RPC, etc.)
 */
export async function jsonRpcRequest<T>(
  baseUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  })

  if (!response.ok) {
    throw new APIError(
      `RPC request failed: ${response.statusText}`,
      response.status,
    )
  }

  const data = (await response.json()) as JsonRpcResponse<T>

  if (data.error) {
    throw new APIError(data.error.message, data.error.code)
  }

  return data.result as T
}

// Note: These use the treaty function but without the actual App types imported
// In a full setup, you would import the App types from the backend packages.
// For now, we create untyped clients that still benefit from Eden's error handling

/**
 * Create an Eden Treaty client for any Elysia backend
 */
export function createEdenClient(baseUrl: string) {
  return treaty(baseUrl)
}

/**
 * Gateway client - A2A, solver, OIF, etc.
 */
export const gatewayClient = createEdenClient(API_URLS.gateway)

/**
 * DWS client - storage, compute, CDN, etc.
 */
export const dwsClient = createEdenClient(API_URLS.dws)

/**
 * Indexer client - blocks, transactions, accounts, etc.
 */
export const indexerClient = createEdenClient(API_URLS.indexer)

/**
 * Compute client - inference, models, etc.
 */
export const computeClient = createEdenClient(API_URLS.compute)

export { API_URLS as urls }
