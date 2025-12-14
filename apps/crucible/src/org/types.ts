/**
 * Org Types
 * 
 * Type definitions for decentralized organization management.
 */

import type { Address } from 'viem';

// =============================================================================
// Todo Types
// =============================================================================

export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Todo {
  id: string;
  title: string;
  description?: string;
  priority: TodoPriority;
  status: TodoStatus;
  dueDate?: number;
  assigneeAgentId?: string;
  assigneeName?: string;
  tags: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// =============================================================================
// Check-in Types
// =============================================================================

export type CheckinType = 'standup' | 'sprint' | 'mental_health' | 'project_status' | 'retrospective';
export type CheckinFrequency = 'daily' | 'weekdays' | 'weekly' | 'bi_weekly' | 'monthly';

export interface CheckinSchedule {
  id: string;
  roomId: string;
  name: string;
  checkinType: CheckinType;
  frequency: CheckinFrequency;
  timeUtc: string;
  questions: string[];
  enabled: boolean;
  nextRunAt: number;
  createdBy: string;
  createdAt: number;
}

export interface CheckinResponse {
  id: string;
  scheduleId: string;
  responderAgentId: string;
  responderName?: string;
  answers: Record<string, string>;
  blockers?: string[];
  submittedAt: number;
}

// =============================================================================
// Team Types
// =============================================================================

export interface TeamMember {
  id: string;
  agentId: string;
  displayName: string;
  role?: string;
  isAdmin: boolean;
  joinedAt: number;
  lastActiveAt: number;
  stats: {
    totalCheckins: number;
    checkinStreak: number;
    todosCompleted: number;
  };
}

// =============================================================================
// Org State
// =============================================================================

export interface OrgState {
  orgId: string;
  version: number;
  todos: Todo[];
  checkinSchedules: CheckinSchedule[];
  checkinResponses: CheckinResponse[];
  teamMembers: TeamMember[];
  metadata: Record<string, unknown>;
  updatedAt: number;
}

// =============================================================================
// Report Types
// =============================================================================

export interface CheckinReport {
  scheduleName: string;
  checkinType: CheckinType;
  period: { start: number; end: number };
  totalResponses: number;
  participationRate: number;
  members: Array<{
    name: string;
    responseCount: number;
    streak: number;
    blockerCount: number;
  }>;
  blockers: Array<{
    memberName: string;
    blocker: string;
    date: number;
  }>;
}

// =============================================================================
// MCP Context
// =============================================================================

export interface MCPContext {
  orgId: string;
  roomId: string;
  agentId?: string;
  platform?: 'discord' | 'telegram' | 'web';
}

// =============================================================================
// Config
// =============================================================================

export interface OrgConfig {
  rpcUrl: string;
  privateKey?: string;
  contracts: {
    roomRegistry: Address;
    identityRegistry: Address;
  };
  services: {
    storageApi: string;
    ipfsGateway: string;
    crucibleApi: string;
  };
  network: 'localnet' | 'testnet' | 'mainnet';
}
