/**
 * Eden Client for DWS API
 * Provides type-safe API calls with Zod validation
 */

import type { z } from 'zod'
import { DWS_API_URL } from '../config'

// Export base URL for API calls
export const API_URL = DWS_API_URL

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

interface FetchOptions extends Omit<RequestInit, 'body'> {
  address?: string
  body?: string
}

/**
 * Type-safe fetch helper with Zod validation
 */
export async function fetchApi<T>(
  endpoint: string,
  options?: FetchOptions,
  schema?: z.ZodType<T>,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }

  if (options?.address) {
    headers['X-Jeju-Address'] = options.address
  }

  const response = await fetch(`${DWS_API_URL}${endpoint}`, {
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

  const data = await response.json()

  if (schema) {
    const result = schema.safeParse(data)
    if (!result.success) {
      console.warn('[API] Validation warning:', result.error.format())
      // Return data anyway - validation is informational
      return data as T
    }
    return result.data
  }

  return data as T
}

/**
 * Validated fetch helper - throws on validation failure
 */
export async function fetchValidated<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  options?: FetchOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }

  if (options?.address) {
    headers['X-Jeju-Address'] = options.address
  }

  const response = await fetch(`${DWS_API_URL}${endpoint}`, {
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

  const data = await response.json()
  const result = schema.safeParse(data)

  if (!result.success) {
    throw new ValidationError(
      `API response validation failed: ${result.error.message}`,
      result.error,
    )
  }

  return result.data
}

/**
 * Helper for POST requests
 */
export async function postApi<T>(
  endpoint: string,
  body: Record<string, unknown>,
  options?: Omit<FetchOptions, 'body' | 'method'>,
  schema?: z.ZodType<T>,
): Promise<T> {
  return fetchApi<T>(
    endpoint,
    {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    },
    schema,
  )
}

/**
 * Helper for DELETE requests
 */
export async function deleteApi<T>(
  endpoint: string,
  options?: Omit<FetchOptions, 'method'>,
  schema?: z.ZodType<T>,
): Promise<T> {
  return fetchApi<T>(
    endpoint,
    {
      ...options,
      method: 'DELETE',
    },
    schema,
  )
}

/**
 * Helper for uploading files
 */
export async function uploadFile(
  endpoint: string,
  file: File,
  address?: string,
): Promise<{ cid: string; size?: number; contentType?: string }> {
  const formData = new FormData()
  formData.append('file', file)

  const headers: Record<string, string> = {}
  if (address) {
    headers['X-Jeju-Address'] = address
  }

  const response = await fetch(`${DWS_API_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new APIError(
      error.error || error.message || 'Upload failed',
      response.status,
    )
  }

  return response.json()
}

/**
 * Helper for uploading raw data
 */
export async function uploadRaw(
  endpoint: string,
  data: string | ArrayBuffer,
  contentType: string,
  address?: string,
  filename?: string,
): Promise<{ cid: string }> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  }
  if (address) {
    headers['X-Jeju-Address'] = address
  }
  if (filename) {
    headers['x-filename'] = filename
  }

  const response = await fetch(`${DWS_API_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: data,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new APIError(
      error.error || error.message || 'Upload failed',
      response.status,
    )
  }

  return response.json()
}
