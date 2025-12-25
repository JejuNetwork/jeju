/** Jobs Routes */

import { Elysia } from 'elysia'
import { CreateJobBodySchema, expectValid, JobsQuerySchema } from '../schemas'
import { requireAuth } from '../validation/access-control'

interface Job {
  id: string
  title: string
  company: string
  companyLogo?: string
  type: 'full-time' | 'part-time' | 'contract' | 'bounty'
  remote: boolean
  location: string
  salary?: {
    min: number
    max: number
    currency: string
    period?: 'hour' | 'day' | 'week' | 'month' | 'year'
  }
  skills: string[]
  description: string
  createdAt: number
  updatedAt: number
  applications: number
}

export const jobsRoutes = new Elysia({ prefix: '/api/jobs' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(JobsQuerySchema, query, 'query params')
      const page = parseInt(validated.page ?? '1', 10)
      const limit = parseInt(validated.limit ?? '20', 10)

      const jobs: Job[] = [
        {
          id: '1',
          title: 'Senior Solidity Developer',
          company: 'Jeju Network',
          companyLogo: 'https://avatars.githubusercontent.com/u/1?v=4',
          type: 'full-time',
          remote: true,
          location: 'Remote',
          salary: { min: 150000, max: 200000, currency: 'USD' },
          skills: ['Solidity', 'Foundry', 'EVM'],
          description: 'Build core smart contracts for the Jeju ecosystem',
          createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
          applications: 45,
        },
        {
          id: '2',
          title: 'Frontend Engineer',
          company: 'DeFi Protocol',
          companyLogo: 'https://avatars.githubusercontent.com/u/2?v=4',
          type: 'contract',
          remote: true,
          location: 'Remote',
          salary: { min: 100, max: 150, currency: 'USD', period: 'hour' },
          skills: ['React', 'TypeScript', 'Web3'],
          description: 'Build beautiful DeFi interfaces',
          createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
          applications: 28,
        },
      ]

      return {
        jobs,
        total: jobs.length,
        page,
        limit,
        hasMore: false,
      }
    },
    {
      detail: {
        tags: ['jobs'],
        summary: 'List jobs',
        description: 'Get a list of job postings',
      },
    },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const validated = expectValid(CreateJobBodySchema, body, 'request body')

      const job: Job = {
        id: `job-${Date.now()}`,
        title: validated.title,
        company: validated.company,
        type: validated.type,
        remote: validated.remote,
        location: validated.location,
        salary: validated.salary,
        skills: validated.skills,
        description: validated.description,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        applications: 0,
      }

      set.status = 201
      return job
    },
    {
      detail: {
        tags: ['jobs'],
        summary: 'Create job',
        description: 'Create a new job posting',
      },
    },
  )
  .get(
    '/stats',
    async () => {
      return {
        totalJobs: 156,
        openJobs: 89,
        remoteJobs: 124,
        averageSalary: 125000,
      }
    },
    {
      detail: {
        tags: ['jobs'],
        summary: 'Get job stats',
        description: 'Get job market statistics',
      },
    },
  )
  .get(
    '/:jobId',
    async ({ params }) => {
      const job: Job = {
        id: params.jobId,
        title: 'Senior Solidity Developer',
        company: 'Jeju Network',
        companyLogo: 'https://avatars.githubusercontent.com/u/1?v=4',
        type: 'full-time',
        remote: true,
        location: 'Remote',
        salary: { min: 150000, max: 200000, currency: 'USD' },
        skills: ['Solidity', 'Foundry', 'EVM'],
        description: 'Build core smart contracts for the Jeju ecosystem',
        createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        applications: 45,
      }
      return job
    },
    {
      detail: {
        tags: ['jobs'],
        summary: 'Get job',
        description: 'Get a specific job posting',
      },
    },
  )
  .post(
    '/:jobId/cancel',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      return { success: true, jobId: params.jobId }
    },
    {
      detail: {
        tags: ['jobs'],
        summary: 'Cancel job',
        description: 'Cancel a job posting',
      },
    },
  )
  .post(
    '/:jobId/retry',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      return { success: true, jobId: params.jobId }
    },
    {
      detail: {
        tags: ['jobs'],
        summary: 'Retry job',
        description: 'Retry a failed job',
      },
    },
  )
