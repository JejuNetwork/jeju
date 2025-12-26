/**
 * Runtime JSON loader that works in both Bun and Node/Playwright
 *
 * Uses fs.readFileSync for maximum compatibility with Node ESM loaders
 * that don't support import attributes (`with { type: 'json' }`).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Cache for loaded JSON
const jsonCache = new Map<string, unknown>()

/**
 * Load JSON file relative to the config package root
 */
export function loadJson<T>(relativePath: string): T {
  const cached = jsonCache.get(relativePath)
  if (cached) return cached as T

  const fullPath = join(__dirname, relativePath)
  const content = readFileSync(fullPath, 'utf-8')
  const parsed = JSON.parse(content) as T

  jsonCache.set(relativePath, parsed)
  return parsed
}

// Pre-load commonly used JSON files
export const chainConfigs = {
  localnet: loadJson('./chain/localnet.json'),
  testnet: loadJson('./chain/testnet.json'),
  mainnet: loadJson('./chain/mainnet.json'),
}

export const contractsJson = loadJson('./contracts.json')
export const eilJson = loadJson('./eil.json')
export const federationJson = loadJson('./federation.json')
export const servicesJson = loadJson('./services.json')
export const vendorAppsJson = loadJson('./vendor-apps.json')

