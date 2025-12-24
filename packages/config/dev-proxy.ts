/**
 * @fileoverview Dev Proxy Configuration for Local Development
 * @module config/dev-proxy
 *
 * Maps JNS names to local development servers for HMR support.
 * When DEV_MODE=true, the JNS Gateway proxies to these URLs instead of IPFS.
 *
 * Content Resolution Priority (in dev mode):
 * 1. Environment variable override (DEV_PROXY_${APP_NAME}_URL)
 * 2. JNS text record `dws.dev` (if set on-chain)
 * 3. Local dev proxy mapping (this file)
 * 4. Fall back to normal IPFS resolution
 *
 * Usage:
 *   DEV_MODE=true bun run dev
 */

import { CORE_PORTS } from './ports'

/** Dev proxy target configuration */
export interface DevProxyTarget {
  /** Local URL to proxy to */
  url: string
  /** Local port (derived from CORE_PORTS/VENDOR_PORTS) */
  port: number
  /** Whether this app has a separate API backend */
  hasBackend: boolean
  /** Backend port if separate from frontend */
  backendPort?: number
  /** API prefix to proxy to backend */
  apiPrefix?: string
}

/**
 * Static mapping of JNS names to local development servers
 * Keys are the JNS name (without .jeju suffix)
 */
export const DEV_PROXY_TARGETS: Record<string, DevProxyTarget> = {
  gateway: {
    url: `http://localhost:${CORE_PORTS.GATEWAY.DEFAULT}`,
    port: CORE_PORTS.GATEWAY.DEFAULT,
    hasBackend: false,
  },
  bazaar: {
    url: `http://localhost:${CORE_PORTS.BAZAAR.DEFAULT}`,
    port: CORE_PORTS.BAZAAR.DEFAULT,
    hasBackend: true,
    backendPort: CORE_PORTS.BAZAAR_API.DEFAULT,
    apiPrefix: '/api',
  },
  docs: {
    url: `http://localhost:${CORE_PORTS.DOCUMENTATION.DEFAULT}`,
    port: CORE_PORTS.DOCUMENTATION.DEFAULT,
    hasBackend: false,
  },
  documentation: {
    url: `http://localhost:${CORE_PORTS.DOCUMENTATION.DEFAULT}`,
    port: CORE_PORTS.DOCUMENTATION.DEFAULT,
    hasBackend: false,
  },
  factory: {
    url: `http://localhost:${CORE_PORTS.FACTORY.DEFAULT}`,
    port: CORE_PORTS.FACTORY.DEFAULT,
    hasBackend: true,
    backendPort: CORE_PORTS.FACTORY.DEFAULT,
    apiPrefix: '/api',
  },
  autocrat: {
    url: `http://localhost:${CORE_PORTS.AUTOCRAT_API.DEFAULT}`,
    port: CORE_PORTS.AUTOCRAT_API.DEFAULT,
    hasBackend: true,
    backendPort: CORE_PORTS.AUTOCRAT_API.DEFAULT,
    apiPrefix: '/api',
  },
  crucible: {
    url: `http://localhost:${CORE_PORTS.CRUCIBLE_API.DEFAULT}`,
    port: CORE_PORTS.CRUCIBLE_API.DEFAULT,
    hasBackend: true,
    backendPort: CORE_PORTS.CRUCIBLE_API.DEFAULT,
    apiPrefix: '/api',
  },
  dws: {
    url: `http://localhost:${CORE_PORTS.DWS_API.DEFAULT}`,
    port: CORE_PORTS.DWS_API.DEFAULT,
    hasBackend: true,
    backendPort: CORE_PORTS.DWS_API.DEFAULT,
    apiPrefix: '/api',
  },
  monitoring: {
    url: `http://localhost:${CORE_PORTS.MONITORING.DEFAULT}`,
    port: CORE_PORTS.MONITORING.DEFAULT,
    hasBackend: true,
    backendPort: CORE_PORTS.NODE_EXPLORER_API.DEFAULT,
    apiPrefix: '/api',
  },
  node: {
    url: `http://localhost:${CORE_PORTS.NODE_API.DEFAULT}`,
    port: CORE_PORTS.NODE_API.DEFAULT,
    hasBackend: true,
    backendPort: CORE_PORTS.NODE_API.DEFAULT,
    apiPrefix: '/api',
  },
}

/**
 * Check if dev mode is enabled
 */
export function isDevMode(): boolean {
  return (
    process.env.DEV_MODE === 'true' ||
    process.env.NODE_ENV === 'development' ||
    process.env.JEJU_DEV === 'true'
  )
}

/**
 * Get the dev proxy URL for a JNS name
 * Returns null if no dev proxy is configured
 *
 * @param jnsName - JNS name (e.g., "bazaar" or "bazaar.jeju")
 */
export function getDevProxyUrl(jnsName: string): string | null {
  if (!isDevMode()) return null

  // Normalize name (strip .jeju suffix)
  const name = jnsName.replace(/\.jeju$/, '')

  // Check for environment variable override first
  const envKey = `DEV_PROXY_${name.toUpperCase()}_URL`
  const envUrl = process.env[envKey]
  if (envUrl) return envUrl

  // Check static mapping
  const target = DEV_PROXY_TARGETS[name]
  if (target) {
    // Check for port override
    const portEnvKey = `DEV_PROXY_${name.toUpperCase()}_PORT`
    const portOverride = process.env[portEnvKey]
    if (portOverride) {
      return `http://localhost:${portOverride}`
    }
    return target.url
  }

  return null
}

/**
 * Get the full dev proxy target configuration
 *
 * @param jnsName - JNS name (e.g., "bazaar" or "bazaar.jeju")
 */
export function getDevProxyTarget(jnsName: string): DevProxyTarget | null {
  if (!isDevMode()) return null

  const name = jnsName.replace(/\.jeju$/, '')

  // Check for custom URL override
  const envKey = `DEV_PROXY_${name.toUpperCase()}_URL`
  const envUrl = process.env[envKey]

  if (envUrl) {
    // Parse port from URL
    const urlObj = new URL(envUrl)
    return {
      url: envUrl,
      port: parseInt(urlObj.port || '80', 10),
      hasBackend: false,
    }
  }

  return DEV_PROXY_TARGETS[name] ?? null
}

/**
 * Get all configured dev proxy mappings
 */
export function getAllDevProxyMappings(): Record<string, string> {
  if (!isDevMode()) return {}

  const mappings: Record<string, string> = {}

  for (const name of Object.keys(DEV_PROXY_TARGETS)) {
    const url = getDevProxyUrl(name)
    if (url) {
      mappings[name] = url
    }
  }

  // Also check for any DEV_PROXY_*_URL environment variables
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^DEV_PROXY_([A-Z_]+)_URL$/)
    if (match?.[1] && value) {
      const name = match[1].toLowerCase().replace(/_/g, '-')
      mappings[name] = value
    }
  }

  return mappings
}

/**
 * Print dev proxy configuration (for debugging)
 */
export function printDevProxyConfig(): void {
  console.log('\n🔄 Dev Proxy Configuration:')
  console.log(`   Mode: ${isDevMode() ? 'ENABLED' : 'disabled'}`)

  if (!isDevMode()) {
    console.log('   (Set DEV_MODE=true to enable)')
    return
  }

  const mappings = getAllDevProxyMappings()
  console.log('\n   JNS Name → Local URL:')

  for (const [name, url] of Object.entries(mappings)) {
    console.log(`   ${name.padEnd(15)} → ${url}`)
  }

  console.log('')
}
