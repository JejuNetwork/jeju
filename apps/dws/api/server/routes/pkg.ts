/**
 * Package Registry Routes (JejuPkg) - npm CLI compatible API
 * Supports both on-chain and in-memory (local dev) modes
 */

import { createHash } from 'node:crypto'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import {
  recordPackageDownload,
  recordPackagePublish,
} from '../../pkg/leaderboard-integration'
import type { PkgRegistryManager } from '../../pkg/registry-manager'
import type {
  CacheConfig,
  PackageManifest,
  PkgPackageMetadata,
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

// In-memory package store for local development (when contract is not deployed)
interface LocalPackage {
  packageId: Hex
  name: string
  scope: string
  owner: Address
  description: string
  license: string
  versions: Map<string, LocalVersion>
  latestVersion: string
  createdAt: Date
  updatedAt: Date
}

interface LocalVersion {
  version: string
  tarball: Buffer
  manifest: PackageManifest
  publisher: Address
  publishedAt: Date
  shasum: string
  integrity: string
}

const localPackages = new Map<string, LocalPackage>()

function parsePackageName(fullName: string): { name: string; scope: string } {
  if (fullName.startsWith('@')) {
    const parts = fullName.split('/')
    return { scope: parts[0], name: parts.slice(1).join('/') }
  }
  return { name: fullName, scope: '' }
}

function getFullName(name: string, scope: string): string {
  return scope ? `${scope}/${name}` : name
}

function computeShasum(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex')
}

function computeIntegrity(data: Buffer): string {
  const hash = createHash('sha512').update(data).digest('base64')
  return `sha512-${hash}`
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
          const text = (query.text ?? '').toLowerCase()
          const size = parseInt(query.size ?? '20', 10)
          const from = parseInt(query.from ?? '0', 10)

          // Search in-memory packages first
          const inMemoryResults: Array<{
            name: string
            scope: string
            version: string
            description: string
            owner: string
            updatedAt: Date
          }> = []

          for (const [fullName, pkg] of localPackages) {
            if (
              text === '' ||
              fullName.toLowerCase().includes(text) ||
              pkg.description.toLowerCase().includes(text)
            ) {
              inMemoryResults.push({
                name: pkg.name,
                scope: pkg.scope,
                version: pkg.latestVersion,
                description: pkg.description,
                owner: pkg.owner,
                updatedAt: pkg.updatedAt,
              })
            }
          }

          // Try on-chain search (may fail if contract not deployed)
          let onChainPackages: Array<{
            name: string
            scope: string
            latestVersion: string
            description: string
            owner: string
            updatedAt: bigint
          }> = []
          try {
            const results = await registryManager.searchPackages(
              text,
              from,
              size,
            )
            onChainPackages = results.map((p) => ({
              name: p.name,
              scope: p.scope,
              latestVersion: p.latestVersion as string,
              description: p.description,
              owner: p.owner,
              updatedAt: p.updatedAt,
            }))
          } catch {
            // Contract not deployed, use in-memory only
          }

          // Combine results
          const allPackages = [
            ...inMemoryResults.map((pkg) => ({
              name: getFullName(pkg.name, pkg.scope),
              scope: pkg.scope || undefined,
              version: pkg.version,
              description: pkg.description,
              date: pkg.updatedAt.toISOString(),
              publisher: { username: pkg.owner },
            })),
            ...onChainPackages.map((pkg) => ({
              name: registryManager.getFullName(pkg.name, pkg.scope),
              scope: pkg.scope || undefined,
              version: pkg.latestVersion,
              description: pkg.description,
              date: new Date(Number(pkg.updatedAt) * 1000).toISOString(),
              publisher: { username: pkg.owner },
            })),
          ]

          // Apply pagination
          const paginated = allPackages.slice(from, from + size)

          const result: PkgSearchResult = {
            objects: paginated.map((pkg) => ({
              package: pkg,
              score: {
                final: 1,
                detail: { quality: 1, popularity: 1, maintenance: 1 },
              },
              searchScore: 1,
            })),
            total: allPackages.length,
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

      // Scoped package tarball download (must come before unscoped)
      .get(
        '/@:scope/:name/-/:tarball',
        async ({ params, headers, set }) => {
          const fullName = `@${params.scope}/${params.name}`
          const tarballName = params.tarball
          const user = headers['x-jeju-address'] as Address | undefined

          const versionMatch = tarballName.match(/-(\d+\.\d+\.\d+[^.]*).tgz$/)
          if (!versionMatch) {
            set.status = 400
            return { error: 'Invalid tarball name' }
          }

          const version = versionMatch[1]

          // Try in-memory store first (for local dev packages)
          const inMemoryPkg = localPackages.get(fullName)
          if (inMemoryPkg) {
            const ver = inMemoryPkg.versions.get(version)
            if (ver) {
              if (user) {
                recordPackageDownload(
                  user,
                  inMemoryPkg.packageId,
                  fullName,
                  version,
                )
              }
              return new Response(new Uint8Array(ver.tarball), {
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'Content-Disposition': `attachment; filename="${tarballName}"`,
                  'Cache-Control': 'public, max-age=31536000, immutable',
                  'X-Served-From': 'local-memory',
                },
              })
            }
          }

          // Try on-chain then upstream
          try {
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
                    'Cache-Control': 'public, max-age=31536000, immutable',
                  },
                })
              }
            }
          } catch {
            // Contract not deployed
          }

          // Try upstream
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
            scope: t.String(),
            name: t.String(),
            tarball: t.String(),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Unscoped tarball download - must come before catch-all
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

          // Try in-memory store first (for local dev packages)
          const inMemoryPkg = localPackages.get(fullName)
          if (inMemoryPkg) {
            const ver = inMemoryPkg.versions.get(version)
            if (ver) {
              if (user) {
                recordPackageDownload(
                  user,
                  inMemoryPkg.packageId,
                  fullName,
                  version,
                )
              }
              return new Response(new Uint8Array(ver.tarball), {
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'Content-Disposition': `attachment; filename="${tarballName}"`,
                  'Cache-Control': 'public, max-age=31536000, immutable',
                  'X-Served-From': 'local-memory',
                },
              })
            }
          }

          // Try on-chain store
          try {
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
                    'Cache-Control': 'public, max-age=31536000, immutable',
                  },
                })
              }
            }
          } catch {
            // Contract not deployed, continue to upstream
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
          const localMetadata = await registryManager.getPkgMetadata(fullName)
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
          const localMetadata =
            await registryManager.getPkgMetadata(packageName)
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

          // Try on-chain first, fall back to in-memory for local dev
          try {
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
          } catch (error) {
            // Fall back to in-memory storage for local development
            const errorMsg =
              error instanceof Error ? error.message : String(error)
            if (
              errorMsg.includes('0x0000000000000000000000000000000000000000') ||
              errorMsg.includes('returned no data') ||
              errorMsg.includes('Wallet not configured')
            ) {
              console.log(
                '[PkgRouter] Using in-memory storage (contract not deployed)',
              )

              const { name, scope } = parsePackageName(fullName)
              const packageId = keccak256(toBytes(`${scope}/${name}`))
              const versionId = keccak256(
                toBytes(`${fullName}@${manifest.version}`),
              )

              let pkg = localPackages.get(fullName)
              if (!pkg) {
                pkg = {
                  packageId,
                  name,
                  scope,
                  owner: publisher as Address,
                  description: manifest.description ?? '',
                  license: manifest.license ?? '',
                  versions: new Map(),
                  latestVersion: manifest.version,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                }
                localPackages.set(fullName, pkg)
              }

              // Check for duplicate version
              if (pkg.versions.has(manifest.version)) {
                throw new Error(`Version ${manifest.version} already exists`)
              }

              // Store version
              pkg.versions.set(manifest.version, {
                version: manifest.version,
                tarball,
                manifest,
                publisher: publisher as Address,
                publishedAt: new Date(),
                shasum: computeShasum(tarball),
                integrity: computeIntegrity(tarball),
              })
              pkg.latestVersion = manifest.version
              pkg.updatedAt = new Date()

              recordPackagePublish(
                publisher as Address,
                packageId,
                fullName,
                manifest.version,
              )

              return {
                ok: true,
                id: fullName,
                rev: `1-${versionId.slice(2, 10)}`,
                mode: 'local',
              }
            }
            throw error
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

          // Try in-memory store first (for local dev)
          const inMemoryPkg = localPackages.get(fullName)
          if (inMemoryPkg) {
            set.headers['Content-Type'] = 'application/json'
            set.headers['X-Served-From'] = 'local-memory'
            return buildLocalPkgMetadata(inMemoryPkg)
          }

          // Try on-chain store
          try {
            const localMetadata = await registryManager.getPkgMetadata(fullName)
            if (localMetadata) {
              set.headers['Content-Type'] = 'application/json'
              return localMetadata
            }
          } catch {
            // Contract not deployed, continue to upstream
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

          // Try in-memory store first (for local dev)
          const inMemoryPkg = localPackages.get(fullName)
          if (inMemoryPkg) {
            set.headers['Content-Type'] = 'application/json'
            set.headers['X-Served-From'] = 'local-memory'
            return buildLocalPkgMetadata(inMemoryPkg)
          }

          // Try on-chain store
          try {
            const localMetadata = await registryManager.getPkgMetadata(fullName)
            if (localMetadata) {
              set.headers['Content-Type'] = 'application/json'
              return localMetadata
            }
          } catch {
            // Contract not deployed, continue to upstream
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

/**
 * Build npm-compatible package metadata from in-memory store
 */
function buildLocalPkgMetadata(pkg: LocalPackage): PkgPackageMetadata {
  const fullName = getFullName(pkg.name, pkg.scope)
  const versionRecords: Record<
    string,
    {
      name: string
      version: string
      description?: string
      main?: string
      types?: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      dist: {
        tarball: string
        shasum: string
        integrity: string
      }
      _id: string
      _npmUser: { name: string }
    }
  > = {}
  const timeRecords: Record<string, string> = {
    created: pkg.createdAt.toISOString(),
    modified: pkg.updatedAt.toISOString(),
  }

  for (const [version, ver] of pkg.versions) {
    const tarballName = `${pkg.name.replace('@', '').replace('/', '-')}-${version}.tgz`
    // Use non-encoded URL for scoped packages so routes match properly
    const tarballUrl = pkg.scope
      ? `http://127.0.0.1:4030/pkg/${pkg.scope}/${pkg.name}/-/${tarballName}`
      : `http://127.0.0.1:4030/pkg/${pkg.name}/-/${tarballName}`
    versionRecords[version] = {
      name: fullName,
      version,
      description: ver.manifest.description,
      main: ver.manifest.main,
      types: ver.manifest.types,
      dependencies: ver.manifest.dependencies,
      devDependencies: ver.manifest.devDependencies,
      dist: {
        tarball: tarballUrl,
        shasum: ver.shasum,
        integrity: ver.integrity,
      },
      _id: `${fullName}@${version}`,
      _npmUser: { name: ver.publisher },
    }
    timeRecords[version] = ver.publishedAt.toISOString()
  }

  return {
    _id: fullName,
    name: fullName,
    description: pkg.description,
    'dist-tags': {
      latest: pkg.latestVersion,
    },
    versions: versionRecords,
    time: timeRecords,
    maintainers: [{ name: pkg.owner }],
    license: pkg.license,
  }
}

export type PkgRoutes = ReturnType<typeof createPkgRouter>

// Export alias for backwards compatibility
export { createPkgRouter as createNpmRouter }
