/** Jobs Routes */

import { Elysia } from 'elysia'
import {
  createJob as dbCreateJob,
  getJobStats as dbGetJobStats,
  listJobs as dbListJobs,
  getJob,
  type JobRow,
} from '../db/client'
import { CreateJobBodySchema, expectValid, JobsQuerySchema } from '../schemas'
import { requireAuth } from '../validation/access-control'

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

function transformJob(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    companyLogo: row.company_logo ?? undefined,
    type: row.type,
    remote: row.remote === 1,
    location: row.location,
    salary:
      row.salary_min !== null &&
      row.salary_max !== null &&
      row.salary_currency !== null
        ? {
            min: row.salary_min,
            max: row.salary_max,
            currency: row.salary_currency,
            period: row.salary_period as JobSalary['period'],
          }
        : undefined,
    skills: JSON.parse(row.skills) as string[],
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    applications: row.applications,
  }
}

export const jobsRoutes = new Elysia({ prefix: '/api/jobs' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(JobsQuerySchema, query, 'query params')
      const page = parseInt(validated.page ?? '1', 10)
      const limit = parseInt(validated.limit ?? '20', 10)

      const result = dbListJobs({
        type: validated.type,
        remote:
          validated.remote === 'true'
            ? true
            : validated.remote === 'false'
              ? false
              : undefined,
        page,
        limit,
      })

      const jobs = result.jobs.map(transformJob)

      return {
        jobs,
        total: result.total,
        page,
        limit,
        hasMore: page * limit < result.total,
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

      const row = dbCreateJob({
        title: validated.title,
        company: validated.company,
        type: validated.type,
        remote: validated.remote,
        location: validated.location,
        salary: validated.salary,
        skills: validated.skills,
        description: validated.description,
        poster: authResult.address,
      })

      set.status = 201
      return transformJob(row)
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
      return dbGetJobStats()
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
    async ({ params, set }) => {
      const row = getJob(params.jobId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Job ${params.jobId} not found`,
          },
        }
      }
      return transformJob(row)
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
      const row = getJob(params.jobId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Job ${params.jobId} not found`,
          },
        }
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
      const row = getJob(params.jobId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Job ${params.jobId} not found`,
          },
        }
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
