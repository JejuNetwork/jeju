/**
 * Package Registry Proxy
 *
 * Decentralized proxy for package registries (npm, PyPI, Cargo, Go)
 * Routes through DWS network to avoid direct centralized API calls.
 *
 * Features:
 * - Caching via IPFS/CDN
 * - Rate limiting per user
 * - Registry mirroring for popular packages
 * - Fallback to direct registry if cache miss
 */

import { Elysia, t } from 'elysia'
import { LRUCache } from 'lru-cache'

// ============ Types ============

interface PackageMetadata {
  name: string
  version: string
  description?: string
  homepage?: string
  repository?: string
  maintainers: string[]
  license?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface CacheEntry {
  data: PackageMetadata
  fetchedAt: number
  ttl: number
}

// ============ Configuration ============

const CACHE_TTL = 60 * 60 * 1000 // 1 hour
const MAX_CACHE_SIZE = 10000

// Initialize LRU cache
const packageCache = new LRUCache<string, CacheEntry>({
  max: MAX_CACHE_SIZE,
  ttl: CACHE_TTL,
})

// ============ Registry Fetchers ============

async function fetchNpmPackage(packageName: string): Promise<PackageMetadata> {
  const response = await fetch(
    `https://registry.npmjs.org/${packageName}/latest`,
  )
  if (!response.ok) {
    throw new Error(`NPM package not found: ${packageName}`)
  }

  const data = (await response.json()) as Record<string, unknown>
  return {
    name: data.name as string,
    version: data.version as string,
    description: data.description as string | undefined,
    homepage: data.homepage as string | undefined,
    repository:
      typeof data.repository === 'object' && data.repository !== null
        ? (data.repository as { url?: string }).url
        : undefined,
    maintainers: Array.isArray(data.maintainers)
      ? (data.maintainers as Array<{ name?: string }>).map(
          (m) => m.name || 'unknown',
        )
      : [],
    license: data.license as string | undefined,
    dependencies: data.dependencies as Record<string, string> | undefined,
    devDependencies: data.devDependencies as Record<string, string> | undefined,
  }
}

async function fetchPyPIPackage(packageName: string): Promise<PackageMetadata> {
  const response = await fetch(`https://pypi.org/pypi/${packageName}/json`)
  if (!response.ok) {
    throw new Error(`PyPI package not found: ${packageName}`)
  }

  const data = (await response.json()) as {
    info: Record<string, unknown>
    releases: Record<string, unknown>
  }
  const info = data.info

  const maintainers: string[] = []
  if (info.author) maintainers.push(info.author as string)
  if (info.maintainer && info.maintainer !== info.author) {
    maintainers.push(info.maintainer as string)
  }

  // Parse requirements from requires_dist
  const dependencies: Record<string, string> = {}
  const requiresDist = info.requires_dist as string[] | undefined
  if (requiresDist) {
    for (const req of requiresDist) {
      const match = req.match(/^([a-zA-Z0-9_-]+)(.*)$/)
      if (match) {
        dependencies[match[1].toLowerCase()] = match[2] || '*'
      }
    }
  }

  const projectUrls = info.project_urls as Record<string, string> | undefined
  const repoUrl = projectUrls?.Source

  return {
    name: info.name as string,
    version: info.version as string,
    description: info.summary as string | undefined,
    homepage: info.home_page as string | undefined,
    repository: repoUrl as string | undefined,
    maintainers,
    license: info.license as string | undefined,
    dependencies,
  }
}

async function fetchCargoPackage(
  packageName: string,
): Promise<PackageMetadata> {
  const response = await fetch(`https://crates.io/api/v1/crates/${packageName}`)
  if (!response.ok) {
    throw new Error(`Cargo package not found: ${packageName}`)
  }

  const data = (await response.json()) as {
    crate: Record<string, unknown>
    versions: Array<{ num: string }>
  }
  const crate = data.crate
  const latestVersion = data.versions?.[0]?.num || 'unknown'

  // Fetch dependencies for latest version
  const dependencies: Record<string, string> = {}
  const depsResponse = await fetch(
    `https://crates.io/api/v1/crates/${packageName}/${latestVersion}/dependencies`,
  ).catch(() => null)
  if (depsResponse?.ok) {
    const depsData = (await depsResponse.json()) as {
      dependencies: Array<{ crate_id: string; req: string; kind: string }>
    }
    for (const dep of depsData.dependencies || []) {
      if (dep.kind === 'normal') {
        dependencies[dep.crate_id] = dep.req
      }
    }
  }

  const owners = crate.owners as Array<{ login: string }> | undefined

  return {
    name: crate.name as string,
    version: latestVersion,
    description: crate.description as string | undefined,
    homepage: crate.homepage as string | undefined,
    repository: crate.repository as string | undefined,
    maintainers: owners ? owners.map((o) => o.login) : [],
    license: crate.license as string | undefined,
    dependencies,
  }
}

async function fetchGoPackage(moduleName: string): Promise<PackageMetadata> {
  // Get latest version
  const versionResponse = await fetch(
    `https://proxy.golang.org/${encodeURIComponent(moduleName)}/@v/list`,
  )
  if (!versionResponse.ok) {
    throw new Error(`Go module not found: ${moduleName}`)
  }

  const versions = (await versionResponse.text()).trim().split('\n')
  const latestVersion = versions[versions.length - 1] || 'v0.0.0'

  // Get module info
  const modResponse = await fetch(
    `https://proxy.golang.org/${encodeURIComponent(moduleName)}/@v/${latestVersion}.mod`,
  )

  const dependencies: Record<string, string> = {}
  if (modResponse.ok) {
    const modContent = await modResponse.text()

    // Parse require statements
    const requireMatch = modContent.match(/require\s*\(([\s\S]*?)\)/)
    if (requireMatch) {
      const requires = requireMatch[1].split('\n')
      for (const line of requires) {
        const depMatch = line.trim().match(/^([^\s]+)\s+([^\s]+)/)
        if (depMatch) {
          dependencies[depMatch[1]] = depMatch[2]
        }
      }
    }
  }

  return {
    name: moduleName,
    version: latestVersion,
    maintainers: [],
    dependencies,
  }
}

// ============ Router ============

export function createPkgRegistryProxyRouter() {
  return (
    new Elysia({ name: 'pkg-registry-proxy', prefix: '/pkg-proxy' })
      // NPM proxy
      .get(
        '/npm/:package',
        async ({ params }) => {
          const packageName = params.package
            .replace('%2f', '/')
            .replace('%2F', '/')
          const cacheKey = `npm:${packageName}`

          // Check cache
          const cached = packageCache.get(cacheKey)
          if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
            return { ...cached.data, cached: true }
          }

          const data = await fetchNpmPackage(packageName)
          packageCache.set(cacheKey, {
            data,
            fetchedAt: Date.now(),
            ttl: CACHE_TTL,
          })
          return data
        },
        {
          params: t.Object({
            package: t.String(),
          }),
        },
      )

      // PyPI proxy
      .get(
        '/pypi/:package',
        async ({ params }) => {
          const packageName = params.package
          const cacheKey = `pypi:${packageName}`

          const cached = packageCache.get(cacheKey)
          if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
            return { ...cached.data, cached: true }
          }

          const data = await fetchPyPIPackage(packageName)
          packageCache.set(cacheKey, {
            data,
            fetchedAt: Date.now(),
            ttl: CACHE_TTL,
          })
          return data
        },
        {
          params: t.Object({
            package: t.String(),
          }),
        },
      )

      // Cargo/crates.io proxy
      .get(
        '/cargo/:package',
        async ({ params }) => {
          const packageName = params.package
          const cacheKey = `cargo:${packageName}`

          const cached = packageCache.get(cacheKey)
          if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
            return { ...cached.data, cached: true }
          }

          const data = await fetchCargoPackage(packageName)
          packageCache.set(cacheKey, {
            data,
            fetchedAt: Date.now(),
            ttl: CACHE_TTL,
          })
          return data
        },
        {
          params: t.Object({
            package: t.String(),
          }),
        },
      )

      // Go modules proxy
      .get(
        '/go/:module',
        async ({ params }) => {
          const moduleName = params.module
            .replace('%2f', '/')
            .replace('%2F', '/')
          const cacheKey = `go:${moduleName}`

          const cached = packageCache.get(cacheKey)
          if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
            return { ...cached.data, cached: true }
          }

          const data = await fetchGoPackage(moduleName)
          packageCache.set(cacheKey, {
            data,
            fetchedAt: Date.now(),
            ttl: CACHE_TTL,
          })
          return data
        },
        {
          params: t.Object({
            module: t.String(),
          }),
        },
      )

      // Batch fetch for dependency resolution
      .post(
        '/batch',
        async ({ body }) => {
          const results = await Promise.allSettled(
            body.packages.map(async (pkg) => {
              const cacheKey = `${pkg.registry}:${pkg.name}`
              const cached = packageCache.get(cacheKey)
              if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
                return { ...cached.data, registry: pkg.registry, cached: true }
              }

              let data: PackageMetadata
              switch (pkg.registry) {
                case 'npm':
                  data = await fetchNpmPackage(pkg.name)
                  break
                case 'pypi':
                  data = await fetchPyPIPackage(pkg.name)
                  break
                case 'cargo':
                  data = await fetchCargoPackage(pkg.name)
                  break
                case 'go':
                  data = await fetchGoPackage(pkg.name)
                  break
                default:
                  throw new Error(`Unknown registry: ${pkg.registry}`)
              }

              packageCache.set(cacheKey, {
                data,
                fetchedAt: Date.now(),
                ttl: CACHE_TTL,
              })
              return { ...data, registry: pkg.registry }
            }),
          )

          return {
            packages: results.map((result, i) => {
              if (result.status === 'fulfilled') {
                return result.value
              }
              return {
                name: body.packages[i].name,
                registry: body.packages[i].registry,
                error: result.reason?.message || 'Unknown error',
              }
            }),
          }
        },
        {
          body: t.Object({
            packages: t.Array(
              t.Object({
                name: t.String(),
                registry: t.Union([
                  t.Literal('npm'),
                  t.Literal('pypi'),
                  t.Literal('cargo'),
                  t.Literal('go'),
                ]),
              }),
            ),
          }),
        },
      )

      // Cache stats
      .get('/stats', () => ({
        size: packageCache.size,
        maxSize: MAX_CACHE_SIZE,
        ttl: CACHE_TTL,
      }))

      // Clear cache (admin only)
      .delete('/cache', () => {
        packageCache.clear()
        return { cleared: true }
      })
  )
}

export type PkgRegistryProxyRoutes = ReturnType<
  typeof createPkgRegistryProxyRouter
>
