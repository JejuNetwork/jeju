/**
 * Release API Routes
 *
 * Provides endpoints for fetching app release information,
 * including the node app, wallet extension, and other downloadable apps.
 */

import {
  type ReleaseManifest,
  ReleaseManifestSchema,
} from '@jejunetwork/types'
import Elysia, { t } from 'elysia'

// Default release manifests for development/fallback
// In production, these would be fetched from IPFS or a release registry
const DEFAULT_NODE_RELEASE: ReleaseManifest = {
  app: 'node',
  version: '1.0.0',
  releasedAt: new Date().toISOString(),
  channel: 'stable',
  artifacts: [
    {
      platform: 'macos',
      arch: 'arm64',
      filename: 'JejuNode-1.0.0-arm64.dmg',
      cid: 'QmNodeMacArm64v100',
      size: 89128960,
      sha256: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
    },
    {
      platform: 'macos',
      arch: 'x64',
      filename: 'JejuNode-1.0.0-x64.dmg',
      cid: 'QmNodeMacX64v100',
      size: 96468992,
      sha256: 'b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1',
    },
    {
      platform: 'windows',
      arch: 'x64',
      filename: 'JejuNode-1.0.0-x64.msi',
      cid: 'QmNodeWinX64v100',
      size: 81788928,
      sha256: 'c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2',
    },
    {
      platform: 'linux',
      arch: 'x64',
      filename: 'JejuNode-1.0.0-x64.AppImage',
      cid: 'QmNodeLinuxX64v100',
      size: 99614720,
      sha256: 'd4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3',
    },
    {
      platform: 'linux',
      arch: 'arm64',
      filename: 'JejuNode-1.0.0-arm64.AppImage',
      cid: 'QmNodeLinuxArm64v100',
      size: 92274688,
      sha256: 'e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3d4',
    },
  ],
  changelog: 'Initial release with VPN, CDN, storage, and RPC services.',
  releaseNotes:
    'Jeju Node v1.0.0 - Start earning by providing infrastructure services.',
}

const DEFAULT_WALLET_RELEASE: ReleaseManifest = {
  app: 'wallet',
  version: '1.0.0',
  releasedAt: new Date().toISOString(),
  channel: 'stable',
  artifacts: [
    {
      platform: 'chrome',
      filename: 'jeju-wallet-chrome-1.0.0.zip',
      cid: 'QmWalletChromev100',
      size: 2097152,
      sha256: 'f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3d4e5',
      storeUrl:
        'https://chrome.google.com/webstore/detail/jeju-wallet/placeholder',
    },
    {
      platform: 'firefox',
      filename: 'jeju-wallet-firefox-1.0.0.xpi',
      cid: 'QmWalletFirefoxv100',
      size: 2097152,
      sha256: 'g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3d4e5f6',
      storeUrl: 'https://addons.mozilla.org/en-US/firefox/addon/jeju-wallet/',
    },
  ],
}

// App release registry
type AppName = 'node' | 'wallet' | 'vpn'
const RELEASE_REGISTRY: Record<AppName, ReleaseManifest> = {
  node: DEFAULT_NODE_RELEASE,
  wallet: DEFAULT_WALLET_RELEASE,
  vpn: DEFAULT_NODE_RELEASE, // VPN uses node app
}

/**
 * Fetch release manifest from IPFS or registry
 * In production, this would query IPFS or a release contract
 */
async function fetchReleaseManifest(
  app: AppName,
  _version?: string,
): Promise<ReleaseManifest> {
  // For now, return default releases
  // TODO: Implement IPFS/contract-based release fetching
  const manifest = RELEASE_REGISTRY[app]
  if (!manifest) {
    throw new Error(`Unknown app: ${app}`)
  }
  return manifest
}

export const releasesRoutes = new Elysia({ prefix: '/releases' })
  .get('/health', () => ({
    status: 'healthy',
    service: 'releases',
    apps: Object.keys(RELEASE_REGISTRY),
  }))

  // Get latest release for an app
  .get(
    '/latest',
    async ({ query }) => {
      const app = (query.app ?? 'node') as AppName
      const manifest = await fetchReleaseManifest(app)
      return manifest
    },
    {
      query: t.Object({
        app: t.Optional(t.String()),
      }),
    },
  )

  // Get specific version
  .get(
    '/:app/:version',
    async ({ params }) => {
      const manifest = await fetchReleaseManifest(
        params.app as AppName,
        params.version,
      )
      return manifest
    },
    {
      params: t.Object({
        app: t.String(),
        version: t.String(),
      }),
    },
  )

  // Get latest release for node app specifically
  .get('/node/latest', async () => {
    return fetchReleaseManifest('node')
  })

  // Get latest release for wallet
  .get('/wallet/latest', async () => {
    return fetchReleaseManifest('wallet')
  })

  // List all available apps with their latest versions
  .get('/apps', () => {
    const apps = Object.entries(RELEASE_REGISTRY).map(([name, manifest]) => ({
      name,
      latestVersion: manifest.version,
      channel: manifest.channel,
      releasedAt: manifest.releasedAt,
      platforms: [...new Set(manifest.artifacts.map((a) => a.platform))],
    }))
    return { apps }
  })

  // Validate a release manifest (for publishers)
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
    {
      body: t.Any(),
    },
  )
