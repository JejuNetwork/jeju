import type { UUID } from '@elizaos/core';

// Extend the core service types with goals service
declare module '@elizaos/core' {
  interface ServiceTypeRegistry {
    GOALS: 'goals';
  }
}

// Export service type constant
export const GoalServiceType = {
  GOALS: 'goals' as const,
} satisfies Partial<import('@elizaos/core').ServiceTypeRegistry>;

/**
 * Goal data structure from database
 */
export interface GoalData {
  id: UUID;
  agentId: UUID;
  ownerType: 'agent' | 'entity';
  ownerId: UUID;
  name: string;
  description?: string | null;
  isCompleted: boolean;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>;
  tags?: string[];
}
