/** Factory Shared Types */

import type { Address } from 'viem'

// =====================================================================
// JOB TYPES
// =====================================================================

export interface JobSalary {
  min: number
  max: number
  currency: string
  period?: 'hour' | 'day' | 'week' | 'month' | 'year'
}

export interface Job {
  id: string
  title: string
  company: string
  companyLogo?: string
  type: 'full-time' | 'part-time' | 'contract' | 'bounty'
  remote: boolean
  location: string
  salary?: JobSalary
  skills: string[]
  description: string
  createdAt: number
  updatedAt: number
  applications: number
}

export interface JobStats {
  totalJobs: number
  openJobs: number
  remoteJobs: number
  averageSalary: number
}

// =====================================================================
// PROJECT TYPES
// =====================================================================

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
