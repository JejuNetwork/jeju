/**
 * Git Repository Routes
 */

import { Elysia, t } from 'elysia'
import { dwsClient } from '../services/dws'
import { requireAuth } from '../validation/access-control'

interface _Repository {
  id: string
  name: string
  description?: string
  owner: string
  isPrivate: boolean
  defaultBranch: string
  stars: number
  forks: number
  openIssues: number
  openPRs: number
  language?: string
  cloneUrl: string
  sshUrl: string
  createdAt: number
  updatedAt: number
  pushedAt?: number
}

export const gitRoutes = new Elysia({ prefix: '/api/git' })
  .get(
    '/',
    async ({ query }) => {
      const repos = await dwsClient.listRepositories(query.owner)
      return repos
    },
    {
      query: t.Object({
        owner: t.Optional(t.String()),
      }),
      detail: {
        tags: ['git'],
        summary: 'List repositories',
        description: 'Get a list of git repositories',
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

      const repo = await dwsClient.createRepository({
        name: body.name,
        description: body.description,
        isPrivate: body.isPrivate ?? false,
      })

      return repo
    },
    {
      body: t.Object({
        name: t.String({
          minLength: 1,
          maxLength: 100,
          pattern: '^[a-zA-Z0-9._-]+$',
        }),
        description: t.Optional(t.String({ maxLength: 500 })),
        isPrivate: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['git'],
        summary: 'Create repository',
        description: 'Create a new git repository',
      },
    },
  )
  .get(
    '/:owner/:repo',
    async ({ params }) => {
      const repo = await dwsClient.getRepository(params.owner, params.repo)
      return repo
    },
    {
      params: t.Object({
        owner: t.String(),
        repo: t.String(),
      }),
      detail: {
        tags: ['git'],
        summary: 'Get repository',
        description: 'Get details of a specific repository',
      },
    },
  )
  .get(
    '/:owner/:repo/contents/*',
    async ({ params, query }) => {
      const path = params['*'] || ''
      const ref = query.ref || 'main'
      const files = await dwsClient.getRepoFiles(
        params.owner,
        params.repo,
        path,
        ref,
      )
      return files
    },
    {
      params: t.Object({
        owner: t.String(),
        repo: t.String(),
        '*': t.Optional(t.String()),
      }),
      query: t.Object({
        ref: t.Optional(t.String()),
      }),
      detail: {
        tags: ['git'],
        summary: 'List repository contents',
        description: 'Get files and directories in a repository path',
      },
    },
  )
  .get(
    '/:owner/:repo/raw/*',
    async ({ params, query, set }) => {
      const path = params['*'] || ''
      const ref = query.ref || 'main'
      const content = await dwsClient.getFileContent(
        params.owner,
        params.repo,
        path,
        ref,
      )
      set.headers['content-type'] = 'text/plain'
      return content
    },
    {
      params: t.Object({
        owner: t.String(),
        repo: t.String(),
        '*': t.Optional(t.String()),
      }),
      query: t.Object({
        ref: t.Optional(t.String()),
      }),
      detail: {
        tags: ['git'],
        summary: 'Get file content',
        description: 'Get raw content of a file in a repository',
      },
    },
  )
