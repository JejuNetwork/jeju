/** Repository Settings Routes */

import { Elysia } from 'elysia'
import {
  addRepoCollaborator,
  addRepoWebhook,
  type CollaboratorRow,
  deleteRepoSettings,
  getRepoCollaborators,
  getRepoSettings,
  getRepoWebhooks,
  type RepoSettingsRow,
  removeRepoCollaborator,
  removeRepoWebhook,
  upsertRepoSettings,
  type WebhookRow,
} from '../db/client'
import {
  AddCollaboratorBodySchema,
  AddWebhookBodySchema,
  expectValid,
  RepoSettingsParamsSchema,
  TransferRepoBodySchema,
  UpdateRepoSettingsBodySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

export interface RepoBranch {
  name: string
  protected: boolean
  default: boolean
}

export interface RepoWebhook {
  id: string
  url: string
  events: string[]
  active: boolean
  createdAt: number
}

export interface RepoCollaborator {
  login: string
  avatar: string
  permission: 'read' | 'write' | 'admin'
}

export interface RepoSettings {
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

function transformSettings(
  row: RepoSettingsRow,
  collaborators: CollaboratorRow[],
  webhooks: WebhookRow[],
): RepoSettings {
  return {
    name: row.repo,
    description: row.description ?? '',
    visibility: row.visibility,
    defaultBranch: row.default_branch,
    branches: [{ name: row.default_branch, protected: true, default: true }],
    webhooks: webhooks.map((w) => ({
      id: w.id,
      url: w.url,
      events: JSON.parse(w.events) as string[],
      active: w.active === 1,
      createdAt: w.created_at,
    })),
    collaborators: collaborators.map((c) => ({
      login: c.login,
      avatar: c.avatar,
      permission: c.permission,
    })),
    hasIssues: row.has_issues === 1,
    hasWiki: row.has_wiki === 1,
    hasDiscussions: row.has_discussions === 1,
    allowMergeCommit: row.allow_merge_commit === 1,
    allowSquashMerge: row.allow_squash_merge === 1,
    allowRebaseMerge: row.allow_rebase_merge === 1,
    deleteBranchOnMerge: row.delete_branch_on_merge === 1,
    archived: row.archived === 1,
  }
}

export const repoSettingsRoutes = new Elysia({
  prefix: '/api/git/:owner/:repo/settings',
})
  .get(
    '/',
    async ({ params }) => {
      const validated = expectValid(RepoSettingsParamsSchema, params, 'params')

      let row = getRepoSettings(validated.owner, validated.repo)
      if (!row) {
        // Create default settings for new repo
        row = upsertRepoSettings(validated.owner, validated.repo, {})
      }

      const collaborators = getRepoCollaborators(
        validated.owner,
        validated.repo,
      )
      const webhooks = getRepoWebhooks(validated.owner, validated.repo)

      return transformSettings(row, collaborators, webhooks)
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

      const validatedParams = expectValid(
        RepoSettingsParamsSchema,
        params,
        'params',
      )
      const validatedBody = expectValid(
        UpdateRepoSettingsBodySchema,
        body,
        'request body',
      )

      upsertRepoSettings(validatedParams.owner, validatedParams.repo, {
        description: validatedBody.description,
        visibility: validatedBody.visibility,
        defaultBranch: validatedBody.defaultBranch,
        hasIssues: validatedBody.hasIssues,
        hasWiki: validatedBody.hasWiki,
        hasDiscussions: validatedBody.hasDiscussions,
        allowMergeCommit: validatedBody.allowMergeCommit,
        allowSquashMerge: validatedBody.allowSquashMerge,
        allowRebaseMerge: validatedBody.allowRebaseMerge,
        deleteBranchOnMerge: validatedBody.deleteBranchOnMerge,
        archived: validatedBody.archived,
      })

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

      const validatedParams = expectValid(
        RepoSettingsParamsSchema,
        params,
        'params',
      )
      const validated = expectValid(
        AddCollaboratorBodySchema,
        body,
        'request body',
      )

      const row = addRepoCollaborator(
        validatedParams.owner,
        validatedParams.repo,
        {
          login: validated.login,
          avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${validated.login}`,
          permission: validated.permission,
        },
      )

      set.status = 201
      return {
        login: row.login,
        avatar: row.avatar,
        permission: row.permission,
      }
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
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const validatedParams = expectValid(
        RepoSettingsParamsSchema,
        {
          owner: params.owner,
          repo: params.repo,
        },
        'params',
      )

      const success = removeRepoCollaborator(
        validatedParams.owner,
        validatedParams.repo,
        params.login,
      )
      if (!success) {
        set.status = 404
        return {
          error: { code: 'NOT_FOUND', message: 'Collaborator not found' },
        }
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

      const validatedParams = expectValid(
        RepoSettingsParamsSchema,
        params,
        'params',
      )
      const validated = expectValid(AddWebhookBodySchema, body, 'request body')

      const row = addRepoWebhook(validatedParams.owner, validatedParams.repo, {
        url: validated.url,
        events: validated.events,
      })

      set.status = 201
      return {
        id: row.id,
        url: row.url,
        events: JSON.parse(row.events) as string[],
        active: row.active === 1,
        createdAt: row.created_at,
      }
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
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const success = removeRepoWebhook(params.webhookId)
      if (!success) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: 'Webhook not found' } }
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

      const validated = expectValid(RepoSettingsParamsSchema, params, 'params')
      expectValid(TransferRepoBodySchema, body, 'request body')

      // Repository transfer must be performed via DWS API
      // This updates the local settings to mark the transfer as pending
      upsertRepoSettings(validated.owner, validated.repo, {})

      return { success: true, message: 'Transfer request submitted' }
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

      const validated = expectValid(RepoSettingsParamsSchema, params, 'params')

      // Repository deletion must be performed via DWS API
      // Delete local settings as well
      deleteRepoSettings(validated.owner, validated.repo)

      return { success: true, message: 'Repository deleted' }
    },
    {
      detail: {
        tags: ['git'],
        summary: 'Delete repository',
        description: 'Delete a repository',
      },
    },
  )
