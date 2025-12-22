/**
 * Package Registry Routes
 */

import { Elysia, t } from 'elysia'
import { dwsClient } from '../services/dws'
import { requireAuth } from '../validation/access-control'

export const packagesRoutes = new Elysia({ prefix: '/api/packages' })
  .get(
    '/',
    async ({ query }) => {
      const packages = await dwsClient.searchPackages(query.q || '')
      return packages
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
      }),
      detail: {
        tags: ['packages'],
        summary: 'Search packages',
        description: 'Search for packages in the registry',
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

      // Handle form data for package upload
      // In production, this would accept a tarball and metadata
      const pkg = {
        name: body.name,
        version: body.version,
        description: body.description,
        author: authResult.address,
        license: body.license,
        publishedAt: Date.now(),
      }

      set.status = 201
      return pkg
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 214 }),
        version: t.String({ pattern: '^\\d+\\.\\d+\\.\\d+(-.+)?$' }),
        description: t.Optional(t.String({ maxLength: 500 })),
        license: t.String({ minLength: 1 }),
      }),
      detail: {
        tags: ['packages'],
        summary: 'Publish package',
        description: 'Publish a new package to the registry',
      },
    },
  )
  .get(
    '/:name',
    async ({ params, query }) => {
      const pkg = await dwsClient.getPackage(params.name, query.version)
      return pkg
    },
    {
      params: t.Object({
        name: t.String(),
      }),
      query: t.Object({
        version: t.Optional(t.String()),
      }),
      detail: {
        tags: ['packages'],
        summary: 'Get package',
        description: 'Get details of a specific package',
      },
    },
  )
