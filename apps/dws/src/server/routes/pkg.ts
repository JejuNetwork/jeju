/**
 * Package Registry Routes (JejuPkg) - npm CLI compatible API
 * Consolidated with upstream proxy and full caching
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import {
  recordPackageDownload,
  recordPackagePublish,
} from '../../pkg/leaderboard-integration'
import type { PkgRegistryManager } from '../../pkg/registry-manager'
import type {
  CacheConfig,
  PackageManifest,
  PkgPublishPayload,
  PkgSearchResult,
  UpstreamRegistryConfig,
} from '../../pkg/types'
import { UpstreamProxy } from '../../pkg/upstream'
import type { BackendManager } from '../../storage/backends'

interface PkgContext {
  registryManager: PkgRegistryManager
  backend: BackendManager
  upstreamProxy?: UpstreamProxy
}

const DEFAULT_UPSTREAM_CONFIG: UpstreamRegistryConfig = {
  url: 'https://registry.npmjs.org',
  timeout: 30000,
  retries: 3,
  cacheAllPackages: true,
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  maxSize: 10000,
  defaultTTL: 3600000, // 1 hour
  tarballTTL: 86400000 * 30, // 30 days (tarballs are immutable)
  searchTTL: 300000, // 5 minutes
}

export function createPkgRouter(ctx: PkgContext) {
  const { registryManager, backend } = ctx

  // Initialize upstream proxy if not provided
  const upstreamProxy =
    ctx.upstreamProxy ||
    new UpstreamProxy({
      backend,
      upstream: DEFAULT_UPSTREAM_CONFIG,
      cache: DEFAULT_CACHE_CONFIG,
    })

  return (
    new Elysia({ name: 'pkg', prefix: '/pkg' })
      .get('/health', () => ({ service: 'dws-pkg', status: 'healthy' }))

      .get('/-/ping', () => ({}))

      .get(
        '/-/whoami',
        ({ headers, set }) => {
          const address = headers['x-jeju-address']
          if (!address) {
            set.status = 401
            return { error: 'Authentication required' }
          }
          return { username: address }
        },
        {
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Search packages (local + upstream)
      .get(
        '/-/v1/search',
        async ({ query }) => {
          const text = query.text || ''
          const size = parseInt(query.size || '20', 10)
          const from = parseInt(query.from || '0', 10)

          const localPackages = await registryManager.searchPackages(
            text,
            from,
            size,
          )

          const result: PkgSearchResult = {
            objects: localPackages.map((pkg) => ({
              package: {
                name: registryManager.getFullName(pkg.name, pkg.scope),
                scope: pkg.scope || undefined,
                version: '0.0.0',
                description: pkg.description,
                date: new Date(Number(pkg.updatedAt) * 1000).toISOString(),
                publisher: { username: pkg.owner },
              },
              score: {
                final: 1,
                detail: { quality: 1, popularity: 1, maintenance: 1 },
              },
              searchScore: 1,
            })),
            total: localPackages.length,
            time: new Date().toISOString(),
          }

          return result
        },
        {
          query: t.Object({
            text: t.Optional(t.String()),
            size: t.Optional(t.String()),
            from: t.Optional(t.String()),
          }),
        },
      )

      // User login/registration (npm CLI compatible - for compatibility)
      .put(
        '/-/user/:user',
        async ({ body }) => {
          return {
            ok: true,
            id: `org.couchdb.user:${body.name}`,
            rev: '1',
            token: `jeju-pkg-token-${body.name}`,
          }
        },
        {
          params: t.Object({
            user: t.String(),
          }),
          body: t.Object({
            name: t.String(),
            password: t.String(),
            email: t.Optional(t.String()),
          }),
        },
      )

      .delete('/-/user/token/:token', () => ({ ok: true }), {
        params: t.Object({
          token: t.String(),
        }),
      })

      // Cache stats endpoint
      .get('/-/cache/stats', () => {
        const stats = upstreamProxy.getCacheStats()
        return stats
      })

      // Manual cache invalidation
      .delete(
        '/-/cache/:package',
        ({ params }) => {
          const packageName = params.package
            .replace('%2f', '/')
            .replace('%2F', '/')
          upstreamProxy.invalidateCache(packageName)
          return { ok: true, invalidated: packageName }
        },
        {
          params: t.Object({
            package: t.String(),
          }),
        },
      )

      // Sync package from upstream
      .post(
        '/-/sync/:package',
        async ({ params, body }) => {
          const packageName = params.package
            .replace('%2f', '/')
            .replace('%2F', '/')
          const versions = body?.versions

          const result = await upstreamProxy.syncPackage(packageName, {
            versions,
          })
          return result
        },
        {
          params: t.Object({
            package: t.String(),
          }),
          body: t.Optional(
            t.Object({
              versions: t.Optional(t.Number()),
            }),
          ),
        },
      )

      // Tarball download - must come before catch-all
      .get(
        '/:package/-/:tarball',
        async ({ params, headers, set }) => {
          const fullName = params.package
            .replace('%2f', '/')
            .replace('%2F', '/')
          const tarballName = params.tarball
          const user = headers['x-jeju-address'] as Address | undefined

          const versionMatch = tarballName.match(/-(\d+\.\d+\.\d+[^.]*).tgz$/)
          if (!versionMatch) {
            set.status = 400
            return { error: 'Invalid tarball name' }
          }

          const version = versionMatch[1]

          // Try local first
          const localPkg = await registryManager.getPackageByName(fullName)
          if (localPkg) {
            const ver = await registryManager.getVersion(
              localPkg.packageId,
              version,
            )
            if (ver) {
              const tarball = await backend.download(ver.tarballCid)
              if (user) {
                recordPackageDownload(
                  user,
                  localPkg.packageId,
                  fullName,
                  version,
                )
              }
              return new Response(new Uint8Array(tarball.content), {
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'Content-Disposition': `attachment; filename="${tarballName}"`,
                  'Cache-Control': 'public, max-age=31536000, immutable', // Tarballs are immutable
                },
              })
            }
          }

          // Try upstream with caching
          const upstreamTarball = await upstreamProxy.getTarball(
            fullName,
            version,
          )
          if (upstreamTarball) {
            return new Response(new Uint8Array(upstreamTarball), {
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${tarballName}"`,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Served-From': 'upstream-cache',
              },
            })
          }

          set.status = 404
          return { error: 'Package not found' }
        },
        {
          params: t.Object({
            package: t.String(),
            tarball: t.String(),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Specific version metadata - handle scoped packages
      .get(
        '/@:scope/:name/:version',
        async ({ params, set }) => {
          const fullName = `@${params.scope}/${params.name}`
          const version = params.version

          // Try local first
          const localMetadata = await registryManager
            .getPkgMetadata(fullName)
            .catch(() => null)
          if (localMetadata?.versions[version]) {
            return localMetadata.versions[version]
          }

          // Try upstream
          const upstreamVersion = await upstreamProxy.getVersionMetadata(
            fullName,
            version,
          )
          if (upstreamVersion) {
            set.headers['X-Served-From'] = 'upstream-cache'
            return upstreamVersion
          }

          throw new Error('Not found')
        },
        {
          params: t.Object({
            scope: t.String(),
            name: t.String(),
            version: t.String(),
          }),
        },
      )

      // Unscoped package version metadata
      .get(
        '/:package/:version',
        async ({ params, set }) => {
          const packageName = params.package
          const version = params.version

          // Skip internal routes
          if (packageName.startsWith('-')) return { ok: true }

          // Try local first
          const localMetadata = await registryManager
            .getPkgMetadata(packageName)
            .catch(() => null)
          if (localMetadata?.versions[version]) {
            return localMetadata.versions[version]
          }

          // Try upstream
          const upstreamVersion = await upstreamProxy.getVersionMetadata(
            packageName,
            version,
          )
          if (upstreamVersion) {
            set.headers['X-Served-From'] = 'upstream-cache'
            return upstreamVersion
          }

          throw new Error('Not found')
        },
        {
          params: t.Object({
            package: t.String(),
            version: t.String(),
          }),
        },
      )

      // Publish package
      .put(
        '/:package',
        async ({ params, body, headers, set }) => {
          const publisher = headers['x-jeju-address']
          if (!publisher) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          const fullName = params.package
            .replace('%2f', '/')
            .replace('%2F', '/')
          const publishPayload = body as PkgPublishPayload

          const versionKey = Object.keys(publishPayload.versions)[0]
          const versionData = publishPayload.versions[versionKey]
          if (!versionData) throw new Error('No version data provided')

          const attachmentKey = Object.keys(publishPayload._attachments)[0]
          const attachment = publishPayload._attachments[attachmentKey]
          if (!attachment) throw new Error('No attachment provided')

          const tarball = Buffer.from(attachment.data, 'base64')

          const manifest: PackageManifest = {
            name: versionData.name,
            version: versionData.version,
            description: versionData.description,
            main: versionData.main,
            types: versionData.types,
            module: versionData.module,
            exports: versionData.exports,
            scripts: versionData.scripts,
            dependencies: versionData.dependencies,
            devDependencies: versionData.devDependencies,
            peerDependencies: versionData.peerDependencies,
            optionalDependencies: versionData.optionalDependencies,
            bundledDependencies: versionData.bundledDependencies,
            engines: versionData.engines,
            os: versionData.os,
            cpu: versionData.cpu,
            keywords: versionData.keywords,
            author: versionData.author,
            contributors: versionData.contributors,
            license: versionData.license,
            homepage: versionData.homepage,
            repository: versionData.repository,
            bugs: versionData.bugs,
            funding: versionData.funding,
            bin: versionData.bin,
            directories: versionData.directories,
          }

          const result = await registryManager.publish(
            fullName,
            manifest,
            tarball,
            publisher as Address,
          )
          recordPackagePublish(
            publisher as Address,
            result.packageId,
            fullName,
            manifest.version,
          )

          return {
            ok: true,
            id: fullName,
            rev: `1-${result.versionId.slice(2, 10)}`,
          }
        },
        {
          params: t.Object({
            package: t.String(),
          }),
          body: t.Unknown(), // PkgPublishPayload is complex, use Unknown
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Deprecate package version
      .delete(
        '/:package/-rev/:rev',
        async ({ params, headers, set }) => {
          const publisher = headers['x-jeju-address']
          if (!publisher) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          const fullName = params.package
            .replace('%2f', '/')
            .replace('%2F', '/')

          const pkg = await registryManager.getPackageByName(fullName)
          if (!pkg) throw new Error('Package not found')

          // Check ownership
          if (pkg.owner.toLowerCase() !== publisher.toLowerCase()) {
            throw new Error('Not authorized')
          }

          // Deprecation requires on-chain transaction (not yet implemented)
          set.status = 501
          return {
            error: 'Package deprecation not available',
            message:
              'On-chain package deprecation is not yet implemented. Contact maintainers to deprecate packages.',
          }
        },
        {
          params: t.Object({
            package: t.String(),
            rev: t.String(),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Scoped package metadata
      .get(
        '/@:scope/:name',
        async ({ params, set }) => {
          const fullName = `@${params.scope}/${params.name}`

          // Try local first
          const localMetadata = await registryManager
            .getPkgMetadata(fullName)
            .catch(() => null)
          if (localMetadata) {
            set.headers['Content-Type'] = 'application/json'
            return localMetadata
          }

          // Try upstream with caching
          const upstreamMetadata =
            await upstreamProxy.getPackageMetadata(fullName)
          if (upstreamMetadata) {
            set.headers['Content-Type'] = 'application/json'
            set.headers['X-Served-From'] = 'upstream-cache'
            set.headers['Cache-Control'] = 'public, max-age=300'
            return upstreamMetadata
          }

          throw new Error('Not found')
        },
        {
          params: t.Object({
            scope: t.String(),
            name: t.String(),
          }),
        },
      )

      // Package metadata (unscoped, catch-all, must be last)
      .get(
        '/:package',
        async ({ params, set }) => {
          const fullName = params.package
            .replace('%2f', '/')
            .replace('%2F', '/')

          if (fullName.startsWith('-/')) return { ok: true }

          // Try local first
          const localMetadata = await registryManager
            .getPkgMetadata(fullName)
            .catch(() => null)
          if (localMetadata) {
            set.headers['Content-Type'] = 'application/json'
            return localMetadata
          }

          // Try upstream with caching
          const upstreamMetadata =
            await upstreamProxy.getPackageMetadata(fullName)
          if (upstreamMetadata) {
            set.headers['Content-Type'] = 'application/json'
            set.headers['X-Served-From'] = 'upstream-cache'
            set.headers['Cache-Control'] = 'public, max-age=300'
            return upstreamMetadata
          }

          throw new Error('Not found')
        },
        {
          params: t.Object({
            package: t.String(),
          }),
        },
      )
  )
}

export type PkgRoutes = ReturnType<typeof createPkgRouter>

// Export alias for backwards compatibility
export { createPkgRouter as createNpmRouter }
