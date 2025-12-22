/**
 * Jobs Routes
 */

import { Elysia, t } from 'elysia'
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
      const page = parseInt(query.page || '1', 10)
      const limit = parseInt(query.limit || '20', 10)

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
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        type: t.Optional(t.String()),
        remote: t.Optional(t.String()),
        skill: t.Optional(t.String()),
      }),
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

      const job: Job = {
        id: `job-${Date.now()}`,
        title: body.title,
        company: body.company,
        type: body.type,
        remote: body.remote,
        location: body.location,
        salary: body.salary,
        skills: body.skills,
        description: body.description,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        applications: 0,
      }

      set.status = 201
      return job
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 200 }),
        company: t.String({ minLength: 1, maxLength: 100 }),
        type: t.Union([
          t.Literal('full-time'),
          t.Literal('part-time'),
          t.Literal('contract'),
          t.Literal('bounty'),
        ]),
        remote: t.Boolean(),
        location: t.String({ minLength: 1 }),
        salary: t.Optional(
          t.Object({
            min: t.Number({ minimum: 0 }),
            max: t.Number({ minimum: 0 }),
            currency: t.String({ minLength: 1 }),
            period: t.Optional(
              t.Union([
                t.Literal('hour'),
                t.Literal('day'),
                t.Literal('week'),
                t.Literal('month'),
                t.Literal('year'),
              ]),
            ),
          }),
        ),
        skills: t.Array(t.String({ minLength: 1 })),
        description: t.String({ minLength: 10 }),
      }),
      detail: {
        tags: ['jobs'],
        summary: 'Create job',
        description: 'Create a new job posting',
      },
    },
  )
