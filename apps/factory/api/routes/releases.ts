/**
 * Release Management Routes
 *
 * Manages application releases including:
 * - Listing releases for apps
 * - Fetching release manifests
 * - Download redirects
 */

import { Elysia, t } from 'elysia'
import {
  type ReleaseArtifact,
  type ReleaseIndex,
  type ReleaseManifest,
  ReleaseManifestSchema,
  formatFileSize,
  getPlatformLabel,
} from '@jejunetwork/types'
import { getFactoryConfig } from '../config'

// Supported apps with releases
const RELEASE_APPS = ['otto', 'vpn', 'wallet', 'node'] as const
type ReleaseApp = (typeof RELEASE_APPS)[number]

interface ReleaseStore {
  [app: string]: {
    index: ReleaseIndex
    manifests: Map<string, ReleaseManifest>
  }
}

// In-memory cache for release data
const releaseStore: ReleaseStore = {}

class DWSError extends Error {
  status: number
  constructor(message: string, status: number = 503) {
    super(message)
    this.name = 'DWSError'
    this.status = status
  }
}

async function fetchFromDWS<T>(path: string): Promise<T> {
  const config = getFactoryConfig()
  const dwsUrl = config.dwsUrl

  let response: Response
  try {
    response = await fetch(`${dwsUrl}${path}`)
  } catch (err) {
    throw new DWSError(`Failed to connect to DWS at ${dwsUrl}`, 503)
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new DWSError(`Resource not found: ${path}`, 404)
    }
    throw new DWSError(`DWS request failed: ${response.status} ${response.statusText}`, response.status)
  }

  try {
    return await response.json()
  } catch {
    throw new DWSError(`Invalid JSON response from DWS`, 500)
  }
}

async function getAppReleaseIndex(app: string): Promise<ReleaseIndex> {
  // Check cache first
  if (releaseStore[app]?.index) {
    return releaseStore[app].index
  }

  // Fetch from DWS
  let index: ReleaseIndex
  try {
    index = await fetchFromDWS<ReleaseIndex>(`/storage/releases/${app}/index.json`)
  } catch (err) {
    // If the index doesn't exist, return an empty index (no releases yet)
    if (err instanceof DWSError && err.status === 404) {
      return { app, latest: '0.0.0', versions: [] }
    }
    throw err
  }

  // Cache it
  if (!releaseStore[app]) {
    releaseStore[app] = { index, manifests: new Map() }
  } else {
    releaseStore[app].index = index
  }

  return index
}

async function getAppReleaseManifest(app: string, version: string): Promise<ReleaseManifest> {
  // Check cache first
  const cached = releaseStore[app]?.manifests.get(version)
  if (cached) {
    return cached
  }

  // Get index to find manifest CID
  const index = await getAppReleaseIndex(app)
  const versionEntry = index.versions.find((v) => v.version === version)

  if (!versionEntry) {
    throw new Error(`Version ${version} not found for app ${app}`)
  }

  // Fetch manifest by CID
  const manifest = await fetchFromDWS<ReleaseManifest>(`/storage/download/${versionEntry.manifestCid}`)
  const parsed = ReleaseManifestSchema.parse(manifest)

  // Cache it
  if (!releaseStore[app]) {
    releaseStore[app] = {
      index: { app, latest: '0.0.0', versions: [] },
      manifests: new Map(),
    }
  }
  releaseStore[app].manifests.set(version, parsed)

  return parsed
}

export const releasesRoutes = new Elysia({ prefix: '/api/releases' })
  // Global error handler for releases routes
  .onError(({ error, set }) => {
    if (error instanceof DWSError) {
      set.status = error.status
      return { error: { code: 'DWS_ERROR', message: error.message } }
    }
    if (error instanceof Error && error.message.includes('not found')) {
      set.status = 404
      return { error: { code: 'NOT_FOUND', message: error.message } }
    }
    set.status = 500
    return { error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' } }
  })
  // List all apps with releases
  .get(
    '/',
    async () => {
      const apps: Array<{
        name: ReleaseApp
        displayName: string
        latestVersion: string
        description: string
      }> = []

      const displayNames: Record<ReleaseApp, string> = {
        otto: 'Otto AI Agent',
        vpn: 'Jeju VPN',
        wallet: 'Network Wallet',
        node: 'Network Node',
      }

      const descriptions: Record<ReleaseApp, string> = {
        otto: 'AI-powered trading agent for Discord, Telegram, and more',
        vpn: 'Decentralized VPN browser extension',
        wallet: 'Cross-chain wallet for Jeju Network',
        node: 'Run infrastructure and earn rewards',
      }

      for (const app of RELEASE_APPS) {
        const index = await getAppReleaseIndex(app).catch(() => null)

        apps.push({
          name: app,
          displayName: displayNames[app],
          latestVersion: index?.latest ?? 'N/A',
          description: descriptions[app],
        })
      }

      return { apps }
    },
    {
      detail: {
        tags: ['releases'],
        summary: 'List apps with releases',
        description: 'Get a list of all apps that have downloadable releases',
      },
    },
  )

  // Get release index for an app
  .get(
    '/:app',
    async ({ params, set }) => {
      const { app } = params

      if (!RELEASE_APPS.includes(app as ReleaseApp)) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: `App ${app} not found` } }
      }

      const index = await getAppReleaseIndex(app)
      return index
    },
    {
      params: t.Object({
        app: t.String(),
      }),
      detail: {
        tags: ['releases'],
        summary: 'Get app release index',
        description: 'Get the release index for a specific app',
      },
    },
  )

  // Get latest release for an app
  .get(
    '/:app/latest',
    async ({ params, query, set }) => {
      const { app } = params
      const channel = (query.channel as 'stable' | 'beta' | 'nightly') ?? 'stable'

      if (!RELEASE_APPS.includes(app as ReleaseApp)) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: `App ${app} not found` } }
      }

      const index = await getAppReleaseIndex(app)

      let version: string
      switch (channel) {
        case 'beta':
          version = index.latestBeta ?? index.latest
          break
        case 'nightly':
          version = index.latestNightly ?? index.latest
          break
        default:
          version = index.latest
      }

      if (version === '0.0.0' || !version) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: `No ${channel} release found for ${app}` } }
      }

      const manifest = await getAppReleaseManifest(app, version)
      return manifest
    },
    {
      params: t.Object({
        app: t.String(),
      }),
      query: t.Object({
        channel: t.Optional(t.Union([t.Literal('stable'), t.Literal('beta'), t.Literal('nightly')])),
      }),
      detail: {
        tags: ['releases'],
        summary: 'Get latest release',
        description: 'Get the latest release manifest for an app',
      },
    },
  )

  // Get specific version
  .get(
    '/:app/:version',
    async ({ params, set }) => {
      const { app, version } = params

      if (!RELEASE_APPS.includes(app as ReleaseApp)) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: `App ${app} not found` } }
      }

      const manifest = await getAppReleaseManifest(app, version)
      return manifest
    },
    {
      params: t.Object({
        app: t.String(),
        version: t.String(),
      }),
      detail: {
        tags: ['releases'],
        summary: 'Get release by version',
        description: 'Get a specific release version manifest',
      },
    },
  )

  // Get download links for a release
  .get(
    '/:app/:version/downloads',
    async ({ params, set }) => {
      const { app, version } = params

      if (!RELEASE_APPS.includes(app as ReleaseApp)) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: `App ${app} not found` } }
      }

      const manifest = await getAppReleaseManifest(app, version)
      const config = getFactoryConfig()

      const downloads = manifest.artifacts.map((artifact: ReleaseArtifact) => ({
        platform: artifact.platform,
        arch: artifact.arch,
        label: `${getPlatformLabel(artifact.platform)}${artifact.arch ? ` (${artifact.arch})` : ''}`,
        filename: artifact.filename,
        size: formatFileSize(artifact.size),
        sizeBytes: artifact.size,
        sha256: artifact.sha256,
        downloadUrl: `${config.dwsUrl}/storage/download/${artifact.cid}?filename=${encodeURIComponent(artifact.filename)}`,
      }))

      return {
        app,
        version: manifest.version,
        releasedAt: manifest.releasedAt,
        channel: manifest.channel,
        downloads,
      }
    },
    {
      params: t.Object({
        app: t.String(),
        version: t.String(),
      }),
      detail: {
        tags: ['releases'],
        summary: 'Get download links',
        description: 'Get all download links for a specific release',
      },
    },
  )

  // Direct download redirect
  .get(
    '/:app/:version/download/:platform',
    async ({ params, query, set }) => {
      const { app, version, platform } = params
      const arch = query.arch

      if (!RELEASE_APPS.includes(app as ReleaseApp)) {
        set.status = 404
        return { error: { code: 'NOT_FOUND', message: `App ${app} not found` } }
      }

      const manifest = await getAppReleaseManifest(app, version)
      const config = getFactoryConfig()

      // Find matching artifact
      const artifact = manifest.artifacts.find((a: ReleaseArtifact) => {
        if (a.platform !== platform) return false
        if (arch && a.arch && a.arch !== arch) return false
        return true
      })

      if (!artifact) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `No artifact found for ${platform}${arch ? ` (${arch})` : ''}`,
          },
        }
      }

      // Redirect to DWS
      set.redirect = `${config.dwsUrl}/storage/download/${artifact.cid}?filename=${encodeURIComponent(artifact.filename)}`
      set.status = 302
      return null
    },
    {
      params: t.Object({
        app: t.String(),
        version: t.String(),
        platform: t.String(),
      }),
      query: t.Object({
        arch: t.Optional(t.String()),
      }),
      detail: {
        tags: ['releases'],
        summary: 'Download artifact',
        description: 'Redirect to download a specific artifact',
      },
    },
  )

  // Clear release cache (admin only)
  .post(
    '/cache/clear',
    async () => {
      // Clear all caches
      for (const app of Object.keys(releaseStore)) {
        delete releaseStore[app]
      }
      return { success: true, message: 'Release cache cleared' }
    },
    {
      detail: {
        tags: ['releases'],
        summary: 'Clear release cache',
        description: 'Clear the in-memory release cache',
      },
    },
  )
