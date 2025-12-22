/**
 * Package Registry Routes
 */

import { Elysia } from 'elysia'
import {
  CreatePackageBodySchema,
  expectValid,
  PackageParamsSchema,
  PackagesQuerySchema,
  PackageVersionQuerySchema,
} from '../schemas'
import { dwsClient } from '../services/dws'
import { requireAuth } from '../validation/access-control'

export const packagesRoutes = new Elysia({ prefix: '/api/packages' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(PackagesQuerySchema, query, 'query params')
      const packages = await dwsClient.searchPackages(validated.q || '')
      return packages
    },
    {
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

      const validated = expectValid(
        CreatePackageBodySchema,
        body,
        'request body',
      )

      const pkg = {
        name: validated.name,
        version: validated.version,
        description: validated.description,
        author: authResult.address,
        license: validated.license,
        publishedAt: Date.now(),
      }

      set.status = 201
      return pkg
    },
    {
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
      const validatedParams = expectValid(PackageParamsSchema, params, 'params')
      const validatedQuery = expectValid(
        PackageVersionQuerySchema,
        query,
        'query params',
      )
      const pkg = await dwsClient.getPackage(
        validatedParams.name,
        validatedQuery.version,
      )
      return pkg
    },
    {
      detail: {
        tags: ['packages'],
        summary: 'Get package',
        description: 'Get details of a specific package',
      },
    },
  )
