/** Projects Routes */

import { Elysia } from 'elysia'
import type { Address } from 'viem'
import type { Project, ProjectTask } from '../../lib/types'
import {
  createProject as dbCreateProject,
  createTask as dbCreateTask,
  listProjects as dbListProjects,
  updateTask as dbUpdateTask,
  deleteProjectChannel,
  getProject,
  getProjectChannel,
  getProjectTasks,
  type ProjectRow,
  setProjectChannel,
  type TaskRow,
} from '../db/client'
import {
  CreateProjectBodySchema,
  CreateTaskBodySchema,
  expectValid,
  ProjectsQuerySchema,
  UpdateTaskBodySchema,
} from '../schemas'
import * as farcasterService from '../services/farcaster'
import { requireAuth } from '../validation/access-control'

export type { Project, ProjectTask }

interface TaskStats {
  total: number
  completed: number
  inProgress: number
  pending: number
}

function transformTask(row: TaskRow): ProjectTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    assignee: row.assignee ?? undefined,
    dueDate: row.due_date ?? undefined,
  }
}

function transformProject(row: ProjectRow, taskStats?: TaskStats): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    owner: row.owner as Address,
    members: row.members,
    tasks: taskStats ?? { total: 0, completed: 0, inProgress: 0, pending: 0 },
    milestones: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function getTaskStats(projectId: string): TaskStats {
  const tasks = getProjectTasks(projectId)
  return {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
  }
}

export const projectsRoutes = new Elysia({ prefix: '/api/projects' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(ProjectsQuerySchema, query, 'query params')
      const page = Number.parseInt(validated.page ?? '1', 10)
      const limit = Number.parseInt(validated.limit ?? '20', 10)

      const result = dbListProjects({
        status: validated.status,
        owner: validated.owner,
        page,
        limit,
      })

      const projects = result.projects.map((row) =>
        transformProject(row, getTaskStats(row.id)),
      )

      return { projects, total: result.total, page, limit }
    },
    { detail: { tags: ['projects'], summary: 'List projects' } },
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
        CreateProjectBodySchema,
        body,
        'request body',
      )

      const row = dbCreateProject({
        name: validated.name,
        description: validated.description,
        visibility: validated.visibility,
        owner: authResult.address,
      })

      set.status = 201
      return transformProject(row)
    },
    { detail: { tags: ['projects'], summary: 'Create project' } },
  )
  .get(
    '/:projectId',
    async ({ params, set }) => {
      const row = getProject(params.projectId)
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Project ${params.projectId} not found`,
          },
        }
      }
      return transformProject(row, getTaskStats(row.id))
    },
    { detail: { tags: ['projects'], summary: 'Get project' } },
  )
  .get(
    '/:projectId/tasks',
    async ({ params, set }) => {
      const project = getProject(params.projectId)
      if (!project) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Project ${params.projectId} not found`,
          },
        }
      }
      const taskRows = getProjectTasks(params.projectId)
      const tasks = taskRows.map(transformTask)
      return { tasks, projectId: params.projectId }
    },
    { detail: { tags: ['projects'], summary: 'List project tasks' } },
  )
  .post(
    '/:projectId/tasks',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const project = getProject(params.projectId)
      if (!project) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Project ${params.projectId} not found`,
          },
        }
      }

      const validated = expectValid(CreateTaskBodySchema, body, 'request body')
      const row = dbCreateTask({
        projectId: params.projectId,
        title: validated.title,
        assignee: validated.assignee,
        dueDate: validated.dueDate,
      })

      set.status = 201
      return transformTask(row)
    },
    { detail: { tags: ['projects'], summary: 'Create task' } },
  )
  .patch(
    '/:projectId/tasks/:taskId',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const updates = expectValid(UpdateTaskBodySchema, body, 'request body')
      const row = dbUpdateTask(params.taskId, {
        title: updates.title,
        status: updates.status,
        assignee: updates.assignee,
        dueDate: updates.dueDate,
      })
      if (!row) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Task ${params.taskId} not found`,
          },
        }
      }
      return transformTask(row)
    },
    { detail: { tags: ['projects'], summary: 'Update task' } },
  )
  // ============================================================================
  // PROJECT FARCASTER CHANNEL
  // ============================================================================
  .get(
    '/:projectId/channel',
    async ({ params, set }) => {
      const project = getProject(params.projectId)
      if (!project) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Project ${params.projectId} not found`,
          },
        }
      }

      const channel = getProjectChannel(params.projectId)
      if (!channel) {
        return { channel: null }
      }

      return {
        channel: {
          id: channel.channel_id,
          url: channel.channel_url,
          createdAt: channel.created_at,
        },
      }
    },
    {
      detail: { tags: ['projects'], summary: 'Get project Farcaster channel' },
    },
  )
  .post(
    '/:projectId/channel',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const project = getProject(params.projectId)
      if (!project) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Project ${params.projectId} not found`,
          },
        }
      }

      // Check ownership
      if (project.owner.toLowerCase() !== authResult.address.toLowerCase()) {
        set.status = 403
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Only project owner can set channel',
          },
        }
      }

      const { channelId } = body as { channelId: string }
      const channelUrl = `https://warpcast.com/~/channel/${channelId}`

      const channel = setProjectChannel(params.projectId, channelId, channelUrl)

      set.status = 201
      return {
        success: true,
        channel: {
          id: channel.channel_id,
          url: channel.channel_url,
          createdAt: channel.created_at,
        },
      }
    },
    {
      detail: { tags: ['projects'], summary: 'Set project Farcaster channel' },
    },
  )
  .delete(
    '/:projectId/channel',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const project = getProject(params.projectId)
      if (!project) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Project ${params.projectId} not found`,
          },
        }
      }

      // Check ownership
      if (project.owner.toLowerCase() !== authResult.address.toLowerCase()) {
        set.status = 403
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Only project owner can remove channel',
          },
        }
      }

      deleteProjectChannel(params.projectId)
      return { success: true }
    },
    {
      detail: {
        tags: ['projects'],
        summary: 'Remove project Farcaster channel',
      },
    },
  )
  .get(
    '/:projectId/feed',
    async ({ params, query, headers, set }) => {
      const project = getProject(params.projectId)
      if (!project) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Project ${params.projectId} not found`,
          },
        }
      }

      const channel = getProjectChannel(params.projectId)
      if (!channel) {
        return {
          casts: [],
          message: 'No Farcaster channel configured for this project',
        }
      }

      // Get viewer FID if connected
      const authHeader = headers.authorization
      let viewerFid: number | undefined
      if (authHeader?.startsWith('Bearer ')) {
        const address = authHeader.slice(7) as Address
        const link = farcasterService.getLinkedFid(address)
        if (link) {
          viewerFid = link.fid
        }
      }

      const limit = query.limit ? parseInt(query.limit as string, 10) : 20
      const cursor = query.cursor as string | undefined

      const feed = await farcasterService.getChannelFeed(channel.channel_id, {
        limit,
        cursor,
        viewerFid,
      })

      return {
        casts: feed.casts,
        cursor: feed.cursor,
        channel: {
          id: channel.channel_id,
          url: channel.channel_url,
        },
      }
    },
    { detail: { tags: ['projects'], summary: 'Get project Farcaster feed' } },
  )
