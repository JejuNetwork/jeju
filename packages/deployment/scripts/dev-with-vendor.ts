#!/usr/bin/env bun

/**
 * Start vendor apps only (requires chain running separately)
 * @internal Used by CLI: `jeju dev --vendor-only`
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'

const ROOT = join(import.meta.dir, '../../..')
const VENDOR_DIR = join(ROOT, 'vendor')

interface VendorApp {
  name: string
  path: string
  devCommand?: string
  port?: number
}

interface JejuManifest {
  devCommand?: string
  ports?: {
    main?: number
  }
}

async function discoverVendorApps(): Promise<VendorApp[]> {
  if (!existsSync(VENDOR_DIR)) {
    return []
  }

  const apps: VendorApp[] = []
  const entries = readdirSync(VENDOR_DIR, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const appPath = join(VENDOR_DIR, entry.name)
    const manifestPath = join(appPath, 'jeju-manifest.json')

    if (existsSync(manifestPath)) {
      const manifest = (await Bun.file(manifestPath).json()) as JejuManifest
      apps.push({
        name: entry.name,
        path: appPath,
        devCommand: manifest.devCommand ?? 'bun run dev',
        port: manifest.ports?.main,
      })
    }
  }

  return apps
}

async function main() {
  console.log('Starting vendor apps...\n')

  const apps = await discoverVendorApps()

  if (apps.length === 0) {
    console.log('No vendor apps found in vendor/ directory')
    console.log('Add vendor apps with: jeju vendor add <repo-url>')
    process.exit(0)
  }

  console.log(`Found ${apps.length} vendor apps:`)
  for (const app of apps) {
    console.log(`  - ${app.name} (port ${app.port || 'auto'})`)
  }
  console.log('')

  // Start all vendor apps
  const processes: Promise<void>[] = []

  for (const app of apps) {
    const cmd = app.devCommand || 'bun run dev'
    console.log(`Starting ${app.name}: ${cmd}`)

    const proc = $`cd ${app.path} && ${cmd}`.quiet()
    processes.push(
      proc.then(() => {
        /* process completed */
      }),
    )
  }

  // Wait for Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nStopping vendor apps...')
    process.exit(0)
  })

  await Promise.all(processes)
}

main()
