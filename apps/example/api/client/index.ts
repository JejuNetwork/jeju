import { treaty } from '@elysiajs/eden'
import type { App } from '..'

function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const configuredUrl =
      typeof process !== 'undefined' ? process.env.API_URL : undefined
    if (configuredUrl) return configuredUrl

    return ''
  }
  return process.env.API_URL || 'http://localhost:4500'
}

export function createExampleClient(
  baseUrl?: string,
  options?: { headers?: Record<string, string> },
) {
  return treaty<App>(
    baseUrl || getApiBaseUrl(),
    options?.headers ? { headers: options.headers } : {},
  )
}

export const api = createExampleClient()

export type ExampleClient = ReturnType<typeof createExampleClient>

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: Record<string, string>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface EdenErrorValue {
  error?: string
  message?: string
  code?: string
}

export function handleEdenResponse<T>(response: {
  data: T | null
  error: { value: EdenErrorValue | string; status: number } | null
}): T {
  if (response.error) {
    const status = response.error.status
    const errorValue = response.error.value
    const message =
      typeof errorValue === 'string'
        ? errorValue
        : errorValue?.error || errorValue?.message || 'API request failed'
    throw new ApiError(message, status)
  }
  if (response.data === null) {
    throw new ApiError('No data returned', 500)
  }
  return response.data
}

export interface AuthHeadersInput {
  address: string
  signMessage: (message: string) => Promise<string>
}

export async function generateAuthHeaders(
  input: AuthHeadersInput,
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  const message = `jeju-dapp:${timestamp}`
  const signature = await input.signMessage(message)

  return {
    'Content-Type': 'application/json',
    'x-jeju-address': input.address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  }
}

export async function createAuthenticatedClient(
  input: AuthHeadersInput,
  baseUrl?: string,
): Promise<ExampleClient> {
  const headers = await generateAuthHeaders(input)
  return createExampleClient(baseUrl, { headers })
}

export type { App } from '..'
