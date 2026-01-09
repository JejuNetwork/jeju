/**
 * Release API Routes
 *
 * Serves release manifests for downloadable Jeju apps (node, wallet, etc).
 * In production, manifests are fetched from DWS storage where they're
 * published by the `jeju release publish` command.
 * In development, placeholder manifests are returned to enable UI development.
 */

import { logger } from '@jejunetwork/shared'
import { type ReleaseManifest, ReleaseManifestSchema } from '@jejunetwork/types'
import Elysia, { t } from 'elysia'

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

// Development placeholder manifests
// These are used when no releases have been published to storage
const DEV_NODE_RELEASE: ReleaseManifest = {
  app: 'node',
  version: '0.0.0-dev',
  releasedAt: '2025-01-04T00:00:00.000Z',
  channel: 'nightly',
  artifacts: [
    {
      platform: 'macos',
      arch: 'arm64',
      filename: 'JejuNode-dev-arm64.dmg',
      cid: 'DEV_PLACEHOLDER',
      size: 0,
      sha256: 'PLACEHOLDER',
    },
    {
      platform: 'macos',
      arch: 'x64',
      filename: 'JejuNode-dev-x64.dmg',
      cid: 'DEV_PLACEHOLDER',
      size: 0,
      sha256: 'PLACEHOLDER',
    },
    {
      platform: 'windows',
      arch: 'x64',
      filename: 'JejuNode-dev-x64.msi',
      cid: 'DEV_PLACEHOLDER',
      size: 0,
      sha256: 'PLACEHOLDER',
    },
    {
      platform: 'linux',
      arch: 'x64',
      filename: 'JejuNode-dev-x64.AppImage',
      cid: 'DEV_PLACEHOLDER',
      size: 0,
      sha256: 'PLACEHOLDER',
    },
    {
      platform: 'linux',
      arch: 'arm64',
      filename: 'JejuNode-dev-arm64.AppImage',
      cid: 'DEV_PLACEHOLDER',
      size: 0,
      sha256: 'PLACEHOLDER',
    },
  ],
  changelog: 'Development build - not for production use.',
  releaseNotes: 'This is a placeholder. No actual binaries are available yet.',
}

const DEV_WALLET_RELEASE: ReleaseManifest = {
  app: 'wallet',
  version: '0.0.0-dev',
  releasedAt: '2025-01-04T00:00:00.000Z',
  channel: 'nightly',
  artifacts: [
    {
      platform: 'chrome',
      filename: 'jeju-wallet-dev.zip',
      cid: 'DEV_PLACEHOLDER',
      size: 0,
      sha256: 'PLACEHOLDER',
    },
    {
      platform: 'firefox',
      filename: 'jeju-wallet-dev.xpi',
      cid: 'DEV_PLACEHOLDER',
      size: 0,
      sha256: 'PLACEHOLDER',
    },
  ],
}

type AppName = 'node' | 'wallet' | 'vpn'

const DEV_RELEASES: Record<AppName, ReleaseManifest> = {
  node: DEV_NODE_RELEASE,
  wallet: DEV_WALLET_RELEASE,
  vpn: DEV_NODE_RELEASE, // VPN uses node app
}

interface StorageFetchResult {
  manifest: ReleaseManifest | null
  error: string | null
  source: 'storage' | 'not_found' | 'error'
}

/**
 * Fetch release manifest from DWS storage.
 * Returns detailed result including any errors encountered.
 */
async function fetchReleaseFromStorage(
  app: AppName,
  version?: string,
): Promise<StorageFetchResult> {
  // Determine storage URL based on environment
  const storageBaseUrl = IS_PRODUCTION
    ? 'https://dws.jejunetwork.org'
    : `http://127.0.0.1:${process.env.PORT ?? 4030}`

  const manifestPath = version
    ? `/storage/releases/${app}/${version}/manifest.json`
    : `/storage/releases/${app}/latest/manifest.json`

  const url = `${storageBaseUrl}${manifestPath}`

  const versionStr = version ?? 'latest'

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown fetch error'
    logger.warn('[Releases] Storage fetch failed', {
      app,
      version: versionStr,
      url,
      error: errorMessage,
    })
    return { manifest: null, error: errorMessage, source: 'error' }
  }

  if (response.status === 404) {
    logger.info('[Releases] No release found in storage', {
      app,
      version: versionStr,
    })
    return { manifest: null, error: null, source: 'not_found' }
  }

  if (!response.ok) {
    const errorMessage = `HTTP ${response.status}: ${response.statusText}`
    logger.warn('[Releases] Storage returned error', {
      app,
      version: versionStr,
      status: response.status,
    })
    return { manifest: null, error: errorMessage, source: 'error' }
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    const errorMessage = 'Invalid JSON response'
    logger.warn('[Releases] Invalid JSON from storage', {
      app,
      version: versionStr,
    })
    return { manifest: null, error: errorMessage, source: 'error' }
  }

  const parsed = ReleaseManifestSchema.safeParse(data)
  if (!parsed.success) {
    const errorMessage = `Schema validation failed: ${parsed.error.message}`
    logger.warn('[Releases] Invalid manifest schema', {
      app,
      version: versionStr,
      issueCount: parsed.error.issues.length,
      firstIssue: parsed.error.issues[0]?.message ?? 'Unknown',
    })
    return { manifest: null, error: errorMessage, source: 'error' }
  }

  return { manifest: parsed.data, error: null, source: 'storage' }
}

interface ReleaseResult extends ReleaseManifest {
  _source: 'storage' | 'development'
  _storageError?: string
}

/**
 * Get release manifest for an app.
 * Always attempts storage fetch. Falls back to dev placeholders.
 */
async function getRelease(
  app: AppName,
  version?: string,
): Promise<ReleaseResult> {
  // Always try storage fetch first (even in dev, to test the path)
  const storageResult = await fetchReleaseFromStorage(app, version)

  if (storageResult.manifest) {
    return { ...storageResult.manifest, _source: 'storage' }
  }

  // Fall back to dev placeholders
  const devManifest = DEV_RELEASES[app]
  if (!devManifest) {
    throw new Error(`Unknown app: ${app}`)
  }

  const result: ReleaseResult = { ...devManifest, _source: 'development' }

  // Include storage error if there was one (not just "not found")
  if (storageResult.error) {
    result._storageError = storageResult.error
  }

  return result
}

/**
 * Fetch all apps from storage and merge with known apps.
 */
async function getAllApps(): Promise<
  Array<{
    name: string
    latestVersion: string
    channel: string
    releasedAt: string
    platforms: string[]
    source: 'storage' | 'development'
  }>
> {
  const results = await Promise.all(
    (Object.keys(DEV_RELEASES) as AppName[]).map(async (appName) => {
      const result = await getRelease(appName)
      return {
        name: appName,
        latestVersion: result.version,
        channel: result.channel ?? 'stable',
        releasedAt: result.releasedAt,
        platforms: [...new Set(result.artifacts.map((a) => a.platform))],
        source: result._source,
      }
    }),
  )
  return results
}

function isValidApp(app: string): app is AppName {
  return app === 'node' || app === 'wallet' || app === 'vpn'
}

export const releasesRoutes = new Elysia({ prefix: '/releases' })
  .get('/health', async () => {
    // Check if storage is reachable
    const storageResult = await fetchReleaseFromStorage('node')
    return {
      status: 'healthy',
      service: 'releases',
      environment: IS_PRODUCTION ? 'production' : 'development',
      apps: Object.keys(DEV_RELEASES),
      storageReachable: storageResult.source !== 'error',
      storageHasReleases: storageResult.source === 'storage',
    }
  })

  .get(
    '/latest',
    async ({ query, set }) => {
      const app = (query.app ?? 'node') as string
      if (!isValidApp(app)) {
        set.status = 404
        return { error: `Unknown app: ${app}` }
      }
      return getRelease(app)
    },
    { query: t.Object({ app: t.Optional(t.String()) }) },
  )

  .get(
    '/:app/:version',
    async ({ params, set }) => {
      if (!isValidApp(params.app)) {
        set.status = 404
        return { error: `Unknown app: ${params.app}` }
      }
      return getRelease(params.app, params.version)
    },
    { params: t.Object({ app: t.String(), version: t.String() }) },
  )

  .get('/node/latest', async () => getRelease('node'))

  .get('/wallet/latest', async () => getRelease('wallet'))

  .get('/apps', async () => {
    const apps = await getAllApps()
    return { apps }
  })

  .post(
    '/validate',
    async ({ body }) => {
      const result = ReleaseManifestSchema.safeParse(body)
      if (result.success) {
        return { valid: true, manifest: result.data }
      }
      return {
        valid: false,
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      }
    },
    { body: t.Any() },
  )

/** Factory function for router creation */
export function createReleasesRouter() {
  return releasesRoutes
}
