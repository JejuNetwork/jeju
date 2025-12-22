/**
 * Projects Routes
 */

import { Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  CreateProjectBodySchema,
  expectValid,
  ProjectsQuerySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface Project {
  id: string
  name: string
  description: string
  status: 'active' | 'archived' | 'completed' | 'on_hold'
  visibility: 'public' | 'private' | 'internal'
  owner: Address
  members: number
  tasks: {
    total: number
    completed: number
    inProgress: number
    pending: number
  }
  milestones: Array<{
    name: string
    progress: number
  }>
  createdAt: number
  updatedAt: number
}

export const projectsRoutes = new Elysia({ prefix: '/api/projects' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(ProjectsQuerySchema, query, 'query params')
      const page = parseInt(validated.page || '1', 10)
      const limit = parseInt(validated.limit || '20', 10)

      const projects: Project[] = [
        {
          id: '1',
          name: 'Jeju Protocol v2',
          description: 'Next generation of the Jeju Protocol',
          status: 'active',
          visibility: 'public',
          owner: '0x1234567890123456789012345678901234567890' as Address,
          members: 8,
          tasks: { total: 45, completed: 28, inProgress: 12, pending: 5 },
          milestones: [
            { name: 'Core Contracts', progress: 100 },
            { name: 'Frontend', progress: 65 },
            { name: 'Testing', progress: 40 },
          ],
          createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
        },
      ]

      return {
        projects,
        total: projects.length,
        page,
        limit,
      }
    },
    {
      detail: {
        tags: ['projects'],
        summary: 'List projects',
        description: 'Get a list of projects',
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
    {
      detail: {
        tags: ['projects'],
        summary: 'Create project',
        description: 'Create a new project',
      },
    },
  )
