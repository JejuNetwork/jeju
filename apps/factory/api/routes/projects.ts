/** Projects Routes */

import { Elysia } from 'elysia'
import {
  createProject as dbCreateProject,
  createTask as dbCreateTask,
  listProjects as dbListProjects,
  updateTask as dbUpdateTask,
  getProject,
  getProjectTasks,
  type ProjectRow,
  type TaskRow,
} from '../db/client'
import {
  CreateProjectBodySchema,
  CreateTaskBodySchema,
  expectValid,
  ProjectsQuerySchema,
  UpdateTaskBodySchema,
} from '../schemas'
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
