/**
 * Shared types for the indexer app
 * 
 * Consolidates types used across REST, A2A, and MCP servers.
 */

import type { z } from 'zod';
import type {
  paginationSchema,
  searchParamsSchema,
  agentsQuerySchema,
  blocksQuerySchema,
  transactionsQuerySchema,
  contractsQuerySchema,
  tokenTransfersQuerySchema,
  nodesQuerySchema,
  providersQuerySchema,
  containersQuerySchema,
  crossServiceRequestsQuerySchema,
  oracleFeedsQuerySchema,
  oracleOperatorsQuerySchema,
  oracleReportsQuerySchema,
  oracleDisputesQuerySchema,
  a2aRequestSchema,
  mcpResourceReadSchema,
  mcpToolCallSchema,
  mcpPromptGetSchema,
} from './validation';

// ============================================================================
// Pagination
// ============================================================================

export type PaginationParams = z.infer<typeof paginationSchema>;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// Search
// ============================================================================

export type SearchParams = z.infer<typeof searchParamsSchema>;
export type EndpointType = 'a2a' | 'mcp' | 'rest' | 'graphql' | 'all';
export type ServiceCategory = 'agent' | 'workflow' | 'app' | 'game' | 'oracle' | 'marketplace' | 'compute' | 'storage' | 'all';

export interface AgentSearchResult {
  agentId: string;
  name: string;
  description: string | null;
  tags: string[];
  serviceType: string | null;
  category: string | null;
  endpoints: {
    a2a: string | null;
    mcp: string | null;
  };
  tools: {
    mcpTools: string[];
    a2aSkills: string[];
  };
  stakeTier: number;
  stakeAmount: string;
  x402Support: boolean;
  active: boolean;
  isBanned: boolean;
  registeredAt: string;
  score: number;
}

export interface ProviderResult {
  providerId: string;
  type: 'compute' | 'storage';
  name: string;
  endpoint: string;
  agentId: number | null;
  isActive: boolean;
  isVerified: boolean;
  score: number;
}

export interface SearchResult {
  agents: AgentSearchResult[];
  providers: ProviderResult[];
  total: number;
  facets: {
    tags: Array<{ tag: string; count: number }>;
    serviceTypes: Array<{ type: string; count: number }>;
    endpointTypes: Array<{ type: string; count: number }>;
  };
  query: string | null;
  took: number;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export type AgentsQuery = z.infer<typeof agentsQuerySchema>;
export type BlocksQuery = z.infer<typeof blocksQuerySchema>;
export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;
export type ContractsQuery = z.infer<typeof contractsQuerySchema>;
export type TokenTransfersQuery = z.infer<typeof tokenTransfersQuerySchema>;
export type NodesQuery = z.infer<typeof nodesQuerySchema>;
export type ProvidersQuery = z.infer<typeof providersQuerySchema>;
export type ContainersQuery = z.infer<typeof containersQuerySchema>;
export type CrossServiceRequestsQuery = z.infer<typeof crossServiceRequestsQuerySchema>;
export type OracleFeedsQuery = z.infer<typeof oracleFeedsQuerySchema>;
export type OracleOperatorsQuery = z.infer<typeof oracleOperatorsQuerySchema>;
export type OracleReportsQuery = z.infer<typeof oracleReportsQuerySchema>;
export type OracleDisputesQuery = z.infer<typeof oracleDisputesQuerySchema>;

// ============================================================================
// A2A Types
// ============================================================================

export type A2ARequest = z.infer<typeof a2aRequestSchema>;

export interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

// ============================================================================
// MCP Types
// ============================================================================

export type MCPResourceRead = z.infer<typeof mcpResourceReadSchema>;
export type MCPToolCall = z.infer<typeof mcpToolCallSchema>;
export type MCPPromptGet = z.infer<typeof mcpPromptGetSchema>;

// ============================================================================
// Error Types
// ============================================================================

export class ValidationError extends Error {
  constructor(message: string, public readonly errors: Array<{ path: string[]; message: string }>) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, identifier: string) {
    super(`${resource} not found: ${identifier}`);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}
