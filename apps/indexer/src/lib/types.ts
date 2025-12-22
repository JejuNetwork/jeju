/**
 * Shared types for the indexer app
 * 
 * Contains types and error classes used across REST, A2A, and MCP servers.
 */

// ============================================================================
// Search Result Types
// ============================================================================

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
