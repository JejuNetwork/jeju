/**
 * Project Types
 */

import type { Address } from 'viem';
import type { Timestamps } from './common';

export type ProjectStatus = 'active' | 'archived' | 'completed' | 'on_hold';

export type ProjectVisibility = 'public' | 'private' | 'internal';

export interface ProjectTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  assignee?: Address;
  dueDate?: number;
}

export interface ProjectMilestone {
  name: string;
  progress: number;
  dueDate?: number;
}

export interface ProjectTasks {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

export interface Project extends Timestamps {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  owner: Address;
  members: number;
  tasks: ProjectTasks;
  milestones: ProjectMilestone[];
}
