/**
 * Container Registry Routes
 */

import { Elysia, t } from 'elysia'
import { requireAuth } from '../validation/access-control'

interface ContainerImage {
  id: string
  name: string
  tag: string
  digest: string
  size: number
  platform: string
  labels?: Record<string, string>
  downloads: number
  createdAt: number
  updatedAt: number
}

export const containersRoutes = new Elysia({ prefix: '/api/containers' })
  .get(
    '/',
    async () => {
      // Mock data - in production this would query the ContainerRegistry
      const containers: ContainerImage[] = [
        {
          id: '1',
          name: 'jeju/protocol',
          tag: 'latest',
          digest:
            'sha256:abc123def4567890123456789012345678901234567890123456789012345678',
          size: 156000000,
          platform: 'linux/amd64',
          downloads: 8420,
          createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        },
        {
          id: '2',
          name: 'jeju/gateway',
          tag: 'v1.2.0',
          digest:
            'sha256:def456abc1237890123456789012345678901234567890123456789012345678',
          size: 89000000,
          platform: 'linux/arm64',
          downloads: 3210,
          createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        },
      ]

      return { containers, total: containers.length }
    },
    {
      query: t.Object({
        org: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
      detail: {
        tags: ['containers'],
        summary: 'List containers',
        description: 'Get a list of container images',
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

      const container: ContainerImage = {
        id: `container-${Date.now()}`,
        name: body.name,
        tag: body.tag,
        digest: body.digest,
        size: body.size,
        platform: body.platform,
        labels: body.labels,
        downloads: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      set.status = 201
      return container
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 255 }),
        tag: t.String({ minLength: 1, maxLength: 128 }),
        digest: t.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
        size: t.Number({ minimum: 1 }),
        platform: t.String({ minLength: 1 }),
        labels: t.Optional(t.Record(t.String(), t.String())),
      }),
      detail: {
        tags: ['containers'],
        summary: 'Push container',
        description: 'Push a new container image to the registry',
      },
    },
  )
