/** CI Routes */

import { Elysia } from 'elysia'
import {
  CIQuerySchema,
  CIRunParamsSchema,
  expectValid,
  TriggerWorkflowBodySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface CIRun {
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
  jobs: Array<{
    name: string
    status: string
    duration?: number
  }>
  createdAt: number
  updatedAt: number
}

export const ciRoutes = new Elysia({ prefix: '/api/ci' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(CIQuerySchema, query, 'query params')
      const page = parseInt(validated.page || '1', 10)

      const runs: CIRun[] = []

      return { runs, total: runs.length, page }
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

      const run: CIRun = {
        id: `run-${Date.now()}`,
        workflow: validated.workflow,
        branch: validated.branch,
        status: 'queued',
        commit: '',
        commitMessage: '',
        author: '',
        startedAt: Date.now(),
        jobs: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      set.status = 201
      return run
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
      set.status = 404
      return {
        error: {
          code: 'NOT_FOUND',
          message: `CI run ${validated.runId} not found`,
        },
      }
    },
    {
      detail: {
        tags: ['ci'],
        summary: 'Get CI run',
        description: 'Get details of a specific CI run',
      },
    },
  )
