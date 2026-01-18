import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  addPackageMaintainer,
  createPackageToken,
  deprecatePackage,
  getPackageMaintainers,
  getPackageSettings,
  type MaintainerRow,
  type PackageSettingsRow,
  removePackageMaintainer,
  revokePackageToken,
  undeprecatePackage,
  upsertPackageSettings,
} from '../db/client'
import {
  AddMaintainerBodySchema,
  CreateAccessTokenBodySchema,
  DeprecatePackageBodySchema,
  expectValid,
  PackageSettingsParamsSchema,
  UpdatePackageSettingsBodySchema,
} from '../schemas'

// Schema for token permissions
const PermissionsSchema = z.array(z.string())

import { requireAuth } from '../validation/access-control'

export interface PackageMaintainer {
  login: string
  avatar: string
  role: 'owner' | 'maintainer'
}

export interface PackageSettings {
  scope: string
  name: string
  description: string
  visibility: 'public' | 'private'
  maintainers: PackageMaintainer[]
  webhooks: Array<{
    id: string
    url: string
    events: string[]
    active: boolean
    createdAt: number
  }>
  downloadCount: number
  publishEnabled: boolean
  deprecated: boolean
  deprecationMessage?: string
}

function transformSettings(
  row: PackageSettingsRow,
  maintainers: MaintainerRow[],
): PackageSettings {
  return {
    scope: row.scope,
    name: row.name,
    description: row.description ?? '',
    visibility: row.visibility,
    maintainers: maintainers.map((m) => ({
      login: m.login,
      avatar: m.avatar,
      role: m.role,
    })),
    webhooks: [], // Package webhooks not implemented yet
    downloadCount: row.download_count,
    publishEnabled: row.publish_enabled === 1,
    deprecated: row.deprecated === 1,
    deprecationMessage: row.deprecation_message ?? undefined,
  }
}

export const packageSettingsRoutes = new Elysia({
  prefix: '/api/package-settings/:scope/:name',
})
  .get(
    '/',
    async ({ params }) => {
      const validated = expectValid(
        PackageSettingsParamsSchema,
        params,
        'params',
      )

      let row = await getPackageSettings(validated.scope, validated.name)
      if (!row) {
        // Create default settings for new package
        row = await upsertPackageSettings(validated.scope, validated.name, {})
      }

      const maintainers = await getPackageMaintainers(
        validated.scope,
        validated.name,
      )

      return transformSettings(row, maintainers)
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

      const validatedParams = expectValid(
        PackageSettingsParamsSchema,
        params,
        'params',
      )
      const validatedBody = expectValid(
        UpdatePackageSettingsBodySchema,
        body,
        'request body',
      )

      await upsertPackageSettings(validatedParams.scope, validatedParams.name, {
        description: validatedBody.description,
        visibility: validatedBody.visibility,
        publishEnabled: validatedBody.publishEnabled,
      })

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

      const validatedParams = expectValid(
        PackageSettingsParamsSchema,
        params,
        'params',
      )
      const validated = expectValid(
        AddMaintainerBodySchema,
        body,
        'request body',
      )

      const row = await addPackageMaintainer(
        validatedParams.scope,
        validatedParams.name,
        {
          login: validated.login,
          avatar: `https://api.dicebear.com/7.x/identicon/svg?seed=${validated.login}`,
          role: validated.role,
        },
      )

      set.status = 201
      return {
        login: row.login,
        avatar: row.avatar,
        role: row.role,
      }
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
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const validatedParams = expectValid(
        PackageSettingsParamsSchema,
        {
          scope: params.scope,
          name: params.name,
        },
        'params',
      )

      const success = await removePackageMaintainer(
        validatedParams.scope,
        validatedParams.name,
        params.login,
      )
      if (!success) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: 'Maintainer not found' } }
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

      const validatedParams = expectValid(
        PackageSettingsParamsSchema,
        params,
        'params',
      )
      const validated = expectValid(
        CreateAccessTokenBodySchema,
        body,
        'request body',
      )

      const { row, plainToken } = await createPackageToken(
        validatedParams.scope,
        validatedParams.name,
        {
          tokenName: validated.name,
          permissions: validated.permissions,
          expiresAt: validated.expiresIn
            ? Date.now() + validated.expiresIn * 1000
            : undefined,
        },
      )

      set.status = 201
      return {
        id: row.id,
        name: row.token_name,
        token: plainToken,
        permissions: PermissionsSchema.parse(JSON.parse(row.permissions)),
        createdAt: row.created_at,
        expiresAt: row.expires_at ?? undefined,
      }
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
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      const success = await revokePackageToken(params.tokenId)
      if (!success) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: 'Token not found' } }
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

      const validatedParams = expectValid(
        PackageSettingsParamsSchema,
        params,
        'params',
      )
      const validatedBody = expectValid(
        DeprecatePackageBodySchema,
        body,
        'request body',
      )

      await deprecatePackage(
        validatedParams.scope,
        validatedParams.name,
        validatedBody.message,
      )

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

      const validatedParams = expectValid(
        PackageSettingsParamsSchema,
        params,
        'params',
      )

      await undeprecatePackage(validatedParams.scope, validatedParams.name)

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
