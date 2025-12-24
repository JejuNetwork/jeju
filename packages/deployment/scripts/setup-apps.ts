#!/usr/bin/env bun

/**
 * Setup Script - Initializes workspace apps, vendor apps, and test infrastructure
 * Runs after bun install (postinstall hook)
 *
 * This script is safe to fail - it's a best-effort setup
 */

import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join, relative } from 'node:path'
import { $ } from 'bun'
import { discoverVendorApps } from './shared/discover-apps'
import {
  getHostsBlockStatus,
  hasJejuHostsBlock,
  installPortForwarding,
  isPortForwardingActive,
} from './shared/local-proxy'

/**
 * Ensure workspace packages are properly symlinked in node_modules
 * Bun workspaces should do this automatically but sometimes symlinks are missing
 */
function ensureWorkspaceSymlinks(): void {
  const nodeModulesPath = join(process.cwd(), 'node_modules')
  const jejuScopePath = join(nodeModulesPath, '@jejunetwork')

  // Create @jejunetwork scope if it doesn't exist
  if (!existsSync(jejuScopePath)) {
    mkdirSync(jejuScopePath, { recursive: true })
  }

  // Map of package names to their paths
  const workspacePackages: Record<string, string> = {
    // packages/*
    cli: 'packages/cli',
    config: 'packages/config',
    contracts: 'packages/contracts',
    types: 'packages/types',
    tests: 'packages/tests',
    deployment: 'packages/deployment',
    shared: 'packages/shared',
    messaging: 'packages/messaging',
    kms: 'packages/kms',
    db: 'packages/db',
    // apps/*
    dws: 'apps/dws',
    gateway: 'apps/gateway',
    crucible: 'apps/crucible',
    documentation: 'apps/documentation',
    monitoring: 'apps/monitoring',
    org: 'apps/org',
  }

  let linkedCount = 0

  for (const [name, sourcePath] of Object.entries(workspacePackages)) {
    const fullSourcePath = join(process.cwd(), sourcePath)
    const symlinkPath = join(jejuScopePath, name)

    // Only create symlink if source exists and symlink doesn't
    if (existsSync(fullSourcePath) && !existsSync(symlinkPath)) {
      const relativePath = relative(jejuScopePath, fullSourcePath)
      symlinkSync(relativePath, symlinkPath)
      linkedCount++
    }
  }

  if (linkedCount > 0) {
    console.log(`   ✅ Created ${linkedCount} workspace symlinks`)
  } else {
    console.log('   ✅ Workspace symlinks verified')
  }
}

const SYNPRESS_CACHE_DIR = '.jeju/.synpress-cache'

interface VendorAppConfig {
  name: string
  url: string
  path: string
  description?: string
  private: boolean
  optional: boolean
  branch: string
}

interface VendorAppsConfig {
  apps: VendorAppConfig[]
}

function loadVendorAppsConfig(): VendorAppsConfig {
  const configPath = join(process.cwd(), 'packages/config/vendor-apps.json')
  if (!existsSync(configPath)) {
    return { apps: [] }
  }
  const content = readFileSync(configPath, 'utf-8')
  return JSON.parse(content)
}

async function checkGitAccess(url: string): Promise<boolean> {
  // Use git ls-remote to check access to the specific repo (fast, no clone)
  const result = await $`git ls-remote --exit-code ${url} HEAD`
    .nothrow()
    .quiet()
  return result.exitCode === 0
}

async function ensureCorrectBranch(
  appPath: string,
  branch: string,
): Promise<void> {
  const currentBranch = await $`git -C ${appPath} branch --show-current`
    .nothrow()
    .quiet()
  if (currentBranch.exitCode !== 0) {
    throw new Error(
      `Failed to get current branch for ${appPath}: ${currentBranch.stderr.toString()}`,
    )
  }

  const current = currentBranch.stdout.toString().trim()

  if (current !== branch) {
    // Try to checkout the correct branch
    const checkoutResult = await $`git -C ${appPath} checkout ${branch}`
      .nothrow()
      .quiet()
    if (checkoutResult.exitCode !== 0) {
      // Branch might not exist locally, try fetching and checking out
      const fetchResult = await $`git -C ${appPath} fetch origin ${branch}`
        .nothrow()
        .quiet()
      if (fetchResult.exitCode !== 0) {
        throw new Error(
          `Failed to fetch branch ${branch} for ${appPath}: ${fetchResult.stderr.toString()}`,
        )
      }

      const createBranchResult =
        await $`git -C ${appPath} checkout -b ${branch} origin/${branch}`
          .nothrow()
          .quiet()
      if (createBranchResult.exitCode !== 0) {
        throw new Error(
          `Failed to checkout branch ${branch} for ${appPath}: ${createBranchResult.stderr.toString()}`,
        )
      }
    }
  }
}

async function installDependencies(
  appPath: string,
  appName: string,
): Promise<boolean> {
  // Check if package.json exists
  if (!existsSync(join(appPath, 'package.json'))) {
    return true // No dependencies to install
  }

  console.log(`   📦 Installing ${appName} dependencies...`)
  const result = await $`cd ${appPath} && bun install --frozen-lockfile`
    .nothrow()
    .quiet()

  if (result.exitCode !== 0) {
    console.log(
      `   ⚠️  Frozen lockfile install failed, trying without lockfile...`,
    )

    // Try without frozen lockfile
    const retryResult = await $`cd ${appPath} && bun install`.nothrow().quiet()
    if (retryResult.exitCode !== 0) {
      const retryError =
        retryResult.stderr.toString() || retryResult.stdout.toString()
      console.error(`   ❌ Failed to install dependencies for ${appName}`)
      console.error(`   Error: ${retryError.split('\n')[0]}`)
      return false
    }
  }

  return true
}

async function cloneVendorApp(
  app: VendorAppConfig,
): Promise<'cloned' | 'exists' | 'skipped'> {
  const fullPath = join(process.cwd(), app.path)

  // Already exists
  if (existsSync(fullPath) && existsSync(join(fullPath, '.git'))) {
    // Ensure on correct branch
    await ensureCorrectBranch(fullPath, app.branch)
    return 'exists'
  }

  // Check access for private repos
  if (app.private) {
    const hasAccess = await checkGitAccess(app.url)
    if (!hasAccess) {
      console.log(`   ⏭️  ${app.name} - no access (private repo, skipping)`)
      return 'skipped'
    }
  }

  // Try git submodule first
  console.log(`   📥 Cloning ${app.name}...`)

  // Check if already registered as submodule
  const gitmodulesPath = join(process.cwd(), '.gitmodules')
  const isSubmodule =
    existsSync(gitmodulesPath) &&
    readFileSync(gitmodulesPath, 'utf-8').includes(`path = ${app.path}`)

  if (isSubmodule) {
    // Init existing submodule
    const result = await $`git submodule update --init --recursive ${app.path}`
      .nothrow()
      .quiet()
    if (result.exitCode === 0) {
      // Ensure on correct branch
      await ensureCorrectBranch(fullPath, app.branch)
      console.log(`   ✅ ${app.name} initialized (submodule)`)
      return 'cloned'
    }
  }

  // Clone directly if not a submodule
  const parentDir = join(fullPath, '..')
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }

  const cloneResult =
    await $`git clone --depth 1 --branch ${app.branch} ${app.url} ${fullPath}`
      .nothrow()
      .quiet()

  if (cloneResult.exitCode === 0) {
    console.log(`   ✅ ${app.name} cloned`)
    return 'cloned'
  }

  const stderr = cloneResult.stderr.toString()
  if (
    stderr.includes('Permission denied') ||
    stderr.includes('Repository not found')
  ) {
    console.log(`   ⏭️  ${app.name} - permission denied (skipping)`)
  } else {
    console.log(`   ⚠️  ${app.name} - clone failed: ${stderr.split('\n')[0]}`)
  }

  return 'skipped'
}

async function setupVendorApps(): Promise<string[]> {
  console.log('📦 Setting up vendor apps...\n')

  const config = loadVendorAppsConfig()

  if (config.apps.length === 0) {
    console.log('   ℹ️  No vendor apps configured\n')
    return []
  }

  console.log(`   Found ${config.apps.length} vendor app(s) in config\n`)

  let cloned = 0
  let skipped = 0
  let existing = 0
  const newlyCloned: string[] = []

  for (const app of config.apps) {
    const result = await cloneVendorApp(app)

    switch (result) {
      case 'cloned':
        cloned++
        newlyCloned.push(app.path)
        break
      case 'exists':
        console.log(`   ✅ ${app.name} already exists`)
        existing++
        break
      case 'skipped':
        skipped++
        break
    }
  }

  console.log('')
  console.log(
    `   📊 Summary: ${existing} existing, ${cloned} cloned, ${skipped} skipped\n`,
  )

  return newlyCloned
}

async function main() {
  console.log('🔧 Setting up network workspace...\n')

  // 1. Initialize git submodules (contract libs)
  // Note: This is optional - submodules can be initialized manually if needed
  console.log('📚 Initializing contract libraries...\n')
  console.log('   (Attempting with 30s timeout - will skip if too slow)\n')

  // Try to initialize submodules with a short timeout to avoid hanging
  // Use depth=1 to speed up cloning
  let timedOut = false
  let exitCode = 0
  let errorMessage = ''

  try {
    // Run git submodule with timeout using Bun's built-in timeout
    const result =
      await $`timeout 30 git submodule update --init --recursive --depth 1 packages/contracts/lib/`
        .nothrow()
        .quiet()

    exitCode = result.exitCode
    if (exitCode === 124) {
      timedOut = true
      errorMessage = 'Operation timed out after 30s'
    } else if (exitCode !== 0) {
      errorMessage = result.stderr.toString()
    }
  } catch (err) {
    exitCode = 1
    errorMessage = err instanceof Error ? err.message : String(err)
  }

  if (exitCode === 0) {
    console.log('   ✅ Contract libraries synced\n')
  } else if (timedOut) {
    console.log(
      '   ⏭️  Skipped (timed out after 30s - large repos can be slow)\n',
    )
    console.log(
      '   ℹ️  To initialize manually: git submodule update --init --recursive\n',
    )
  } else {
    console.log(
      `   ⚠️  Could not sync: ${errorMessage.split('\n')[0] || 'unknown error'}\n`,
    )
    console.log(
      '   ℹ️  To initialize manually: git submodule update --init --recursive\n',
    )
  }

  // 2. Setup vendor apps (check access and clone if available)
  const newlyCloned = await setupVendorApps()

  // 3. Install dependencies for newly cloned vendor apps
  if (newlyCloned.length > 0) {
    console.log('📦 Installing dependencies for newly cloned apps...\n')

    for (const appPath of newlyCloned) {
      const appName = appPath.split('/').pop() || appPath
      const fullPath = join(process.cwd(), appPath)

      const success = await installDependencies(fullPath, appName)
      if (success) {
        console.log(`   ✅ ${appName} dependencies installed`)
      } else {
        console.log(
          `   ⚠️  ${appName} dependency install failed (run 'bun install' in ${appPath})`,
        )
      }
    }
    console.log('')
  }

  // 4. Discover and report on vendor apps with manifests
  console.log('🎮 Discovering vendor apps...\n')
  const vendorApps = discoverVendorApps()

  if (vendorApps.length === 0) {
    console.log('   ℹ️  No vendor apps with jeju-manifest.json found\n')
  } else {
    console.log(
      `   Found ${vendorApps.length} vendor app(s) with jeju-manifest.json:`,
    )
    for (const app of vendorApps) {
      const status = app.exists ? '✅' : '⚠️'
      console.log(`   ${status} ${app.manifest.displayName || app.name}`)
    }
    console.log('')
  }

  // 5. Check core dependencies
  console.log('🔍 Checking core dependencies...')

  if (existsSync('packages/contracts')) {
    console.log('   ✅ Contracts found')
  }

  if (existsSync('packages/config')) {
    console.log('   ✅ Config found')
  }

  if (existsSync('packages/tests')) {
    console.log('   ✅ Test utilities found')
  }

  console.log('')

  // 6. Ensure workspace symlinks exist
  console.log('🔗 Verifying workspace symlinks...')
  ensureWorkspaceSymlinks()
  console.log('')

  // 7. Setup Synpress cache directory
  console.log('🧪 Setting up test infrastructure...')

  if (!existsSync(SYNPRESS_CACHE_DIR)) {
    mkdirSync(SYNPRESS_CACHE_DIR, { recursive: true })
    console.log('   ✅ Created synpress cache directory\n')
  } else {
    console.log('   ✅ Synpress cache directory exists\n')
  }

  // 8. Install Playwright browsers (needed for Synpress)
  console.log('   🎭 Installing Playwright browsers...')
  const playwrightResult = await $`bunx playwright install chromium`
    .nothrow()
    .quiet()

  if (playwrightResult.exitCode === 0) {
    console.log('   ✅ Playwright browsers installed\n')
  } else {
    console.log(
      '   ⚠️  Could not install Playwright browsers (run: bunx playwright install)\n',
    )
  }

  // 9. Check local development hosts file
  console.log('🌐 Checking local development DNS...')

  if (hasJejuHostsBlock()) {
    console.log('   ✅ Hosts file configured for local.jejunetwork.org\n')
  } else {
    console.log('   ℹ️  Hosts file not configured for local development')
    console.log(
      '   ℹ️  This enables clean URLs like http://gateway.local.jejunetwork.org\n',
    )

    // Check if running interactively
    const isInteractive = process.stdin.isTTY && !process.env.CI

    if (isInteractive) {
      console.log(
        '   Would you like to configure the hosts file now? (requires sudo)',
      )
      console.log('   Run: jeju proxy hosts:add\n')
    } else {
      console.log('   To configure manually, run:')
      console.log('   jeju proxy hosts:add\n')

      // Show what would be added
      const status = getHostsBlockStatus()
      console.log('   Or add these lines to /etc/hosts:')
      console.log(`   ${status.expected.split('\n').join('\n   ')}`)
      console.log('')
    }
  }

  // 10. Setup port forwarding for port 80 (clean URLs)
  const portForwardingActive = await isPortForwardingActive()

  if (portForwardingActive) {
    console.log('🔌 Port forwarding already configured (port 80 → 8080)\n')
  } else {
    // Skip in CI or non-interactive environments
    const isCI = Boolean(process.env.CI)
    const isInteractive = process.stdin.isTTY

    if (isCI) {
      console.log('🔌 Skipping port forwarding setup (CI environment)\n')
    } else if (!isInteractive) {
      console.log('🔌 Skipping port forwarding setup (non-interactive)\n')
    } else {
      // Interactive terminal - try to install with sudo prompt
      console.log('🔌 Setting up port forwarding (port 80 → 8080)...')
      console.log(
        '   (This requires sudo - you may be prompted for your password)\n',
      )
      const success = await installPortForwarding()
      if (success) {
        console.log('   ✅ Port forwarding installed\n')
      } else {
        console.log('   ⚠️  Port forwarding setup failed or was cancelled\n')
      }
    }
  }

  // 11. Summary
  console.log('✅ Workspace setup complete\n')
  console.log('Next steps:')
  console.log('  • Start development: bun run dev')
  console.log('  • Run all tests: bun test')
  console.log('  • Run wallet tests: bun run test:wallet')
  console.log('  • Build synpress cache: bun run synpress:cache\n')
}

main().catch((err) => {
  const errorMessage = err instanceof Error ? err.message : String(err)
  const errorStack = err instanceof Error ? err.stack : undefined

  console.error('\n❌ Setup failed:')
  console.error(`   ${errorMessage}`)
  if (errorStack && process.env.DEBUG) {
    console.error('\nStack trace:')
    console.error(errorStack)
  }
  console.error('\n⚠️  Setup completed with errors. Some features may not work.')
  console.error('   You can re-run setup manually: jeju init\n')

  // Exit with 0 to not break install, but log the error clearly
  process.exit(0)
})
