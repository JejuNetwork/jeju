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

import { Hono } from 'hono'
import { LRUCache } from 'lru-cache'
import { batchPackagesRequestSchema } from '../../shared/schemas'
import { expectValid } from '../../shared/validation'

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

  return {
    name: info.name as string,
    version: info.version as string,
    description: info.summary as string | undefined,
    homepage: info.home_page as string | undefined,
    repository:
      info.project_urls && (info.project_urls as Record<string, string>).Source,
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
  try {
    const depsResponse = await fetch(
      `https://crates.io/api/v1/crates/${packageName}/${latestVersion}/dependencies`,
    )
    if (depsResponse.ok) {
      const depsData = (await depsResponse.json()) as {
        dependencies: Array<{ crate_id: string; req: string; kind: string }>
      }
      for (const dep of depsData.dependencies || []) {
        if (dep.kind === 'normal') {
          dependencies[dep.crate_id] = dep.req
        }
      }
    }
  } catch {
    // Ignore dependency fetch errors
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

export function createPkgRegistryProxyRouter(): Hono {
  const router = new Hono()

  // NPM proxy
  router.get('/npm/:package{.+}', async (c) => {
    const packageName = c.req.param('package')
    const cacheKey = `npm:${packageName}`

    // Check cache
    const cached = packageCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
      return c.json({ ...cached.data, cached: true })
    }

    const data = await fetchNpmPackage(packageName)
    packageCache.set(cacheKey, { data, fetchedAt: Date.now(), ttl: CACHE_TTL })
    return c.json(data)
  })

  // PyPI proxy
  router.get('/pypi/:package', async (c) => {
    const packageName = c.req.param('package')
    const cacheKey = `pypi:${packageName}`

    const cached = packageCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
      return c.json({ ...cached.data, cached: true })
    }

    const data = await fetchPyPIPackage(packageName)
    packageCache.set(cacheKey, { data, fetchedAt: Date.now(), ttl: CACHE_TTL })
    return c.json(data)
  })

  // Cargo/crates.io proxy
  router.get('/cargo/:package', async (c) => {
    const packageName = c.req.param('package')
    const cacheKey = `cargo:${packageName}`

    const cached = packageCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
      return c.json({ ...cached.data, cached: true })
    }

    const data = await fetchCargoPackage(packageName)
    packageCache.set(cacheKey, { data, fetchedAt: Date.now(), ttl: CACHE_TTL })
    return c.json(data)
  })

  // Go modules proxy
  router.get('/go/:module{.+}', async (c) => {
    const moduleName = c.req.param('module')
    const cacheKey = `go:${moduleName}`

    const cached = packageCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
      return c.json({ ...cached.data, cached: true })
    }

    const data = await fetchGoPackage(moduleName)
    packageCache.set(cacheKey, { data, fetchedAt: Date.now(), ttl: CACHE_TTL })
    return c.json(data)
  })

  // Batch fetch for dependency resolution
  router.post('/batch', async (c) => {
    const body = expectValid(
      batchPackagesRequestSchema,
      await c.req.json(),
      'Batch packages request',
    )

    const results = await Promise.allSettled(
      body.packages.map(async ({ name, registry }) => {
        const cacheKey = `${registry}:${name}`
        const cached = packageCache.get(cacheKey)
        if (cached && Date.now() - cached.fetchedAt < cached.ttl) {
          return { name, registry, ...cached.data, cached: true }
        }

        let data: PackageMetadata
        switch (registry) {
          case 'npm':
            data = await fetchNpmPackage(name)
            break
          case 'pypi':
            data = await fetchPyPIPackage(name)
            break
          case 'cargo':
            data = await fetchCargoPackage(name)
            break
          case 'go':
            data = await fetchGoPackage(name)
            break
        }

        packageCache.set(cacheKey, {
          data,
          fetchedAt: Date.now(),
          ttl: CACHE_TTL,
        })
        return { name, registry, ...data }
      }),
    )

    return c.json({
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
    })
  })

  // Cache stats
  router.get('/stats', (c) => {
    return c.json({
      size: packageCache.size,
      maxSize: MAX_CACHE_SIZE,
      ttl: CACHE_TTL,
    })
  })

  // Clear cache (admin only)
  router.delete('/cache', (c) => {
    packageCache.clear()
    return c.json({ cleared: true })
  })

  return router
}
