/**
 * Typed API Client for Training Services
 */

import { z } from 'zod'

export interface EdenRequestOptions {
  headers?: Record<string, string>
  timeout?: number
}

export function unwrapEden<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) {
    throw new Error(
      result.error instanceof Error ? result.error.message : String(result.error),
    )
  }
  return result.data as T
}

export async function checkEdenHealth(
  baseUrl: string,
  path = '/health',
  timeout = 5000,
): Promise<boolean> {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null)
  return response?.ok ?? false
}

export const DWSJobStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
])

export const DWSJobResponseSchema = z.object({
  jobId: z.string(),
  status: DWSJobStatusSchema,
  result: z.unknown().optional(),
  error: z.string().optional(),
  logs: z.array(z.string()).optional(),
})

export const DWSSubmitResponseSchema = z.object({ jobId: z.string() })

export type DWSJobStatus = z.infer<typeof DWSJobStatusSchema>
export type DWSJobResponse = z.infer<typeof DWSJobResponseSchema>
export type DWSSubmitResponse = z.infer<typeof DWSSubmitResponseSchema>

export function createDWSClient(dwsUrl: string, options: EdenRequestOptions = {}) {
  const normalizedUrl = dwsUrl.replace(/\/$/, '')
  const timeout = options.timeout ?? 120000

  return {
    async submitJob(
      command: string,
      env?: Record<string, string>,
    ): Promise<DWSSubmitResponse> {
      const response = await fetch(`${normalizedUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        body: JSON.stringify({ command, env }),
        signal: AbortSignal.timeout(timeout),
      })
      if (!response.ok) {
        const error = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}: ${error || response.statusText}`)
      }
      return DWSSubmitResponseSchema.parse(await response.json())
    },

    async getJob(jobId: string): Promise<DWSJobResponse> {
      const response = await fetch(`${normalizedUrl}/api/jobs/${jobId}`, {
        headers: options.headers,
        signal: AbortSignal.timeout(timeout),
      })
      if (!response.ok) {
        const error = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}: ${error || response.statusText}`)
      }
      return DWSJobResponseSchema.parse(await response.json())
    },

    async cancelJob(jobId: string): Promise<void> {
      const response = await fetch(`${normalizedUrl}/api/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: options.headers,
        signal: AbortSignal.timeout(timeout),
      })
      if (!response.ok) {
        const error = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}: ${error || response.statusText}`)
      }
    },

    checkHealth: () => checkEdenHealth(normalizedUrl),
  }
}
