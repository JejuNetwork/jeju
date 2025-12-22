/**
 * Repository Settings Routes
 */

import { Elysia } from 'elysia'
import {
  AddCollaboratorBodySchema,
  AddWebhookBodySchema,
  expectValid,
  RepoSettingsParamsSchema,
  TransferRepoBodySchema,
  UpdateRepoSettingsBodySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface RepoBranch {
  name: string
  protected: boolean
  default: boolean
}

interface RepoWebhook {
  id: string
  url: string
  events: string[]
  active: boolean
  createdAt: number
}

interface RepoCollaborator {
  login: string
  avatar: string
  permission: 'read' | 'write' | 'admin'
}

interface RepoSettings {
  name: string
  description: string
  visibility: 'public' | 'private'
  defaultBranch: string
  branches: RepoBranch[]
  webhooks: RepoWebhook[]
  collaborators: RepoCollaborator[]
  hasIssues: boolean
  hasWiki: boolean
  hasDiscussions: boolean
  allowMergeCommit: boolean
  allowSquashMerge: boolean
  allowRebaseMerge: boolean
  deleteBranchOnMerge: boolean
  archived: boolean
}

export const repoSettingsRoutes = new Elysia({
  prefix: '/api/git/:owner/:repo/settings',
})
  .get(
    '/',
    async ({ params }) => {
      const validated = expectValid(RepoSettingsParamsSchema, params, 'params')

      const settings: RepoSettings = {
        name: validated.repo,
        description: 'Repository description',
        visibility: 'public',
        defaultBranch: 'main',
        branches: [
          { name: 'main', protected: true, default: true },
          { name: 'develop', protected: false, default: false },
        ],
        webhooks: [],
        collaborators: [
          {
            login: 'owner.eth',
            avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
            permission: 'admin',
          },
        ],
        hasIssues: true,
        hasWiki: false,
        hasDiscussions: true,
        allowMergeCommit: true,
        allowSquashMerge: true,
        allowRebaseMerge: true,
        deleteBranchOnMerge: false,
        archived: false,
      }

      return settings
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Get repo settings',
        description: 'Get settings for a repository',
      },
    },
  )
  .patch(
    '/',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(RepoSettingsParamsSchema, params, 'params')
      expectValid(UpdateRepoSettingsBodySchema, body, 'request body')

      return { success: true }
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Update repo settings',
        description: 'Update settings for a repository',
      },
    },
  )
  .post(
    '/collaborators',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(RepoSettingsParamsSchema, params, 'params')
      const validated = expectValid(
        AddCollaboratorBodySchema,
        body,
        'request body',
      )

      const collaborator: RepoCollaborator = {
        login: validated.login,
        avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${validated.login}`,
        permission: validated.permission,
      }

      set.status = 201
      return collaborator
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Add collaborator',
        description: 'Add a collaborator to a repository',
      },
    },
  )
  .delete(
    '/collaborators/:login',
    async ({ headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      return { success: true }
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Remove collaborator',
        description: 'Remove a collaborator from a repository',
      },
    },
  )
  .post(
    '/webhooks',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(RepoSettingsParamsSchema, params, 'params')
      const validated = expectValid(AddWebhookBodySchema, body, 'request body')

      const webhook: RepoWebhook = {
        id: `webhook-${Date.now()}`,
        url: validated.url,
        events: validated.events,
        active: true,
        createdAt: Date.now(),
      }

      set.status = 201
      return webhook
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Add webhook',
        description: 'Add a webhook to a repository',
      },
    },
  )
  .delete(
    '/webhooks/:webhookId',
    async ({ headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      return { success: true }
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Delete webhook',
        description: 'Delete a webhook from a repository',
      },
    },
  )
  .post(
    '/transfer',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(RepoSettingsParamsSchema, params, 'params')
      expectValid(TransferRepoBodySchema, body, 'request body')

      return { success: true }
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Transfer repository',
        description: 'Transfer repository ownership',
      },
    },
  )
  .delete(
    '/',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(RepoSettingsParamsSchema, params, 'params')

      return { success: true }
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Delete repository',
        description: 'Delete a repository',
      },
    },
  )
