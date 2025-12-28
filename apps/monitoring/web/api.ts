import { z } from 'zod'
import {
  A2AResponseSchema,
  MetricResultSchema,
  OIFStatsSchema,
  PrometheusAlertSchema,
  PrometheusTargetSchema,
  RouteSchema,
  SolverSchema,
} from '../lib/types'

const API_BASE = typeof window !== 'undefined' ? '' : 'http://localhost:9091'

export const queryKeys = {
  metrics: (query: string) => ['metrics', query] as const,
  alerts: () => ['alerts'] as const,
  targets: () => ['targets'] as const,
  oifStats: () => ['oif', 'stats'] as const,
  oifSolvers: () => ['oif', 'solvers'] as const,
  oifRoutes: () => ['oif', 'routes'] as const,
  systemHealth: () => ['system', 'health'] as const,
} as const

export type MetricResult = z.infer<typeof MetricResultSchema>
export type Alert = z.infer<typeof PrometheusAlertSchema>
export type Target = z.infer<typeof PrometheusTargetSchema>
export type OIFStats = z.infer<typeof OIFStatsSchema>
export type Solver = z.infer<typeof SolverSchema>
export type Route = z.infer<typeof RouteSchema>

const A2ASkillDataSchema = z
  .object({
    result: z
      .array(
        z.object({
          metric: z.record(z.string(), z.string()),
          value: z.tuple([z.number(), z.string()]).optional(),
        }),
      )
      .optional(),
    alerts: z.array(PrometheusAlertSchema).optional(),
    targets: z.array(PrometheusTargetSchema).optional(),
    totalIntents: z.number().optional(),
    activeSolvers: z.number().optional(),
    totalVolumeUsd: z.string().optional(),
    successRate: z.number().optional(),
    totalSolvers: z.number().optional(),
    healthySolvers: z.number().optional(),
    avgSuccessRate: z.number().optional(),
    solvers: z.array(SolverSchema).optional(),
    totalRoutes: z.number().optional(),
    totalVolume: z.string().optional(),
    routes: z.array(RouteSchema).optional(),
    error: z.string().optional(),
  })
  .passthrough()

export type A2ASkillData = z.infer<typeof A2ASkillDataSchema>

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function sendA2ARequest(
  skillId: string,
  query?: string,
): Promise<A2ASkillData | null> {
  const response = await fetch(`${API_BASE}/api/a2a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: `msg-${Date.now()}`,
          parts: [{ kind: 'data', data: { skillId, query } }],
        },
      },
      id: Date.now(),
    }),
  })

  if (!response.ok) {
    throw new ApiError(
      `A2A request failed: ${response.status}`,
      response.status,
    )
  }

  const json = await response.json()
  const parsed = A2AResponseSchema.safeParse(json)

  if (!parsed.success) {
    throw new ApiError(`Invalid A2A response: ${parsed.error.message}`)
  }

  if (parsed.data.error) {
    throw new ApiError(parsed.data.error.message, parsed.data.error.code)
  }

  const dataPart = parsed.data.result?.parts.find((p) => p.kind === 'data')
  if (!dataPart?.data) return null

  const skillDataParsed = A2ASkillDataSchema.safeParse(dataPart.data)
  return skillDataParsed.success ? skillDataParsed.data : null
}

export const api = {
  async queryMetrics(query: string): Promise<MetricResult[]> {
    const result = await sendA2ARequest('query-metrics', query)
    if (!result) return []
    if (result.error) throw new ApiError(result.error)
    if (!result.result) return []

    const parsed = z.array(MetricResultSchema).safeParse(result.result)
    if (!parsed.success) {
      throw new ApiError(`Invalid metrics data: ${parsed.error.message}`)
    }
    return parsed.data
  },

  async getAlerts(): Promise<Alert[]> {
    const result = await sendA2ARequest('get-alerts')
    if (!result) return []
    if (result.error) throw new ApiError(result.error)
    if (!result.alerts) return []

    const parsed = z.array(PrometheusAlertSchema).safeParse(result.alerts)
    if (!parsed.success) {
      throw new ApiError(`Invalid alerts data: ${parsed.error.message}`)
    }
    return parsed.data
  },

  async getTargets(): Promise<Target[]> {
    const result = await sendA2ARequest('get-targets')
    if (!result) return []
    if (result.error) throw new ApiError(result.error)
    if (!result.targets) return []

    const parsed = z.array(PrometheusTargetSchema).safeParse(result.targets)
    if (!parsed.success) {
      throw new ApiError(`Invalid targets data: ${parsed.error.message}`)
    }
    return parsed.data
  },

  async getOIFStats(): Promise<OIFStats | null> {
    const result = await sendA2ARequest('oif-stats')
    if (!result) return null
    if (result.error) throw new ApiError(result.error)

    const parsed = OIFStatsSchema.safeParse(result)
    if (!parsed.success) return null
    return parsed.data
  },

  async getOIFSolvers(): Promise<{
    totalSolvers: number
    healthySolvers: number
    avgSuccessRate: number
    solvers: Solver[]
  }> {
    const result = await sendA2ARequest('oif-solver-health')
    if (!result) {
      return {
        totalSolvers: 0,
        healthySolvers: 0,
        avgSuccessRate: 0,
        solvers: [],
      }
    }
    if (result.error) throw new ApiError(result.error)

    const solvers = result.solvers ?? []
    const parsed = z.array(SolverSchema).safeParse(solvers)

    return {
      totalSolvers: result.totalSolvers ?? 0,
      healthySolvers: result.healthySolvers ?? 0,
      avgSuccessRate: result.avgSuccessRate ?? 0,
      solvers: parsed.success ? parsed.data : [],
    }
  },

  async getOIFRoutes(): Promise<{
    totalRoutes: number
    totalVolume: string
    avgSuccessRate: number
    routes: Route[]
  }> {
    const result = await sendA2ARequest('oif-route-stats')
    if (!result) {
      return { totalRoutes: 0, totalVolume: '0', avgSuccessRate: 0, routes: [] }
    }
    if (result.error) throw new ApiError(result.error)

    const routes = result.routes ?? []
    const parsed = z.array(RouteSchema).safeParse(routes)

    return {
      totalRoutes: result.totalRoutes ?? 0,
      totalVolume: result.totalVolume ?? '0',
      avgSuccessRate: result.avgSuccessRate ?? 0,
      routes: parsed.success ? parsed.data : [],
    }
  },
}
