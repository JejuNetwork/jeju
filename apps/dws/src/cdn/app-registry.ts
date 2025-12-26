/**
 * App Registry - Discovers and manages Jeju app frontend configurations
 *
 * Reads jeju-manifest.json files from all apps to:
 * - Serve static frontends via CDN
 * - Apply per-app cache rules
 * - Support local devnet and production IPFS modes
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CacheRule } from '@jejunetwork/types'

export interface AppFrontendConfig {
  name: string
  displayName: string
  staticDir: string
  absoluteDir: string
  port: number
  spa: boolean
  jnsName: string
  cacheRules: CacheRule[]
  enabled: boolean
  cid?: string // Set when deployed to IPFS
}

interface ManifestDws {
  cdn?: {
    enabled?: boolean
    staticDir?: string
    cacheRules?: CacheRule[]
  }
}

interface ManifestDecentralization {
  frontend?: {
    buildDir?: string
    spa?: boolean
    jnsName?: string
    ipfs?: boolean
  }
  cdn?: {
    enabled?: boolean
    cacheRules?: CacheRule[]
  }
}

interface ManifestPorts {
  frontend?: number
  main?: number
}

interface JejuManifest {
  name: string
  displayName?: string
  type?: string
  ports?: ManifestPorts
  dws?: ManifestDws
  decentralization?: ManifestDecentralization
  jns?: {
    name?: string
  }
}

const DEFAULT_CACHE_RULES: CacheRule[] = [
  { pattern: '/assets/**', ttl: 31536000, strategy: 'immutable' },
  { pattern: '/**/*.js', ttl: 86400, strategy: 'static' },
  { pattern: '/**/*.css', ttl: 86400, strategy: 'static' },
  { pattern: '/**/*.html', ttl: 60, strategy: 'dynamic' },
  { pattern: '/**/*.json', ttl: 300, strategy: 'dynamic' },
  { pattern: '/**/*.woff2', ttl: 31536000, strategy: 'immutable' },
  { pattern: '/**/*.woff', ttl: 31536000, strategy: 'immutable' },
  { pattern: '/**/*.ttf', ttl: 31536000, strategy: 'immutable' },
  { pattern: '/**/*.png', ttl: 604800, strategy: 'static' },
  { pattern: '/**/*.jpg', ttl: 604800, strategy: 'static' },
  { pattern: '/**/*.svg', ttl: 604800, strategy: 'static' },
  { pattern: '/**/*.ico', ttl: 604800, strategy: 'static' },
]

export class AppRegistry {
  private apps: Map<string, AppFrontendConfig> = new Map()
  private appsDir: string
  private initialized = false

  constructor(appsDir?: string) {
    this.appsDir = appsDir ?? resolve(process.cwd(), '../../')
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    const entries = await readdir(this.appsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const manifestPath = join(this.appsDir, entry.name, 'jeju-manifest.json')
      const manifestExists = await stat(manifestPath).catch(() => null)

      if (!manifestExists) continue

      const manifestContent = await readFile(manifestPath, 'utf-8')
      const manifest: JejuManifest = JSON.parse(manifestContent)

      const config = this.parseManifest(manifest, entry.name)
      if (config) {
        this.apps.set(config.name, config)
        console.log(
          `[AppRegistry] Registered: ${config.name} -> ${config.staticDir}`,
        )
      }
    }

    this.initialized = true
    console.log(`[AppRegistry] Loaded ${this.apps.size} apps`)
  }

  private parseManifest(
    manifest: JejuManifest,
    dirName: string,
  ): AppFrontendConfig | null {
    const cdnConfig = manifest.dws?.cdn ?? manifest.decentralization?.cdn
    const frontendConfig = manifest.decentralization?.frontend

    // Skip apps without frontend/CDN config
    if (!cdnConfig?.enabled && !frontendConfig) return null

    const staticDir =
      manifest.dws?.cdn?.staticDir ?? frontendConfig?.buildDir ?? 'dist'
    const absoluteDir = join(this.appsDir, dirName, staticDir)

    const port = manifest.ports?.frontend ?? manifest.ports?.main ?? 0
    if (!port) return null

    const cacheRules: CacheRule[] = [
      ...(cdnConfig?.cacheRules ?? []),
      ...DEFAULT_CACHE_RULES,
    ]

    return {
      name: manifest.name,
      displayName: manifest.displayName ?? manifest.name,
      staticDir,
      absoluteDir,
      port,
      spa: frontendConfig?.spa ?? true,
      jnsName:
        frontendConfig?.jnsName ??
        manifest.jns?.name ??
        `${manifest.name}.jeju`,
      cacheRules,
      enabled: cdnConfig?.enabled ?? true,
    }
  }

  getApp(name: string): AppFrontendConfig | undefined {
    return this.apps.get(name)
  }

  getAllApps(): AppFrontendConfig[] {
    return Array.from(this.apps.values())
  }

  getEnabledApps(): AppFrontendConfig[] {
    return this.getAllApps().filter((app) => app.enabled)
  }

  setAppCid(name: string, cid: string): void {
    const app = this.apps.get(name)
    if (app) {
      app.cid = cid
      console.log(`[AppRegistry] Set CID for ${name}: ${cid}`)
    }
  }

  getCacheRulesForApp(name: string): CacheRule[] {
    return this.apps.get(name)?.cacheRules ?? DEFAULT_CACHE_RULES
  }
}

let registry: AppRegistry | null = null

export function getAppRegistry(): AppRegistry {
  if (!registry) {
    registry = new AppRegistry()
  }
  return registry
}

export async function initializeAppRegistry(
  appsDir?: string,
): Promise<AppRegistry> {
  registry = new AppRegistry(appsDir)
  await registry.initialize()
  return registry
}

export function resetAppRegistry(): void {
  registry = null
}
