/**
 * Git Repository Routes
 */

import { Elysia } from 'elysia'
import {
  CreateRepoBodySchema,
  expectValid,
  GitQuerySchema,
  RepoContentsParamsSchema,
  RepoContentsQuerySchema,
  RepoParamsSchema,
} from '../schemas'
import { dwsClient } from '../services/dws'
import { requireAuth } from '../validation/access-control'

export const gitRoutes = new Elysia({ prefix: '/api/git' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(GitQuerySchema, query, 'query params')
      const repos = await dwsClient.listRepositories(validated.owner)
      return repos
    },
    {
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

      const validated = expectValid(CreateRepoBodySchema, body, 'request body')

      const repo = await dwsClient.createRepository({
        name: validated.name,
        description: validated.description,
        isPrivate: validated.isPrivate ?? false,
      })

      return repo
    },
    {
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
      const validated = expectValid(RepoParamsSchema, params, 'params')
      const repo = await dwsClient.getRepository(
        validated.owner,
        validated.repo,
      )
      return repo
    },
    {
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
      const validatedParams = expectValid(
        RepoContentsParamsSchema,
        params,
        'params',
      )
      const validatedQuery = expectValid(
        RepoContentsQuerySchema,
        query,
        'query params',
      )
      const path = validatedParams['*'] || ''
      const ref = validatedQuery.ref || 'main'
      const files = await dwsClient.getRepoFiles(
        validatedParams.owner,
        validatedParams.repo,
        path,
        ref,
      )
      return files
    },
    {
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
      const validatedParams = expectValid(
        RepoContentsParamsSchema,
        params,
        'params',
      )
      const validatedQuery = expectValid(
        RepoContentsQuerySchema,
        query,
        'query params',
      )
      const path = validatedParams['*'] || ''
      const ref = validatedQuery.ref || 'main'
      const content = await dwsClient.getFileContent(
        validatedParams.owner,
        validatedParams.repo,
        path,
        ref,
      )
      set.headers['content-type'] = 'text/plain'
      return content
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Get file content',
        description: 'Get raw content of a file in a repository',
      },
    },
  )
