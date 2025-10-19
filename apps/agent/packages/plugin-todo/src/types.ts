import type { UUID } from '@elizaos/core';

// Extend the core service types with todo service
declare module '@elizaos/core' {
  interface ServiceTypeRegistry {
    TODO: 'TODO';
    TODO_REMINDER: 'TODO_REMINDER';
  }
}

// Export service type constant
export const TodoServiceType = {
  TODO: 'TODO' as const,
  TODO_REMINDER: 'TODO_REMINDER' as const,
} satisfies Partial<import('@elizaos/core').ServiceTypeRegistry>;

/**
 * Type for todo metadata
 */
export type TodoMetadata = Record<string, string | number | boolean | null | undefined>;

/**
 * Todo-specific types
 */
export interface TodoData {
  id: UUID;
  agentId: UUID;
  worldId: UUID;
  roomId: UUID;
  entityId: UUID;
  name: string;
  description?: string;
  type: 'one-off' | 'daily';
  priority: number; // 1-5, with 1 being highest priority
  isUrgent: boolean;
  isCompleted: boolean;
  dueDate?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata: TodoMetadata;
  tags?: string[];
}

export interface CreateTodoInput {
  agentId: UUID;
  worldId: UUID;
  roomId: UUID;
  entityId: UUID;
  name: string;
  description?: string;
  type: 'one-off' | 'daily';
  priority?: number;
  isUrgent?: boolean;
  dueDate?: Date;
  metadata?: TodoMetadata;
  tags?: string[];
}

export interface UpdateTodoInput {
  name?: string;
  description?: string;
  type?: 'one-off' | 'daily';
  priority?: number;
  isUrgent?: boolean;
  isCompleted?: boolean;
  dueDate?: Date;
  completedAt?: Date;
  metadata?: TodoMetadata;
}
