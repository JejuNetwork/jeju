/** Projects Routes */

import { Elysia } from 'elysia'
import type { Project, ProjectTask } from '../../lib/types'
import {
  CreateProjectBodySchema,
  CreateTaskBodySchema,
  expectValid,
  ProjectsQuerySchema,
  UpdateTaskBodySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

export type { Project, ProjectTask }

export const projectsRoutes = new Elysia({ prefix: '/api/projects' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(ProjectsQuerySchema, query, 'query params')
      const page = Number.parseInt(validated.page ?? '1', 10)
      const limit = Number.parseInt(validated.limit ?? '20', 10)
      const projects: Project[] = []
      return { projects, total: projects.length, page, limit }
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
      const project: Project = {
        id: `project-${Date.now()}`,
        name: validated.name,
        description: validated.description,
        visibility: validated.visibility,
        status: 'active',
        owner: authResult.address,
        members: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tasks: { total: 0, completed: 0, inProgress: 0, pending: 0 },
        milestones: [],
      }
      set.status = 201
      return project
    },
    { detail: { tags: ['projects'], summary: 'Create project' } },
  )
  .get(
    '/:projectId',
    async ({ params, set }) => {
      set.status = 404
      return {
        error: {
          code: 'NOT_FOUND',
          message: `Project ${params.projectId} not found`,
        },
      }
    },
    { detail: { tags: ['projects'], summary: 'Get project' } },
  )
  .get(
    '/:projectId/tasks',
    async ({ params }) => {
      const tasks: ProjectTask[] = []
      return { tasks, projectId: params.projectId }
    },
    { detail: { tags: ['projects'], summary: 'List project tasks' } },
  )
  .post(
    '/:projectId/tasks',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const validated = expectValid(CreateTaskBodySchema, body, 'request body')
      const task: ProjectTask = {
        id: `task-${Date.now()}`,
        title: validated.title,
        status: 'pending',
        assignee: validated.assignee,
        dueDate: validated.dueDate,
      }
      set.status = 201
      return task
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
      const task: ProjectTask = {
        id: params.taskId,
        title: updates.title ?? 'Task',
        status: updates.status ?? 'pending',
        assignee: updates.assignee,
        dueDate: updates.dueDate,
      }
      return task
    },
    { detail: { tags: ['projects'], summary: 'Update task' } },
  )
