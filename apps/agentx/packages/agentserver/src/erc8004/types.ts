/**
 * ERC-8004 Service Discovery Types
 */

export type ServiceType = 'game' | 'tool' | 'social' | 'defi' | 'content' | 'other';

export type Service = {
  id: bigint;
  name: string;
  type: ServiceType;
  description: string;
  url: string;
  ownerAddress: string;
  agentCardUri: string;
  metadata: Record<string, string>;
  reputation?: {
    score: number;
    feedbackCount: number;
  };
};

export type ServiceFilters = {
  type?: ServiceType;
  minReputation?: number;
  searchTerm?: string;
};

export type ServiceConnection = {
  serviceId: bigint;
  service: Service;
  websocket?: WebSocket;
  connected: boolean;
  connectedAt?: Date;
};

export type RegistrationResult = {
  registered: boolean;
  agentId?: bigint;
  agentDomain?: string;
  transactionHash?: string;
  error?: string;
};

export type AgentCard = {
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  endpoints: {
    websocket?: string;
    rest?: string;
  };
  metadata?: Record<string, string>;
};

