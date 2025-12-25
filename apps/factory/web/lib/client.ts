/** Factory API Client */

import { treaty } from '@elysiajs/eden'
import { isPlainObject } from '@jejunetwork/types'
import type { App } from '../../api/server'

function getApiBase(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:4009'
  }

  const { hostname, port } = window.location

  if (hostname === 'localhost' && port !== '4009') {
    return 'http://localhost:4009'
  }

  if (hostname.includes('local.jejunetwork.org')) {
    return '' // Same origin via proxy
  }

  return ''
}

const API_BASE = getApiBase()

export const api = treaty<App>(API_BASE)

export type EdenResponse<T> = {
  data: T | null
  error: {
    status: number
    message: string
    value: unknown
  } | null
}

interface EdenErrorValue {
  type?: string
  on?: string
  summary?: string
  message?: string
}

function isEdenErrorValue(value: unknown): value is EdenErrorValue {
  return isPlainObject(value)
}

function getErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (isEdenErrorValue(value)) {
    return value.message ?? value.summary ?? 'API Error'
  }
  return 'API Error'
}

export function extractData<T>(response: {
  data: T | null
  error: { value: unknown } | null
}): T {
  if (response.error) {
    throw new Error(getErrorMessage(response.error.value))
  }
  if (response.data === null) {
    throw new Error('No data returned from API')
  }
  return response.data
}

export function extractDataSafe<T>(response: {
  data: T | null
  error: { value: unknown } | null
}): T | null {
  if (response.error || response.data === null) {
    return null
  }
  return response.data
}

export type FactoryClient = typeof api
