/** Git Routes */

import { Elysia } from 'elysia'
import {
  CreateRepoBodySchema,
  expectValid,
  GitCommitsQuerySchema,
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
  .get(
    '/:owner/:repo/commits',
    async ({ params, query }) => {
      const validated = expectValid(RepoParamsSchema, params, 'params')
      const validatedQuery = expectValid(
        GitCommitsQuerySchema,
        query,
        'query params',
      )
      const ref = validatedQuery.ref || 'main'
      const commits = await dwsClient.getRepoCommits(
        validated.owner,
        validated.repo,
        ref,
      )
      return commits
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Get commits',
        description: 'Get commits for a repository',
      },
    },
  )
  .get(
    '/:owner/:repo/branches',
    async ({ params }) => {
      const validated = expectValid(RepoParamsSchema, params, 'params')
      const branches = await dwsClient.getRepoBranches(
        validated.owner,
        validated.repo,
      )
      return branches
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Get branches',
        description: 'Get branches for a repository',
      },
    },
  )
  .post(
    '/:owner/:repo/star',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const validated = expectValid(RepoParamsSchema, params, 'params')
      await dwsClient.starRepository(validated.owner, validated.repo)
      return { success: true }
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Star repository',
        description: 'Star a repository',
      },
    },
  )
  .post(
    '/:owner/:repo/fork',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const validated = expectValid(RepoParamsSchema, params, 'params')
      const forked = await dwsClient.forkRepository(
        validated.owner,
        validated.repo,
        authResult.address,
      )
      set.status = 201
      return forked
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Fork repository',
        description: 'Fork a repository',
      },
    },
  )
