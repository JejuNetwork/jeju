/**
 * Validation commands for manifests, configs, etc.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import {
  discoverCoreApps,
  discoverVendorApps,
} from '../../../../packages/deployment/scripts/shared/discover-apps'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

interface ValidationResult {
  app: string
  path: string
  valid: boolean
  errors: string[]
  warnings: string[]
  features: {
    jns: boolean
    cdn: boolean
    ipfs: boolean
    serviceWorker: boolean
    offlineSupport: boolean
  }
}

function validateManifest(appPath: string): ValidationResult {
  const manifestPath = join(appPath, 'jeju-manifest.json')
  const errors: string[] = []
  const warnings: string[] = []
  const features = {
    jns: false,
    cdn: false,
    ipfs: false,
    serviceWorker: false,
    offlineSupport: false,
  }

  if (!existsSync(manifestPath)) {
    return {
      app: appPath.split('/').pop() ?? 'unknown',
      path: appPath,
      valid: false,
      errors: ['No jeju-manifest.json found'],
      warnings: [],
      features,
    }
  }

  const content = readFileSync(manifestPath, 'utf-8')
  const manifest = JSON.parse(content)

  // Check JNS configuration
  if (manifest.jns?.name) {
    features.jns = true
  } else {
    warnings.push('No JNS name configured')
  }

  // Check CDN configuration
  const cdn = manifest.decentralization?.cdn
  if (cdn?.enabled) {
    features.cdn = true

    if (!cdn.regions || cdn.regions.length === 0) {
      warnings.push('No CDN regions specified')
    }

    if (cdn.serviceWorker) {
      features.serviceWorker = true
    }
  }

  // Check frontend decentralization
  const frontend = manifest.decentralization?.frontend
  if (frontend?.ipfs) {
    features.ipfs = true
  }

  // Check robustness
  const robustness = manifest.decentralization?.robustness
  if (robustness?.offlineSupport) {
    features.offlineSupport = true
  }

  // Check for missing health check
  if (!manifest.healthCheck?.url && !manifest.healthCheck?.endpoint) {
    warnings.push('No health check endpoint configured')
  }

  // Check agent configuration
  if (manifest.agent?.enabled && !manifest.agent.jnsName) {
    warnings.push('Agent enabled but no JNS name for agent')
  }

  // Validate required fields
  if (!manifest.name) {
    errors.push('Missing required field: name')
  }
  if (!manifest.version) {
    errors.push('Missing required field: version')
  }

  return {
    app: manifest.name || appPath.split('/').pop() || 'unknown',
    path: appPath,
    valid: errors.length === 0,
    errors,
    warnings,
    features,
  }
}

function printResults(results: ValidationResult[]): void {
  logger.newline()
  logger.info('📋 Manifest Validation Results')
  logger.newline()

  const valid = results.filter((r) => r.valid)
  const invalid = results.filter((r) => !r.valid)

  // Print summary table
  console.log(
    '┌─────────────────────────┬───────┬──────┬──────┬─────┬────────────────┐',
  )
  console.log(
    '│ App                     │ Valid │ JNS  │ CDN  │ SW  │ Offline        │',
  )
  console.log(
    '├─────────────────────────┼───────┼──────┼──────┼─────┼────────────────┤',
  )

  for (const result of results) {
    const app = result.app.padEnd(23).slice(0, 23)
    const validStr = result.valid ? '  ✅  ' : '  ❌  '
    const jns = result.features.jns ? '  ✅ ' : '  ❌ '
    const cdn = result.features.cdn ? '  ✅ ' : '  ❌ '
    const sw = result.features.serviceWorker ? ' ✅ ' : ' ❌ '
    const offline = result.features.offlineSupport
      ? '      ✅       '
      : '      ❌       '
    console.log(`│ ${app} │${validStr}│${jns}│${cdn}│${sw}│${offline}│`)
  }

  console.log(
    '└─────────────────────────┴───────┴──────┴──────┴─────┴────────────────┘',
  )

  // Print errors
  if (invalid.length > 0) {
    logger.newline()
    logger.error('❌ Apps with Errors:')
    logger.newline()
    for (const result of invalid) {
      logger.info(`  ${result.app}:`)
      for (const error of result.errors) {
        logger.info(`    ❌ ${error}`)
      }
    }
  }

  // Print warnings
  const withWarnings = results.filter((r) => r.warnings.length > 0)
  if (withWarnings.length > 0) {
    logger.newline()
    logger.warn('⚠️  Warnings:')
    logger.newline()
    for (const result of withWarnings) {
      logger.info(`  ${result.app}:`)
      for (const warning of result.warnings) {
        logger.info(`    ⚠️  ${warning}`)
      }
    }
  }

  // Summary
  const totalFeatures = results.reduce(
    (acc, r) => ({
      jns: acc.jns + (r.features.jns ? 1 : 0),
      cdn: acc.cdn + (r.features.cdn ? 1 : 0),
      ipfs: acc.ipfs + (r.features.ipfs ? 1 : 0),
      serviceWorker: acc.serviceWorker + (r.features.serviceWorker ? 1 : 0),
      offlineSupport: acc.offlineSupport + (r.features.offlineSupport ? 1 : 0),
    }),
    { jns: 0, cdn: 0, ipfs: 0, serviceWorker: 0, offlineSupport: 0 },
  )

  logger.newline()
  logger.info('📊 Summary:')
  logger.info(`   Total apps: ${results.length}`)
  logger.info(`   Valid: ${valid.length} | Invalid: ${invalid.length}`)
  logger.info(`   JNS configured: ${totalFeatures.jns}/${results.length}`)
  logger.info(`   CDN enabled: ${totalFeatures.cdn}/${results.length}`)
  logger.info(`   IPFS deployment: ${totalFeatures.ipfs}/${results.length}`)
  logger.info(
    `   Service Workers: ${totalFeatures.serviceWorker}/${results.length}`,
  )
  logger.info(
    `   Offline Support: ${totalFeatures.offlineSupport}/${results.length}`,
  )
  logger.newline()
}

const validateCommand = new Command('validate')
  .description('Validate manifests, configs, and deployments')
  .alias('check')

validateCommand
  .command('manifests')
  .description('Validate all jeju-manifest.json files')
  .action(async () => {
    const rootDir = findMonorepoRoot()

    logger.header('VALIDATE MANIFESTS')

    // Discover all apps
    const coreApps = discoverCoreApps(rootDir)
    const vendorApps = discoverVendorApps(rootDir)
    const allApps = [...coreApps, ...vendorApps]

    logger.info(
      `Discovered ${allApps.length} apps (${coreApps.length} core, ${vendorApps.length} vendor)`,
    )
    logger.newline()

    // Validate each app
    const results: ValidationResult[] = []

    for (const app of allApps) {
      const result = validateManifest(app.path)
      results.push(result)
    }

    printResults(results)

    // Exit with error if any invalid
    const hasErrors = results.some((r) => !r.valid)
    if (hasErrors) {
      process.exit(1)
    }
  })

validateCommand
  .command('config')
  .description('Validate all configuration files')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/validate-config.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Config validation script not found')
      process.exit(1)
    }

    await execa('bun', ['run', scriptPath], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

export { validateCommand }
