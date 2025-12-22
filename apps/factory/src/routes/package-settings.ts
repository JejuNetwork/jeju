/**
 * Package Settings Routes
 */

import { Elysia } from 'elysia'
import {
  AddMaintainerBodySchema,
  CreateAccessTokenBodySchema,
  DeprecatePackageBodySchema,
  expectValid,
  PackageSettingsParamsSchema,
  UpdatePackageSettingsBodySchema,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface PackageMaintainer {
  login: string
  avatar: string
  role: 'owner' | 'maintainer'
}

interface PackageWebhook {
  id: string
  url: string
  events: ('publish' | 'unpublish' | 'download')[]
  active: boolean
  createdAt: number
}

interface PackageSettings {
  scope: string
  name: string
  description: string
  visibility: 'public' | 'private'
  maintainers: PackageMaintainer[]
  webhooks: PackageWebhook[]
  downloadCount: number
  publishEnabled: boolean
  deprecated: boolean
  deprecationMessage?: string
}

interface PackageAccessToken {
  id: string
  name: string
  token: string
  permissions: ('read' | 'write' | 'delete')[]
  createdAt: number
  expiresAt?: number
  lastUsed?: number
}

export const packageSettingsRoutes = new Elysia({
  prefix: '/api/packages/:scope/:name/settings',
})
  .get(
    '/',
    async ({ params }) => {
      const validated = expectValid(
        PackageSettingsParamsSchema,
        params,
        'params',
      )

      const settings: PackageSettings = {
        scope: validated.scope,
        name: validated.name,
        description: 'A package description',
        visibility: 'public',
        maintainers: [
          {
            login: 'owner.eth',
            avatar: 'https://avatars.githubusercontent.com/u/1?v=4',
            role: 'owner',
          },
        ],
        webhooks: [],
        downloadCount: 1234,
        publishEnabled: true,
        deprecated: false,
      }

      return settings
    },
    {
      detail: {
        tags: ['packages'],
        summary: 'Get package settings',
        description: 'Get settings for a package',
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

      expectValid(PackageSettingsParamsSchema, params, 'params')
      expectValid(UpdatePackageSettingsBodySchema, body, 'request body')

      return { success: true }
    },
    {
      detail: {
        tags: ['packages'],
        summary: 'Update package settings',
        description: 'Update settings for a package',
      },
    },
  )
  .post(
    '/maintainers',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(PackageSettingsParamsSchema, params, 'params')
      const validated = expectValid(
        AddMaintainerBodySchema,
        body,
        'request body',
      )

      const maintainer: PackageMaintainer = {
        login: validated.login,
        avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${validated.login}`,
        role: validated.role,
      }

      set.status = 201
      return maintainer
    },
    {
      detail: {
        tags: ['packages'],
        summary: 'Add maintainer',
        description: 'Add a maintainer to a package',
      },
    },
  )
  .delete(
    '/maintainers/:login',
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
        tags: ['packages'],
        summary: 'Remove maintainer',
        description: 'Remove a maintainer from a package',
      },
    },
  )
  .post(
    '/tokens',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(PackageSettingsParamsSchema, params, 'params')
      const validated = expectValid(
        CreateAccessTokenBodySchema,
        body,
        'request body',
      )

      const token: PackageAccessToken = {
        id: `token-${Date.now()}`,
        name: validated.name,
        token: `pkg_${Math.random().toString(36).slice(2)}`,
        permissions: validated.permissions,
        createdAt: Date.now(),
        expiresAt: validated.expiresIn
          ? Date.now() + validated.expiresIn * 1000
          : undefined,
      }

      set.status = 201
      return token
    },
    {
      detail: {
        tags: ['packages'],
        summary: 'Create access token',
        description: 'Create an access token for a package',
      },
    },
  )
  .delete(
    '/tokens/:tokenId',
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
        tags: ['packages'],
        summary: 'Revoke access token',
        description: 'Revoke an access token for a package',
      },
    },
  )
  .post(
    '/deprecate',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(PackageSettingsParamsSchema, params, 'params')
      expectValid(DeprecatePackageBodySchema, body, 'request body')

      return { success: true }
    },
    {
      detail: {
        tags: ['packages'],
        summary: 'Deprecate package',
        description: 'Mark a package as deprecated',
      },
    },
  )
  .post(
    '/undeprecate',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      expectValid(PackageSettingsParamsSchema, params, 'params')

      return { success: true }
    },
    {
      detail: {
        tags: ['packages'],
        summary: 'Undeprecate package',
        description: 'Remove deprecation from a package',
      },
    },
  )
