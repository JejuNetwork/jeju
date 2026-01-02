/**
 * Elysia plugin for release endpoints
 */

import {
  getRecommendedDownloads,
  type ReleasePlatform,
} from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { getReleaseService, type ReleaseServiceConfig } from './core'

export interface ReleasePluginConfig extends ReleaseServiceConfig {
  appName: string
  basePath?: string
}

/**
 * Create release routes for an app
 */
export function createReleaseRoutes(config: ReleasePluginConfig) {
  const { appName, basePath = '/api/releases' } = config
  const service = getReleaseService()

  return new Elysia({ prefix: basePath })
    .get(
      '/latest',
      async ({ query }) => {
        const channel =
          (query.channel as 'stable' | 'beta' | 'nightly') ?? 'stable'
        const manifest = await service.getLatest(appName, channel)

        // Add download URLs to artifacts
        const artifactsWithUrls = manifest.artifacts.map((artifact) => ({
          ...artifact,
          downloadUrl: service.getDownloadUrl(artifact),
        }))

        return {
          ...manifest,
          artifacts: artifactsWithUrls,
        }
      },
      {
        query: t.Object({
          channel: t.Optional(
            t.Union([
              t.Literal('stable'),
              t.Literal('beta'),
              t.Literal('nightly'),
            ]),
          ),
        }),
        detail: {
          tags: ['releases'],
          summary: 'Get latest release',
          description: `Get the latest release manifest for ${appName}`,
        },
      },
    )
    .get(
      '/versions',
      async () => {
        const index = await service.getIndex(appName)
        return index
      },
      {
        detail: {
          tags: ['releases'],
          summary: 'List all versions',
          description: `Get all available versions for ${appName}`,
        },
      },
    )
    .get(
      '/:version',
      async ({ params }) => {
        const manifest = await service.getManifest(appName, params.version)

        // Add download URLs to artifacts
        const artifactsWithUrls = manifest.artifacts.map((artifact) => ({
          ...artifact,
          downloadUrl: service.getDownloadUrl(artifact),
        }))

        return {
          ...manifest,
          artifacts: artifactsWithUrls,
        }
      },
      {
        params: t.Object({
          version: t.String(),
        }),
        detail: {
          tags: ['releases'],
          summary: 'Get specific version',
          description: `Get release manifest for a specific version of ${appName}`,
        },
      },
    )
    .get(
      '/download/:platform',
      async ({ params, query, set }) => {
        const platform = params.platform as ReleasePlatform
        const arch = query.arch as 'x64' | 'arm64' | 'universal' | undefined
        const channel =
          (query.channel as 'stable' | 'beta' | 'nightly') ?? 'stable'

        const manifest = await service.getLatest(appName, channel)

        // Find matching artifact
        const artifact = manifest.artifacts.find((a) => {
          if (a.platform !== platform) return false
          if (arch && a.arch && a.arch !== arch) return false
          return true
        })

        if (!artifact) {
          set.status = 404
          return {
            error: `No download available for ${platform}${arch ? ` (${arch})` : ''}`,
          }
        }

        // Redirect to actual download
        const downloadUrl = service.getDownloadUrl(artifact)
        set.redirect = downloadUrl
        return null
      },
      {
        params: t.Object({
          platform: t.String(),
        }),
        query: t.Object({
          arch: t.Optional(t.String()),
          channel: t.Optional(t.String()),
        }),
        detail: {
          tags: ['releases'],
          summary: 'Download for platform',
          description: `Redirect to download for ${appName} on specified platform`,
        },
      },
    )
    .get(
      '/recommended',
      async ({ query, request }) => {
        const channel =
          (query.channel as 'stable' | 'beta' | 'nightly') ?? 'stable'
        const manifest = await service.getLatest(appName, channel)

        // Detect platform from headers (server-side)
        const ua = request.headers.get('user-agent') ?? ''
        const detected = detectPlatformFromUA(ua)

        const downloads = getRecommendedDownloads(manifest.artifacts, detected)

        return {
          version: manifest.version,
          detected,
          downloads,
        }
      },
      {
        query: t.Object({
          channel: t.Optional(t.String()),
        }),
        detail: {
          tags: ['releases'],
          summary: 'Get recommended downloads',
          description: `Get recommended downloads for ${appName} based on detected platform`,
        },
      },
    )
}

/**
 * Server-side platform detection from User-Agent
 */
function detectPlatformFromUA(ua: string): {
  os: 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown'
  arch: 'arm64' | 'x64' | 'unknown'
  browser: 'chrome' | 'firefox' | 'edge' | 'safari' | 'unknown'
} {
  const lowerUA = ua.toLowerCase()

  // Detect OS
  let os: 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown' =
    'unknown'
  if (lowerUA.includes('iphone') || lowerUA.includes('ipad')) {
    os = 'ios'
  } else if (lowerUA.includes('android')) {
    os = 'android'
  } else if (lowerUA.includes('mac os x') || lowerUA.includes('macintosh')) {
    os = 'macos'
  } else if (lowerUA.includes('windows')) {
    os = 'windows'
  } else if (lowerUA.includes('linux')) {
    os = 'linux'
  }

  // Detect arch
  let arch: 'arm64' | 'x64' | 'unknown' = 'unknown'
  if (os === 'macos') {
    // macOS ARM detection
    if (lowerUA.includes('arm64') || lowerUA.includes('apple')) {
      arch = 'arm64'
    } else {
      arch = 'x64'
    }
  } else if (os === 'windows') {
    if (lowerUA.includes('arm64') || lowerUA.includes('arm')) {
      arch = 'arm64'
    } else {
      arch = 'x64'
    }
  } else if (os === 'linux') {
    if (lowerUA.includes('aarch64') || lowerUA.includes('arm64')) {
      arch = 'arm64'
    } else {
      arch = 'x64'
    }
  }

  // Detect browser
  let browser: 'chrome' | 'firefox' | 'edge' | 'safari' | 'unknown' = 'unknown'
  if (lowerUA.includes('edg/')) {
    browser = 'edge'
  } else if (lowerUA.includes('chrome') && !lowerUA.includes('edg')) {
    browser = 'chrome'
  } else if (lowerUA.includes('firefox')) {
    browser = 'firefox'
  } else if (lowerUA.includes('safari') && !lowerUA.includes('chrome')) {
    browser = 'safari'
  }

  return { os, arch, browser }
}

/**
 * Release plugin for Elysia apps
 */
export function releasePlugin(config: ReleasePluginConfig) {
  return createReleaseRoutes(config)
}
