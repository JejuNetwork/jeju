/**
 * Proxy Router
 *
 * Core proxy logic that:
 * 1. Validates access and payment
 * 2. Decrypts keys in TEE context
 * 3. Injects auth into requests
 * 4. Sanitizes responses
 */

import { isJsonValue, type JsonValue } from '@jejunetwork/types'
import type { Address } from 'viem'
import type { JSONObject } from '../shared/validation'
import { checkAccess, incrementRateLimit } from './access-control'
import { decryptKeyForRequest } from './key-vault'
import {
  canAfford,
  chargeUser,
  getListing,
  getProviderById,
  recordRequest,
} from './registry'
import {
  checkForLeaks,
  createSanitizationConfig,
  sanitizeResponse,
} from './sanitizer'
import type { APIProvider, ProxyRequest, ProxyResponse } from './types'

// Auth Injection

/**
 * Inject authentication into the request based on provider config
 */
function injectAuth(
  provider: APIProvider,
  apiKey: string,
  url: URL,
  headers: Record<string, string>,
): { url: URL; headers: Record<string, string> } {
  const resultHeaders = { ...headers }

  switch (provider.authType) {
    case 'bearer':
      resultHeaders[provider.authConfig.headerName ?? 'Authorization'] =
        `${provider.authConfig.prefix ?? 'Bearer '}${apiKey}`
      break

    case 'header':
      resultHeaders[provider.authConfig.headerName ?? 'X-API-Key'] =
        `${provider.authConfig.prefix ?? ''}${apiKey}`
      break

    case 'query':
      url.searchParams.set(provider.authConfig.queryParam ?? 'api_key', apiKey)
      break

    case 'basic': {
      const encoded = Buffer.from(apiKey).toString('base64')
      resultHeaders.Authorization = `Basic ${encoded}`
      break
    }
  }

  // Add Anthropic-specific headers
  if (provider.id === 'anthropic') {
    resultHeaders['anthropic-version'] = '2023-06-01'
  }

  return { url, headers: resultHeaders }
}

/**
 * Strip auth-related headers from incoming request
 */
function stripAuthHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  const authHeaders = [
    'authorization',
    'x-api-key',
    'api-key',
    'x-auth-token',
    'x-access-token',
  ]

  for (const [key, value] of Object.entries(headers)) {
    if (!authHeaders.includes(key.toLowerCase())) {
      result[key] = value
    }
  }

  return result
}

// Request Building

/**
 * Build the upstream URL
 */
function buildUpstreamUrl(
  provider: APIProvider,
  endpoint: string,
  queryParams?: Record<string, string>,
): URL {
  // Handle endpoints that might have query params already
  const [pathPart, existingQuery] = endpoint.split('?')

  const url = new URL(pathPart, provider.baseUrl)

  // Add existing query params from endpoint
  if (existingQuery) {
    const params = new URLSearchParams(existingQuery)
    for (const [key, value] of params) {
      url.searchParams.set(key, value)
    }
  }

  // Add provided query params
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value)
    }
  }

  return url
}

/**
 * Build request body
 */
function buildRequestBody(
  body: string | JSONObject | undefined,
): string | undefined {
  if (!body) return undefined
  if (typeof body === 'string') return body
  return JSON.stringify(body)
}

// Proxy Execution

export interface ProxyOptions {
  /** User's wallet address */
  userAddress: Address
  /** Origin domain for CORS checking */
  originDomain?: string
  /** Timeout in ms */
  timeout?: number
}

/**
 * Execute a proxied API request
 */
export async function proxyRequest(
  request: ProxyRequest,
  options: ProxyOptions,
): Promise<ProxyResponse> {
  const requestId = crypto.randomUUID()
  const startTime = Date.now()

  // 1. Get listing
  const listing = await getListing(request.listingId)
  if (!listing) {
    return createErrorResponse(404, 'Listing not found', requestId, startTime)
  }

  // 2. Get provider
  const provider = getProviderById(listing.providerId)
  if (!provider) {
    return createErrorResponse(
      500,
      'Provider configuration error',
      requestId,
      startTime,
    )
  }

  // 3. Check access control
  const accessCheck = checkAccess(
    options.userAddress,
    listing,
    request.endpoint,
    request.method,
    options.originDomain,
  )
  if (!accessCheck.allowed) {
    return createErrorResponse(
      accessCheck.retryAfter ? 429 : 403,
      accessCheck.reason ?? 'Access denied',
      requestId,
      startTime,
      accessCheck.retryAfter,
    )
  }

  // 4. Check payment
  if (!(await canAfford(options.userAddress, listing.pricePerRequest))) {
    return createErrorResponse(
      402,
      `Insufficient balance. Required: ${listing.pricePerRequest} wei`,
      requestId,
      startTime,
    )
  }

  // 5. Decrypt API key (in TEE context)
  const apiKey = await decryptKeyForRequest({
    keyId: listing.keyVaultId,
    requester: options.userAddress,
    requestContext: {
      listingId: listing.id,
      endpoint: request.endpoint,
      requestId,
    },
  })

  if (!apiKey) {
    return createErrorResponse(500, 'Key vault error', requestId, startTime)
  }

  // 6. Build upstream request
  let url = buildUpstreamUrl(provider, request.endpoint, request.queryParams)
  let headers = stripAuthHeaders(request.headers ?? {})

  // Set content type for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(request.method) && request.body) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }

  // 7. Inject authentication
  const authed = injectAuth(provider, apiKey, url, headers)
  url = authed.url
  headers = authed.headers

  // 8. Execute request
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout ?? 30000,
  )

  try {
    const response = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: buildRequestBody(request.body),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // 9. Parse response
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    let responseBody: JsonValue | string
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const parsed: unknown = await response.json()
      // Validate the parsed JSON is a valid JsonValue
      if (isJsonValue(parsed)) {
        responseBody = parsed
      } else {
        responseBody = JSON.stringify(parsed)
      }
    } else {
      responseBody = await response.text()
    }

    // 10. Check for credential leaks (before sanitization)
    const leakCheck = checkForLeaks(responseBody, [apiKey])
    if (leakCheck.leaked) {
      console.warn(
        `[Proxy] Potential credential leak detected in response: ${leakCheck.details.join(', ')}`,
      )
    }

    // 11. Sanitize response
    const sanitizationConfig = createSanitizationConfig([apiKey])
    const sanitized = sanitizeResponse(
      responseBody,
      responseHeaders,
      sanitizationConfig,
    )

    // 12. Charge user and record request
    const charged = await chargeUser(
      options.userAddress,
      listing.pricePerRequest,
    )
    if (!charged) {
      // Shouldn't happen since we checked earlier, but handle gracefully
      console.error('[Proxy] Failed to charge user after request')
    }

    await recordRequest(listing.id, listing.pricePerRequest)
    incrementRateLimit(options.userAddress, listing.id)

    return {
      status: response.status,
      headers: sanitized.headers,
      body: sanitized.body,
      cost: listing.pricePerRequest,
      latencyMs: Date.now() - startTime,
      requestId,
    }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      return createErrorResponse(504, 'Request timeout', requestId, startTime)
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Proxy] Request failed: ${message}`)
    return createErrorResponse(
      502,
      `Upstream error: ${message}`,
      requestId,
      startTime,
    )
  }
}

/**
 * Create an error response
 */
function createErrorResponse(
  status: number,
  message: string,
  requestId: string,
  startTime: number,
  retryAfter?: number,
): ProxyResponse {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (retryAfter) {
    headers['Retry-After'] = retryAfter.toString()
  }

  return {
    status,
    headers,
    body: { error: message, requestId },
    cost: 0n,
    latencyMs: Date.now() - startTime,
    requestId,
  }
}

// Health Check

/**
 * Check if an upstream provider is healthy
 */
export async function checkProviderHealth(providerId: string): Promise<{
  healthy: boolean
  latencyMs: number
  error?: string
}> {
  const provider = getProviderById(providerId)
  if (!provider) {
    return { healthy: false, latencyMs: 0, error: 'Unknown provider' }
  }

  const startTime = Date.now()

  try {
    // Simple connectivity check - just try to connect
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(provider.baseUrl, {
      method: 'HEAD',
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // Any response (even 401/403) means the service is reachable
    return {
      healthy: response.status < 500,
      latencyMs: Date.now() - startTime,
    }
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

// Streaming Support

/**
 * Proxy a streaming request (for SSE/streaming APIs)
 */
export async function* proxyStreamingRequest(
  request: ProxyRequest,
  options: ProxyOptions,
): AsyncGenerator<{ chunk: string; done: boolean }> {
  const requestId = crypto.randomUUID()

  // Same validation as regular proxy...
  const listing = await getListing(request.listingId)
  if (!listing) {
    yield { chunk: JSON.stringify({ error: 'Listing not found' }), done: true }
    return
  }

  const provider = getProviderById(listing.providerId)
  if (!provider) {
    yield { chunk: JSON.stringify({ error: 'Provider error' }), done: true }
    return
  }

  if (!provider.supportsStreaming) {
    yield {
      chunk: JSON.stringify({ error: 'Provider does not support streaming' }),
      done: true,
    }
    return
  }

  const accessCheck = checkAccess(
    options.userAddress,
    listing,
    request.endpoint,
    request.method,
  )
  if (!accessCheck.allowed) {
    yield { chunk: JSON.stringify({ error: accessCheck.reason }), done: true }
    return
  }

  if (!(await canAfford(options.userAddress, listing.pricePerRequest))) {
    yield {
      chunk: JSON.stringify({ error: 'Insufficient balance' }),
      done: true,
    }
    return
  }

  const apiKey = await decryptKeyForRequest({
    keyId: listing.keyVaultId,
    requester: options.userAddress,
    requestContext: {
      listingId: listing.id,
      endpoint: request.endpoint,
      requestId,
    },
  })

  if (!apiKey) {
    yield { chunk: JSON.stringify({ error: 'Key vault error' }), done: true }
    return
  }

  // Build and execute streaming request
  let url = buildUpstreamUrl(provider, request.endpoint, request.queryParams)
  let headers = stripAuthHeaders(request.headers ?? {})
  headers['Content-Type'] = 'application/json'
  headers.Accept = 'text/event-stream'

  const authed = injectAuth(provider, apiKey, url, headers)
  url = authed.url
  headers = authed.headers

  const sanitizationConfig = createSanitizationConfig([apiKey])

  try {
    const response = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: buildRequestBody(request.body),
    })

    if (!response.ok || !response.body) {
      yield {
        chunk: JSON.stringify({ error: `Upstream error: ${response.status}` }),
        done: true,
      }
      return
    }

    // Charge after successful connection
    await chargeUser(options.userAddress, listing.pricePerRequest)
    await recordRequest(listing.id, listing.pricePerRequest)
    incrementRateLimit(options.userAddress, listing.id)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })

      // Sanitize each chunk
      const sanitized = sanitizationConfig.knownKeys.reduce(
        (acc, key) => acc.replace(new RegExp(key, 'g'), '[REDACTED]'),
        text,
      )

      yield { chunk: sanitized, done: false }
    }

    yield { chunk: '', done: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stream error'
    yield { chunk: JSON.stringify({ error: message }), done: true }
  }
}
