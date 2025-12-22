/**
 * Shared types for monitoring module
 */
import { z } from 'zod';

// ============================================================================
// Grafana Types
// ============================================================================

export const GrafanaTargetSchema = z.object({
  expr: z.string().optional(),
  rawSql: z.string().optional(),
  refId: z.string().optional(),
});

export const GrafanaPanelSchema = z.object({
  id: z.number().optional(),
  title: z.string(),
  type: z.string(),
  targets: z.array(GrafanaTargetSchema).optional(),
  datasource: z.object({ type: z.string(), uid: z.string() }).optional(),
  gridPos: z.object({ h: z.number(), w: z.number(), x: z.number(), y: z.number() }).optional(),
});

export const GrafanaDashboardSchema = z.object({
  title: z.string(),
  uid: z.string().optional(),
  panels: z.array(GrafanaPanelSchema),
  templating: z.object({ list: z.array(z.object({ name: z.string(), type: z.string() })) }).optional(),
  schemaVersion: z.number().optional(),
  tags: z.array(z.string()).optional(),
  refresh: z.string().optional(),
});

export const GrafanaDataSourceSchema = z.object({
  type: z.string(),
  name: z.string(),
  uid: z.string().optional(),
});

export const GrafanaHealthSchema = z.object({
  database: z.string(),
});

export type GrafanaTarget = z.infer<typeof GrafanaTargetSchema>;
export type GrafanaPanel = z.infer<typeof GrafanaPanelSchema>;
export type GrafanaDashboard = z.infer<typeof GrafanaDashboardSchema>;
export type GrafanaDataSource = z.infer<typeof GrafanaDataSourceSchema>;
export type GrafanaHealth = z.infer<typeof GrafanaHealthSchema>;

// ============================================================================
// Prometheus Types
// ============================================================================

export const PrometheusTargetSchema = z.object({
  health: z.string(),
  labels: z.record(z.string(), z.string()),
  lastScrape: z.string().optional(),
});

export const PrometheusTargetsResponseSchema = z.object({
  status: z.string(),
  data: z.object({
    activeTargets: z.array(PrometheusTargetSchema),
  }),
});

export const PrometheusQueryResultSchema = z.object({
  status: z.string(),
  data: z.object({
    resultType: z.string().optional(),
    result: z.array(z.object({
      metric: z.record(z.string(), z.string()),
      value: z.tuple([z.number(), z.string()]).optional(),
      values: z.array(z.tuple([z.number(), z.string()])).optional(),
    })).optional(),
  }).optional(),
});

export const PrometheusQueryResponseSchema = z.object({
  data: z.object({
    result: z.array(z.object({
      value: z.tuple([z.number(), z.string()]),
    })).optional(),
  }).optional(),
});

export const PrometheusAlertSchema = z.object({
  state: z.string(),
  labels: z.record(z.string(), z.string()),
  annotations: z.record(z.string(), z.string()),
});

export const PrometheusAlertsResponseSchema = z.object({
  status: z.string(),
  data: z.object({
    alerts: z.array(PrometheusAlertSchema),
  }),
});

export type PrometheusTarget = z.infer<typeof PrometheusTargetSchema>;
export type PrometheusTargetsResponse = z.infer<typeof PrometheusTargetsResponseSchema>;
export type PrometheusQueryResult = z.infer<typeof PrometheusQueryResultSchema>;
export type PrometheusQueryResponse = z.infer<typeof PrometheusQueryResponseSchema>;
export type PrometheusAlert = z.infer<typeof PrometheusAlertSchema>;
export type PrometheusAlertsResponse = z.infer<typeof PrometheusAlertsResponseSchema>;

// ============================================================================
// A2A Types
// ============================================================================

export const AgentCardSkillSchema = z.object({
  id: z.string(),
  examples: z.array(z.string()),
});

export const AgentCardSchema = z.object({
  protocolVersion: z.string(),
  name: z.string(),
  description: z.string(),
  skills: z.array(AgentCardSkillSchema),
});

export const A2ARequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  id: z.union([z.string(), z.number()]),
  params: z.object({
    message: z.object({
      messageId: z.string(),
      parts: z.array(z.object({
        kind: z.string(),
        data: z.object({
          skillId: z.string().optional(),
          query: z.string().optional(),
        }).optional(),
      })),
    }).optional(),
  }).optional(),
});

export const A2AResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.union([z.string(), z.number()]),
  result: z.object({
    role: z.string(),
    parts: z.array(z.object({
      kind: z.string(),
      text: z.string().optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    })),
  }).optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }).optional(),
});

export type AgentCardSkill = z.infer<typeof AgentCardSkillSchema>;
export type AgentCard = z.infer<typeof AgentCardSchema>;
export type A2ARequest = z.infer<typeof A2ARequestSchema>;
export type A2AResponse = z.infer<typeof A2AResponseSchema>;

// ============================================================================
// MCP Types
// ============================================================================

export const MCPRequestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.object({
    message: z.object({
      parts: z.array(z.object({
        kind: z.string(),
        data: z.record(z.string(), z.unknown()).optional(),
      })),
      messageId: z.string().optional(),
    }).optional(),
  }).optional(),
});

export const MCPResourceReadSchema = z.object({
  uri: z.string(),
});

export const MCPToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

export const MCPPromptGetSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.string()),
});

export type MCPRequest = z.infer<typeof MCPRequestSchema>;
export type MCPResourceRead = z.infer<typeof MCPResourceReadSchema>;
export type MCPToolCall = z.infer<typeof MCPToolCallSchema>;
export type MCPPromptGet = z.infer<typeof MCPPromptGetSchema>;

// ============================================================================
// OIF Types
// ============================================================================

export const OIFStatsResponseSchema = z.object({
  totalIntents: z.number(),
  activeSolvers: z.number(),
  totalVolumeUsd: z.string(),
});

export const OIFSolverSchema = z.object({
  address: z.string(),
  name: z.string(),
  successRate: z.number(),
  reputation: z.number(),
});

export const OIFRouteSchema = z.object({
  routeId: z.string(),
  sourceChainId: z.number(),
  destinationChainId: z.number(),
  successRate: z.number(),
  avgFillTimeSeconds: z.number(),
  totalVolume: z.string(),
});

export type OIFStatsResponse = z.infer<typeof OIFStatsResponseSchema>;
export type OIFSolver = z.infer<typeof OIFSolverSchema>;
export type OIFRoute = z.infer<typeof OIFRouteSchema>;

// ============================================================================
// GraphQL Types
// ============================================================================

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

// ============================================================================
// RPC Types  
// ============================================================================

export type JsonRpcParams = (string | number | boolean | object | null)[];

export interface JsonRpcResponse<T> {
  result: T;
  error?: { message: string };
}

// ============================================================================
// Validation Dashboard Types
// ============================================================================

export interface ValidationResult {
  dashboard: string;
  passed: number;
  failed: number;
  errors: string[];
  queries: { query: string; result: string }[];
}
