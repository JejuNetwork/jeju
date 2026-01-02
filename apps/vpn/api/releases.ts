/**
 * VPN Releases API
 *
 * Serves release information for the VPN app (extension downloads).
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getDWSUrl } from '@jejunetwork/config'
import { type ReleaseManifest, ReleaseManifestSchema } from '@jejunetwork/types'
import { Elysia } from 'elysia'

const APP_DIR = resolve(import.meta.dir, '..')

function getPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(join(APP_DIR, 'package.json'), 'utf-8'),
  )
  return packageJson.version
}

async function fetchReleaseManifest(): Promise<ReleaseManifest | null> {
  const dwsUrl = getDWSUrl()

  const response = await fetch(`${dwsUrl}/storage/releases/vpn/latest.json`)
  if (!response.ok) {
    return null
  }

  const rawData: unknown = await response.json()
  const parsed = ReleaseManifestSchema.safeParse(rawData)
  if (!parsed.success) {
    console.error('Invalid release manifest:', parsed.error.message)
    return null
  }

  return parsed.data
}

function createFallbackManifest(): ReleaseManifest {
  const version = getPackageVersion()

  return {
    app: 'vpn',
    version,
    releasedAt: new Date().toISOString(),
    channel: 'stable',
    artifacts: [],
    releaseNotes: `Jeju VPN v${version} - Free, decentralized VPN powered by the community.`,
  }
}

export function createReleasesRouter() {
  return new Elysia({ prefix: '/api/releases' })
    .get('/latest', async () => {
      const manifest = await fetchReleaseManifest()
      if (manifest) {
        return manifest
      }
      return createFallbackManifest()
    })
    .get('/info', async () => {
      const manifest = await fetchReleaseManifest()
      const version = manifest?.version ?? getPackageVersion()

      return {
        app: 'vpn',
        displayName: 'Jeju VPN',
        description:
          'Free, decentralized VPN powered by the community. Browser extension for Chrome, Firefox, and Edge.',
        version,
        type: 'extension',
        platforms: ['chrome', 'firefox', 'edge'] as const,
        hasDownloads: manifest ? manifest.artifacts.length > 0 : false,
        stores: {
          chrome: 'https://chrome.google.com/webstore/detail/jeju-vpn',
          firefox: 'https://addons.mozilla.org/en-US/firefox/addon/jeju-vpn',
          edge: 'https://microsoftedge.microsoft.com/addons/detail/jeju-vpn',
        },
        features: [
          'Unlimited VPN access',
          'Decentralized network',
          'JNS resolver',
          'WebRTC protection',
          'Fair contribution model',
        ],
      }
    })
    .get('/download/:platform', async ({ params, set }) => {
      const { platform } = params
      const validPlatforms = ['chrome', 'firefox', 'edge']

      if (!validPlatforms.includes(platform)) {
        set.status = 400
        return { error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` }
      }

      const manifest = await fetchReleaseManifest()
      if (!manifest) {
        set.status = 404
        return { error: 'No releases available' }
      }

      const artifact = manifest.artifacts.find((a) => a.platform === platform)
      if (!artifact) {
        set.status = 404
        return { error: `No ${platform} release available` }
      }

      const dwsUrl = getDWSUrl()
      set.redirect = `${dwsUrl}/storage/download/${artifact.cid}?filename=${artifact.filename}`
      return
    })
    .get('/changelog', async () => {
      const manifest = await fetchReleaseManifest()
      return {
        version: manifest?.version ?? getPackageVersion(),
        releaseNotes: manifest?.releaseNotes ?? 'No release notes available.',
        changelog: manifest?.changelog ?? null,
      }
    })
}
