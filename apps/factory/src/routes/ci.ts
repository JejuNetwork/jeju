/**
 * CI/CD Routes
 */

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

      const runs: CIRun[] = [
        {
          id: 'run-1',
          workflow: 'Build & Test',
          status: 'success',
          conclusion: 'success',
          branch: 'main',
          commit: 'abc1234',
          commitMessage: 'feat: add new feature',
          author: 'alice.eth',
          duration: 245,
          startedAt: Date.now() - 1 * 60 * 60 * 1000,
          completedAt: Date.now() - 1 * 60 * 60 * 1000 + 245000,
          jobs: [
            { name: 'Build', status: 'success', duration: 120 },
            { name: 'Test', status: 'success', duration: 90 },
            { name: 'Deploy', status: 'success', duration: 35 },
          ],
          createdAt: Date.now() - 1 * 60 * 60 * 1000,
          updatedAt: Date.now() - 1 * 60 * 60 * 1000 + 245000,
        },
        {
          id: 'run-2',
          workflow: 'Build & Test',
          status: 'running',
          branch: 'feature/auth',
          commit: 'def5678',
          commitMessage: 'wip: auth flow',
          author: 'bob.eth',
          startedAt: Date.now() - 5 * 60 * 1000,
          jobs: [
            { name: 'Build', status: 'success', duration: 120 },
            { name: 'Test', status: 'running' },
            { name: 'Deploy', status: 'pending' },
          ],
          createdAt: Date.now() - 5 * 60 * 1000,
          updatedAt: Date.now() - 5 * 60 * 1000,
        },
      ]

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
    async ({ params }) => {
      const validated = expectValid(CIRunParamsSchema, params, 'params')
      const run: CIRun = {
        id: validated.runId,
        workflow: 'Build & Test',
        status: 'success',
        branch: 'main',
        commit: 'abc1234',
        commitMessage: 'feat: example',
        author: 'alice.eth',
        duration: 245,
        startedAt: Date.now() - 1 * 60 * 60 * 1000,
        completedAt: Date.now(),
        jobs: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      return run
    },
    {
      detail: {
        tags: ['ci'],
        summary: 'Get CI run',
        description: 'Get details of a specific CI run',
      },
    },
  )
