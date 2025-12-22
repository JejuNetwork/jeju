/**
 * Job Types
 */

import type { Timestamps } from './common'

export type JobType = 'full-time' | 'part-time' | 'contract' | 'bounty'

export interface Salary {
  min: number
  max: number
  currency: string
  period?: 'hour' | 'day' | 'week' | 'month' | 'year'
}

export interface Job extends Timestamps {
  id: string
  title: string
  company: string
  companyLogo?: string
  type: JobType
  remote: boolean
  location: string
  salary?: Salary
  skills: string[]
  description: string
  applications: number
}

export interface JobApplication {
  id: string
  jobId: string
  applicant: string
  coverLetter: string
  resumeUri?: string
  status: 'pending' | 'reviewing' | 'accepted' | 'rejected'
  createdAt: number
}
