/** Factory Shared Types */

import type { Address } from 'viem'

export interface ProjectTask {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  assignee?: string
  dueDate?: number
}

export interface Project {
  id: string
  name: string
  description: string
  status: 'active' | 'archived' | 'completed' | 'on_hold'
  visibility: 'public' | 'private' | 'internal'
  owner: Address
  members: number
  tasks: {
    total: number
    completed: number
    inProgress: number
    pending: number
  }
  milestones: Array<{ name: string; progress: number }>
  createdAt: number
  updatedAt: number
}
