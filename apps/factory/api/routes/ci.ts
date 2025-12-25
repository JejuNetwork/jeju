/** CI Routes */

import { Elysia } from 'elysia'
import {
  type CIRunRow,
  createCIRun as dbCreateCIRun,
  listCIRuns as dbListCIRuns,
  getCIRun,
} from '../db/client'
import {
  CIQuerySchema,
  CIRunParamsSchema,
  expectValid,
  TriggerWorkflowBodySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

export interface CIJob {
  name: string
  status: string
  duration?: number
}

export interface CIRun {
  id: string
  workflow: string
  status: 'queued' | 'running' | 'success' | 'failure' | 'cancelled'
  conclusion?: string
  branch: string
  commit: string
  commitMessage: string
  author: string
  duration?: number
  startedAt: number
  completedAt?: number
  jobs: CIJob[]
  createdAt: number
  updatedAt: number
}

function transformCIRun(row: CIRunRow): CIRun {
  return {
    id: row.id,
    workflow: row.workflow,
    status: row.status,
    conclusion: row.conclusion ?? undefined,
    branch: row.branch,
    commit: row.commit_sha,
    commitMessage: row.commit_message,
    author: row.author,
    duration: row.duration ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    jobs: [], // CI jobs loaded separately if needed
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const ciRoutes = new Elysia({ prefix: '/api/ci' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(CIQuerySchema, query, 'query params')
      const page = parseInt(validated.page || '1', 10)

      const result = dbListCIRuns({
        repo: validated.repo,
        status: validated.status,
        branch: validated.branch,
        page,
      })

      const runs = result.runs.map(transformCIRun)
      return { runs, total: result.total, page }
    },
    {
      detail: {
        tags: ['ci'],
        summary: 'List CI runs',
        description: 'Get a list of CI/CD workflow runs',
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

      const validated = expectValid(
        TriggerWorkflowBodySchema,
        body,
        'request body',
      )

      const row = dbCreateCIRun({
        workflow: validated.workflow,
        repo: validated.repo,
        branch: validated.branch,
        author: authResult.address,
      })

      set.status = 201
      return transformCIRun(row)
    },
    {
      detail: {
        tags: ['ci'],
        summary: 'Trigger workflow',
        description: 'Trigger a new CI/CD workflow run',
      },
    },
  )
  .get(
    '/:runId',
    async ({ params, set }) => {
      const validated = expectValid(CIRunParamsSchema, params, 'params')
      const row = getCIRun(validated.runId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `CI run ${validated.runId} not found`,
          },
        }
      }
      return transformCIRun(row)
    },
    {
      detail: {
        tags: ['ci'],
        summary: 'Get CI run',
        description: 'Get details of a specific CI run',
      },
    },
  )
