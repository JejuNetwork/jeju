/**
 * Shared types for monitoring module
 */
import { z } from 'zod'

// ============================================================================
// Grafana Types
// ============================================================================

export const GrafanaTargetSchema = z.object({
  expr: z.string().optional(),
  rawSql: z.string().optional(),
  refId: z.string().optional(),
})

export const GrafanaPanelSchema = z.object({
  id: z.number().optional(),
  title: z.string(),
  type: z.string(),
  targets: z.array(GrafanaTargetSchema).optional(),
  datasource: z.object({ type: z.string(), uid: z.string() }).optional(),
  gridPos: z
    .object({ h: z.number(), w: z.number(), x: z.number(), y: z.number() })
    .optional(),
})

export const GrafanaDashboardSchema = z.object({
  title: z.string(),
  uid: z.string().optional(),
  panels: z.array(GrafanaPanelSchema),
  templating: z
    .object({ list: z.array(z.object({ name: z.string(), type: z.string() })) })
    .optional(),
  schemaVersion: z.number().optional(),
  tags: z.array(z.string()).optional(),
  refresh: z.string().optional(),
})

export const GrafanaDataSourceSchema = z.object({
  type: z.string(),
  name: z.string(),
  uid: z.string().optional(),
})

export const GrafanaHealthSchema = z.object({
  database: z.string(),
})

export type GrafanaTarget = z.infer<typeof GrafanaTargetSchema>
export type GrafanaPanel = z.infer<typeof GrafanaPanelSchema>
export type GrafanaDashboard = z.infer<typeof GrafanaDashboardSchema>
export type GrafanaDataSource = z.infer<typeof GrafanaDataSourceSchema>
export type GrafanaHealth = z.infer<typeof GrafanaHealthSchema>

// ============================================================================
// Prometheus Types
// ============================================================================

export const PrometheusTargetSchema = z.object({
  health: z.string(),
  labels: z.record(z.string(), z.string()),
  lastScrape: z.string().optional(),
})

export const PrometheusTargetsResponseSchema = z.object({
  status: z.string(),
  data: z.object({
    activeTargets: z.array(PrometheusTargetSchema),
  }),
})

export const PrometheusQueryResultSchema = z.object({
  status: z.string(),
  data: z
    .object({
      resultType: z.string().optional(),
      result: z
        .array(
          z.object({
            metric: z.record(z.string(), z.string()),
            value: z.tuple([z.number(), z.string()]).optional(),
            values: z.array(z.tuple([z.number(), z.string()])).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

export const PrometheusQueryResponseSchema = z.object({
  data: z
    .object({
      result: z
        .array(
          z.object({
            value: z.tuple([z.number(), z.string()]),
          }),
        )
        .optional(),
    })
    .optional(),
})

export const PrometheusAlertSchema = z.object({
  state: z.string(),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()),
})

export const PrometheusAlertsResponseSchema = z.object({
  status: z.string(),
  data: z.object({
    alerts: z.array(PrometheusAlertSchema),
  }),
})

export type PrometheusTarget = z.infer<typeof PrometheusTargetSchema>
export type PrometheusTargetsResponse = z.infer<
  typeof PrometheusTargetsResponseSchema
>
export type PrometheusQueryResult = z.infer<typeof PrometheusQueryResultSchema>
export type PrometheusQueryResponse = z.infer<
  typeof PrometheusQueryResponseSchema
>
export type PrometheusAlert = z.infer<typeof PrometheusAlertSchema>
export type PrometheusAlertsResponse = z.infer<
  typeof PrometheusAlertsResponseSchema
>

// ============================================================================
// A2A Types
// ============================================================================

export const AgentCardSkillSchema = z.object({
  id: z.string(),
  examples: z.array(z.string()),
})

export const AgentCardSchema = z.object({
  protocolVersion: z.string(),
  name: z.string(),
  description: z.string(),
  skills: z.array(AgentCardSkillSchema),
})

export const A2ARequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  id: z.union([z.string(), z.number()]),
  params: z
    .object({
      message: z
        .object({
          messageId: z.string(),
          parts: z.array(
            z.object({
              kind: z.string(),
              data: z
                .object({
                  skillId: z.string().optional(),
                  query: z.string().optional(),
                })
                .optional(),
            }),
          ),
        })
        .optional(),
    })
    .optional(),
})

// Schema for A2A response data - union of all possible skill result shapes
const A2AResponseDataSchema = z.union([
  z.object({ error: z.string() }),
  z.object({
    result: z
      .array(
        z.object({
          metric: z.record(z.string(), z.string()),
          value: z.tuple([z.number(), z.string()]).optional(),
        }),
      )
      .optional(),
  }),
  z.object({ alerts: z.array(PrometheusAlertSchema) }),
  z.object({ targets: z.array(PrometheusTargetSchema) }),
  z.object({
    totalIntents: z.number(),
    activeSolvers: z.number(),
    totalVolumeUsd: z.string(),
  }),
  z.object({
    totalSolvers: z.number(),
    healthySolvers: z.number(),
    avgSuccessRate: z.number(),
    solvers: z.array(
      z.object({
        address: z.string(),
        name: z.string(),
        successRate: z.number(),
        reputation: z.number(),
      }),
    ),
  }),
  z.object({
    totalRoutes: z.number(),
    totalVolume: z.string(),
    avgSuccessRate: z.number(),
    routes: z.array(
      z.object({
        routeId: z.string(),
        source: z.number(),
        destination: z.number(),
        successRate: z.number(),
        avgTime: z.number(),
      }),
    ),
  }),
  z.object({ success: z.boolean() }),
  z.object({ skillId: z.string() }), // Request data
])

export const A2AResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.union([z.string(), z.number()]),
  result: z
    .object({
      role: z.string(),
      parts: z.array(
        z.object({
          kind: z.string(),
          text: z.string().optional(),
          data: A2AResponseDataSchema.optional(),
        }),
      ),
    })
    .optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
})

export type AgentCardSkill = z.infer<typeof AgentCardSkillSchema>
export type AgentCard = z.infer<typeof AgentCardSchema>
export type A2ARequest = z.infer<typeof A2ARequestSchema>
export type A2AResponse = z.infer<typeof A2AResponseSchema>

// ============================================================================
// MCP Types
// ============================================================================

// MCP request data - skills receive specific parameters
const MCPRequestDataSchema = z.object({
  skillId: z.string().optional(),
  query: z.string().optional(),
  service: z.string().optional(),
  alertId: z.string().optional(),
})

export const MCPRequestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z
    .object({
      message: z
        .object({
          parts: z.array(
            z.object({
              kind: z.string(),
              data: MCPRequestDataSchema.optional(),
            }),
          ),
          messageId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
})

export const MCPResourceReadSchema = z.object({
  uri: z.string(),
})

// MCP tool arguments - specific shapes based on tool
const MCPToolArgsSchema = z.object({
  service: z.string().optional(),
  includeMetrics: z.boolean().optional(),
  level: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().optional(),
  since: z.string().optional(),
  name: z.string().optional(),
  condition: z.string().optional(),
  threshold: z.number().optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  channels: z.array(z.string()).optional(),
  alertId: z.string().optional(),
  comment: z.string().optional(),
  target: z.string().optional(),
  metric: z.string().optional(),
  period: z.string().optional(),
  aggregation: z.enum(['avg', 'max', 'min', 'sum']).optional(),
})

export const MCPToolCallSchema = z.object({
  name: z.string(),
  arguments: MCPToolArgsSchema,
})

export const MCPPromptGetSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.string()),
})

export type MCPRequest = z.infer<typeof MCPRequestSchema>
export type MCPResourceRead = z.infer<typeof MCPResourceReadSchema>
export type MCPToolCall = z.infer<typeof MCPToolCallSchema>
export type MCPPromptGet = z.infer<typeof MCPPromptGetSchema>

// ============================================================================
// Skill Data Types (for A2A responses)
// ============================================================================

// Specific data shapes returned by each skill
export type QueryMetricsData = {
  result?: Array<{ metric: Record<string, string>; value?: [number, string] }>
}
export type AlertsData = {
  alerts: Array<{
    state: string
    labels: Record<string, string>
    annotations: Record<string, string>
  }>
}
export type AlertsListData = {
  alerts: Array<{
    state: string
    labels: Record<string, string>
    annotations: Record<string, string>
  }>
  count: number
}
export type TargetsData = {
  targets: Array<{ health: string; labels: Record<string, string> }>
}
export type OIFStatsData = {
  totalIntents: number
  activeSolvers: number
  totalVolumeUsd: string
}
export type OIFSolverHealthData = {
  totalSolvers: number
  healthySolvers: number
  avgSuccessRate: number
  solvers: Array<{
    address: string
    name: string
    successRate: number
    reputation: number
  }>
}
export type OIFRouteStatsData = {
  totalRoutes: number
  totalVolume: string
  avgSuccessRate: number
  routes: Array<{
    routeId: string
    source: number
    destination: number
    successRate: number
    avgTime: number
  }>
}
export type ErrorData = { error: string }
export type SuccessData = { success: boolean }
// Additional A2A MCP server skill data types
export type ServiceHealthData = { status: string; latency: number }
export type AllServicesData = {
  services: string[]
  healthy: number
  unhealthy: number
}
export type ChainStatsData = {
  blockNumber: number
  tps: number
  gasPrice: string
}
export type LogsData = { logs: string[]; total: number }
export type NodeStatusData = { nodes: string[]; healthy: number }

// Union of all possible skill data types
export type SkillResultData =
  | QueryMetricsData
  | AlertsData
  | AlertsListData
  | TargetsData
  | OIFStatsData
  | OIFSolverHealthData
  | OIFRouteStatsData
  | ErrorData
  | SuccessData
  | ServiceHealthData
  | AllServicesData
  | ChainStatsData
  | LogsData
  | NodeStatusData

// Skill result shape
export interface SkillResult {
  message: string
  data: SkillResultData
}

// MCP tool arguments types
export type CheckServiceArgs = { service: string; includeMetrics?: boolean }
export type QueryLogsArgs = {
  service?: string
  level?: string
  query?: string
  limit?: number
  since?: string
}
export type CreateAlertRuleArgs = {
  name: string
  condition: string
  threshold: number
  severity: 'info' | 'warning' | 'critical'
  channels?: string[]
}
export type AcknowledgeAlertArgs = { alertId: string; comment?: string }
export type GetMetricsArgs = {
  target: string
  metric: string
  period?: string
  aggregation?: 'avg' | 'max' | 'min' | 'sum'
}

// Union of all MCP tool argument types
export type MCPToolArgs =
  | CheckServiceArgs
  | QueryLogsArgs
  | CreateAlertRuleArgs
  | AcknowledgeAlertArgs
  | GetMetricsArgs

// MCP tool result types - all string fields are optional since they come from optional args
export type CheckServiceResult = {
  service?: string
  status: string
  latency: number
  uptime: number
}
export type QueryLogsResult = { logs: string[]; total: number; query?: string }
export type CreateAlertRuleResult = {
  ruleId: string
  name?: string
  active: boolean
}
export type AcknowledgeAlertResult = { success: boolean; alertId?: string }
export type GetMetricsResult = {
  target?: string
  metric?: string
  values: number[]
}
export type MCPToolErrorResult = { error: string }

export type MCPToolResult =
  | CheckServiceResult
  | QueryLogsResult
  | CreateAlertRuleResult
  | AcknowledgeAlertResult
  | GetMetricsResult
  | MCPToolErrorResult

// MCP resource content types
export type ServicesContent = {
  services: Array<{ name: string; status: string; uptime: number }>
}
export type AlertsContent = {
  alerts: Array<{ id: string; severity: string; message: string }>
}
export type ChainStatsContent = {
  blockNumber: number
  avgBlockTime: number
  tps: number
}
export type InfrastructureContent = {
  nodes: number
  databases: number
  storage: string
}
export type DashboardContent = {
  status: string
  services: number
  alerts: number
  uptime: number
}

export type MCPResourceContent =
  | ServicesContent
  | AlertsContent
  | ChainStatsContent
  | InfrastructureContent
  | DashboardContent

// ============================================================================
// OIF Types
// ============================================================================

export const OIFStatsResponseSchema = z.object({
  totalIntents: z.number(),
  activeSolvers: z.number(),
  totalVolumeUsd: z.string(),
})

export const OIFSolverSchema = z.object({
  address: z.string(),
  name: z.string(),
  successRate: z.number(),
  reputation: z.number(),
})

export const OIFRouteSchema = z.object({
  routeId: z.string(),
  sourceChainId: z.number(),
  destinationChainId: z.number(),
  successRate: z.number(),
  avgFillTimeSeconds: z.number(),
  totalVolume: z.string(),
})

export type OIFStatsResponse = z.infer<typeof OIFStatsResponseSchema>
export type OIFSolver = z.infer<typeof OIFSolverSchema>
export type OIFRoute = z.infer<typeof OIFRouteSchema>

// ============================================================================
// GraphQL Types
// ============================================================================

export interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

// ============================================================================
// RPC Types
// ============================================================================

export type JsonRpcParams = (string | number | boolean | object | null)[]

export interface JsonRpcResponse<T> {
  result: T
  error?: { message: string }
}

// ============================================================================
// Validation Dashboard Types
// ============================================================================

export interface ValidationResult {
  dashboard: string
  passed: number
  failed: number
  errors: string[]
  queries: { query: string; result: string }[]
}
