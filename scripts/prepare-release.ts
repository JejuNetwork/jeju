#!/usr/bin/env bun
/**
 * Prepare Release 0.1.0 for All Packages
 *
 * This script:
 * 1. Updates all @jejunetwork/* package versions to 0.1.0
 * 2. Builds all packages
 * 3. Publishes them to JejuPkg registry
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { $ } from 'bun'
import { z } from 'zod'

const ROOT_DIR = resolve(import.meta.dir, '..')
const PACKAGES_DIR = join(ROOT_DIR, 'packages')
const APPS_DIR = join(ROOT_DIR, 'apps')
const TARGET_VERSION = '0.1.0'

// Package.json schema
const PackageJsonSchema = z.object({
  name: z.string(),
  version: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
}).passthrough()

type PackageJson = z.infer<typeof PackageJsonSchema>

// Packages to update (core packages in dependency order)
const CORE_PACKAGES = [
  'types',
  'config',
  'cache',
  'db',
  'contracts',
  'shared',
  'api',
  'agents',
  'a2a',
  'auth',
  'bots',
  'bridge',
  'durable-objects',
  'eliza-plugin',
  'kms',
  'mcp',
  'messaging',
  'sdk',
  'solana',
  'sqlit',
  'tests',
  'token',
  'training',
  'ui',
  'deployment',
  'cli',
]

// Packages to skip (vendored, templates, etc.)
const SKIP_PACKAGES = [
  'workerd', // Vendored cloudflare workerd
]

// Apps to update
const APPS = [
  'autocrat',
  'bazaar',
  'crucible',
  'documentation',
  'dws',
  'example',
  'factory',
  'gateway',
  'indexer',
  'monitoring',
  'node',
  'oauth3',
  'otto',
  'vpn',
  'wallet',
]

interface UpdateResult {
  path: string
  name: string
  oldVersion: string
  newVersion: string
  updated: boolean
}

function loadPackageJson(dir: string): PackageJson {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`)
  }
  const content = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  return PackageJsonSchema.parse(content)
}

function savePackageJson(dir: string, pkg: PackageJson): void {
  const pkgPath = join(dir, 'package.json')
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

function updateVersion(dir: string, targetVersion: string): UpdateResult {
  const pkg = loadPackageJson(dir)
  const oldVersion = pkg.version

  if (oldVersion === targetVersion) {
    return {
      path: dir,
      name: pkg.name,
      oldVersion,
      newVersion: targetVersion,
      updated: false,
    }
  }

  pkg.version = targetVersion
  savePackageJson(dir, pkg)

  return {
    path: dir,
    name: pkg.name,
    oldVersion,
    newVersion: targetVersion,
    updated: true,
  }
}

async function updatePackages(): Promise<UpdateResult[]> {
  const results: UpdateResult[] = []

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║            UPDATING PACKAGE VERSIONS TO 0.1.0              ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Update core packages
  console.log('Updating core packages...')
  for (const pkg of CORE_PACKAGES) {
    if (SKIP_PACKAGES.includes(pkg)) {
      console.log(`  ⏭️  ${pkg} (skipped)`)
      continue
    }

    const pkgDir = join(PACKAGES_DIR, pkg)
    if (!existsSync(pkgDir)) {
      console.log(`  ⚠️  ${pkg} (not found)`)
      continue
    }

    const result = updateVersion(pkgDir, TARGET_VERSION)
    results.push(result)

    if (result.updated) {
      console.log(`  ✓ ${result.name}: ${result.oldVersion} -> ${result.newVersion}`)
    } else {
      console.log(`  ○ ${result.name}: already at ${result.newVersion}`)
    }
  }

  // Handle sqlit adapter separately
  const sqlitAdapterDir = join(PACKAGES_DIR, 'sqlit', 'adapter')
  if (existsSync(sqlitAdapterDir)) {
    const result = updateVersion(sqlitAdapterDir, TARGET_VERSION)
    results.push(result)
    if (result.updated) {
      console.log(`  ✓ ${result.name}: ${result.oldVersion} -> ${result.newVersion}`)
    } else {
      console.log(`  ○ ${result.name}: already at ${result.newVersion}`)
    }
  }

  console.log('')
  console.log('Updating apps...')
  for (const app of APPS) {
    const appDir = join(APPS_DIR, app)
    if (!existsSync(appDir)) {
      console.log(`  ⚠️  ${app} (not found)`)
      continue
    }

    const result = updateVersion(appDir, TARGET_VERSION)
    results.push(result)

    if (result.updated) {
      console.log(`  ✓ ${result.name}: ${result.oldVersion} -> ${result.newVersion}`)
    } else {
      console.log(`  ○ ${result.name}: already at ${result.newVersion}`)
    }
  }

  // Update root package.json
  console.log('')
  console.log('Updating root package.json...')
  const rootResult = updateVersion(ROOT_DIR, TARGET_VERSION)
  results.push(rootResult)
  if (rootResult.updated) {
    console.log(`  ✓ ${rootResult.name}: ${rootResult.oldVersion} -> ${rootResult.newVersion}`)
  } else {
    console.log(`  ○ ${rootResult.name}: already at ${rootResult.newVersion}`)
  }

  return results
}

async function buildPackages(): Promise<boolean> {
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  BUILDING ALL PACKAGES                     ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Build packages in dependency order
  const buildOrder = [
    'types',
    'config',
    'contracts',
    'cache',
    'db',
    'shared',
    'api',
  ]

  for (const pkg of buildOrder) {
    const pkgDir = join(PACKAGES_DIR, pkg)
    if (!existsSync(pkgDir)) continue

    console.log(`  Building ${pkg}...`)
    const result = await $`bun run build`.cwd(pkgDir).quiet().nothrow()
    
    if (result.exitCode !== 0) {
      console.log(`  ❌ Failed to build ${pkg}`)
      console.log(result.stderr.toString())
      return false
    }
    console.log(`  ✓ ${pkg} built successfully`)
  }

  return true
}

async function publishPackages(dryRun = false): Promise<void> {
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║             PUBLISHING PACKAGES TO JEJUPKG                 ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  if (dryRun) {
    console.log('DRY RUN - packages will not be published')
    console.log('')
  }

  // Publish in dependency order
  const publishOrder = [
    'types',
    'config',
    'contracts',
    'cache',
    'db',
    'shared',
    'api',
    'agents',
    'a2a',
    'auth',
    'bots',
    'bridge',
    'durable-objects',
    'eliza-plugin',
    'kms',
    'mcp',
    'messaging',
    'sdk',
    'solana',
    'sqlit',
    'tests',
    'token',
    'training',
    'ui',
    'deployment',
    'cli',
  ]

  for (const pkg of publishOrder) {
    if (SKIP_PACKAGES.includes(pkg)) continue

    const pkgDir = join(PACKAGES_DIR, pkg)
    if (!existsSync(pkgDir)) continue

    const pkgJson = loadPackageJson(pkgDir)
    console.log(`  Publishing ${pkgJson.name}@${pkgJson.version}...`)

    if (dryRun) {
      console.log(`    [DRY RUN] Would publish ${pkgJson.name}@${pkgJson.version}`)
      continue
    }

    const result = await $`bun run jeju pkg publish ${pkgDir}`.cwd(ROOT_DIR).quiet().nothrow()
    
    if (result.exitCode !== 0) {
      console.log(`  ⚠️  Failed to publish ${pkgJson.name}: ${result.stderr.toString().slice(0, 200)}`)
    } else {
      console.log(`  ✓ ${pkgJson.name}@${pkgJson.version} published`)
    }
  }
}

function printSummary(results: UpdateResult[]): void {
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                        SUMMARY                             ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  const updated = results.filter((r) => r.updated)
  const unchanged = results.filter((r) => !r.updated)

  console.log(`Total packages processed: ${results.length}`)
  console.log(`  Updated: ${updated.length}`)
  console.log(`  Already at ${TARGET_VERSION}: ${unchanged.length}`)
  console.log('')

  if (updated.length > 0) {
    console.log('Updated packages:')
    for (const r of updated) {
      console.log(`  ${r.name}: ${r.oldVersion} -> ${r.newVersion}`)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const skipBuild = args.includes('--skip-build')
  const skipPublish = args.includes('--skip-publish')
  const versionOnly = args.includes('--version-only')

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║         JEJU RELEASE PREPARATION - VERSION 0.1.0           ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`Target version: ${TARGET_VERSION}`)
  console.log(`Dry run: ${dryRun}`)
  console.log(`Skip build: ${skipBuild}`)
  console.log(`Skip publish: ${skipPublish}`)
  console.log('')

  // Step 1: Update versions
  const results = await updatePackages()

  if (versionOnly) {
    printSummary(results)
    console.log('')
    console.log('Version update complete. Use --skip-publish=false to also publish.')
    return
  }

  // Step 2: Build packages
  if (!skipBuild) {
    const buildSuccess = await buildPackages()
    if (!buildSuccess) {
      console.error('Build failed. Aborting.')
      process.exit(1)
    }
  }

  // Step 3: Publish packages
  if (!skipPublish) {
    await publishPackages(dryRun)
  }

  printSummary(results)

  console.log('')
  console.log('Release preparation complete.')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Review changes: git diff')
  console.log('  2. Commit: git commit -am "release: 0.1.0"')
  console.log('  3. Tag: git tag v0.1.0')
  console.log('  4. Push: git push && git push --tags')
}

main().catch((err) => {
  console.error('Release preparation failed:', err)
  process.exit(1)
})
