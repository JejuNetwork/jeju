/** Publish workspace packages to JejuPkg */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { validate } from '../schemas'

const PACKAGES = ['types', 'config', 'contracts', 'sdk', 'cli']

const PackageJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
})

type PackageJson = z.infer<typeof PackageJsonSchema>

export const publishCommand = new Command('publish')
  .description('Publish workspace packages to JejuPkg (npm CLI compatible)')
  .option('--dry-run', 'Simulate without publishing')
  .option('--skip-build', 'Skip building packages')
  .option('--package <name>', 'Publish specific package only')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const dryRun = options.dryRun === true
    const skipBuild = options.skipBuild === true
    const singlePackage = options.package

    logger.header('PUBLISH PACKAGES')

    if (dryRun) {
      logger.warn('DRY RUN - no packages will be published')
      logger.newline()
    }

    const packagesToPublish = singlePackage ? [singlePackage] : PACKAGES

    // Get current versions
    const versions = getVersions(rootDir)
    logger.subheader('Package Versions')
    for (const [name, version] of versions) {
      logger.keyValue(name, version)
    }
    logger.newline()

    // Store original package.json contents for restoration
    const originals = new Map<string, string>()

    try {
      // Phase 1: Replace workspace:* references
      for (const pkg of packagesToPublish) {
        const pkgPath = getPackagePath(rootDir, pkg)
        if (!existsSync(pkgPath)) {
          logger.warn(`Package not found: ${pkg}`)
          continue
        }

        const packageJsonPath = join(pkgPath, 'package.json')
        originals.set(pkg, readFileSync(packageJsonPath, 'utf-8'))

        const data = readPackageJson(rootDir, pkg)
        data.dependencies = replaceWorkspaceRefs(data.dependencies, versions)
        data.peerDependencies = replaceWorkspaceRefs(
          data.peerDependencies,
          versions,
        )
        data.devDependencies = replaceWorkspaceRefs(
          data.devDependencies,
          versions,
        )
        writePackageJson(rootDir, pkg, data)
      }
      logger.success('Workspace references replaced')
      logger.newline()

      if (!skipBuild) {
        logger.step('Building packages')
        for (const pkg of packagesToPublish) {
          const pkgPath = getPackagePath(rootDir, pkg)
          if (!existsSync(pkgPath)) continue

          const pkgJson = readPackageJson(rootDir, pkg)
          if (pkgJson.scripts?.build) {
            logger.info(`  Building ${pkg}...`)
            if (!dryRun) {
              await execa('bun', ['run', 'build'], {
                cwd: pkgPath,
                stdio: 'pipe',
              })
            }
          }
        }
        logger.success('Packages built')
        logger.newline()
      }

      logger.step('Publishing to JejuPkg')
      for (const pkg of packagesToPublish) {
        const pkgPath = getPackagePath(rootDir, pkg)
        if (!existsSync(pkgPath)) continue

        const pkgJson = readPackageJson(rootDir, pkg)
        logger.info(`  ${pkgJson.name}@${pkgJson.version}`)

        if (!dryRun) {
          await execa('npm', ['publish', '--access', 'public'], {
            cwd: pkgPath,
            stdio: 'pipe',
          })
          logger.success(`  Published ${pkgJson.name}`)
        } else {
          logger.info(
            `  [dry-run] Would publish ${pkgJson.name}@${pkgJson.version}`,
          )
        }
      }

      logger.newline()
      logger.success('All packages published')
    } finally {
      logger.newline()
      logger.step('Restoring workspace:* references')
      for (const pkg of packagesToPublish) {
        const original = originals.get(pkg)
        if (original) {
          const packageJsonPath = join(
            getPackagePath(rootDir, pkg),
            'package.json',
          )
          writeFileSync(packageJsonPath, original)
        }
      }
      logger.success('References restored')
    }
  })

function getPackagePath(rootDir: string, pkg: string): string {
  return join(rootDir, 'packages', pkg)
}

function readPackageJson(rootDir: string, pkg: string): PackageJson {
  const path = join(getPackagePath(rootDir, pkg), 'package.json')
  const rawData = JSON.parse(readFileSync(path, 'utf-8'))
  return validate(rawData, PackageJsonSchema, `package.json for ${pkg}`)
}

function writePackageJson(
  rootDir: string,
  pkg: string,
  data: PackageJson,
): void {
  const path = join(getPackagePath(rootDir, pkg), 'package.json')
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
}

function getVersions(rootDir: string): Map<string, string> {
  const versions = new Map<string, string>()
  for (const pkg of PACKAGES) {
    const pkgPath = getPackagePath(rootDir, pkg)
    if (!existsSync(pkgPath)) continue
    const data = readPackageJson(rootDir, pkg)
    versions.set(data.name, data.version)
  }
  return versions
}

function replaceWorkspaceRefs(
  deps: Record<string, string> | undefined,
  versions: Map<string, string>,
): Record<string, string> | undefined {
  if (!deps) return deps

  const result: Record<string, string> = {}
  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith('workspace:')) {
      const realVersion = versions.get(name)
      if (realVersion) {
        result[name] = `^${realVersion}`
      } else {
        result[name] = version
      }
    } else {
      result[name] = version
    }
  }
  return result
}

const PublishPackageJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  private: z.boolean().optional(),
  main: z.string().optional(),
  types: z.string().optional(),
  license: z.string().optional(),
  repository: z
    .object({
      type: z.string(),
      url: z.string(),
      directory: z.string().optional(),
    })
    .optional(),
  publishConfig: z.object({ access: z.string() }).optional(),
  files: z.array(z.string()).optional(),
})

interface ValidationResult {
  package: string
  valid: boolean
  errors: string[]
  warnings: string[]
  files: string[]
}

const REQUIRED_STRING_FIELDS = [
  'name',
  'version',
  'main',
  'types',
  'license',
] as const

publishCommand
  .command('check')
  .description('Check packages for npm publishing readiness')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    const packagesDir = join(rootDir, 'packages')

    logger.header('PUBLISH CHECK')
    logger.info('Checking packages for npm publishing readiness...')
    logger.newline()

    const packages = await getPackageList(packagesDir)
    const results: ValidationResult[] = []

    for (const pkg of packages) {
      const result = await validatePackage(packagesDir, pkg)
      results.push(result)
    }

    // Print results
    let hasErrors = false
    const publicPackages: ValidationResult[] = []
    const privatePackages: ValidationResult[] = []

    for (const r of results) {
      if (r.warnings.some((w) => w.includes('private'))) {
        privatePackages.push(r)
      } else {
        publicPackages.push(r)
      }
    }

    logger.subheader('Public Packages')
    for (const r of publicPackages) {
      const status = r.valid ? '✅' : '❌'
      logger.info(`${status} @jejunetwork/${r.package}`)

      for (const err of r.errors) {
        logger.error(`   ⛔ ${err}`)
        hasErrors = true
      }
      for (const warn of r.warnings) {
        logger.warn(`   ⚠️  ${warn}`)
      }
      if (r.files.length > 0 && r.valid) {
        logger.info(`   📄 ${r.files.length} files would be published`)
      }
    }

    logger.newline()
    logger.subheader('Private Packages (not published)')
    for (const r of privatePackages) {
      logger.info(`   ${r.package}`)
    }

    logger.newline()
    if (hasErrors) {
      logger.error('Some packages have errors. Fix them before publishing.')
      process.exit(1)
    }

    logger.success(
      `All ${publicPackages.length} public packages are ready for publishing.`,
    )
    logger.info(`${privatePackages.length} private packages will be skipped.`)
  })

async function getPackageList(packagesDir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(packagesDir, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

async function validatePackage(
  packagesDir: string,
  pkgDir: string,
): Promise<ValidationResult> {
  const pkgPath = join(packagesDir, pkgDir, 'package.json')
  const result: ValidationResult = {
    package: pkgDir,
    valid: true,
    errors: [],
    warnings: [],
    files: [],
  }

  if (!existsSync(pkgPath)) {
    result.valid = false
    result.errors.push('Could not read package.json')
    return result
  }

  const content = readFileSync(pkgPath, 'utf-8')
  const parseResult = PublishPackageJsonSchema.safeParse(JSON.parse(content))

  if (!parseResult.success) {
    result.valid = false
    result.errors.push('Invalid package.json format')
    return result
  }

  const pkg = parseResult.data

  if (pkg.private) {
    result.warnings.push('Package is private (will not be published)')
    return result
  }

  // Check required string fields
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!pkg[field]) {
      result.errors.push(`Missing required field: ${field}`)
      result.valid = false
    }
  }

  // Check repository object
  if (!pkg.repository?.url) {
    result.errors.push('Missing required field: repository')
    result.valid = false
  }

  // Check publishConfig
  if (!pkg.publishConfig?.access) {
    result.errors.push('Missing required field: publishConfig.access')
    result.valid = false
  }

  // Check publishConfig.access
  if (pkg.publishConfig && pkg.publishConfig.access !== 'public') {
    result.warnings.push(
      "publishConfig.access should be 'public' for scoped packages",
    )
  }

  // Check for dist directory if main points to dist
  if (pkg.main?.includes('dist/')) {
    const distPath = join(packagesDir, pkgDir, 'dist')
    const distIndexExists = existsSync(join(distPath, 'index.js'))
    if (!distIndexExists) {
      result.errors.push('dist/index.js does not exist - run build first')
      result.valid = false
    }
  }

  // Check files field includes dist
  if (pkg.files && pkg.main?.includes('dist/') && !pkg.files.includes('dist')) {
    result.warnings.push("'files' field should include 'dist'")
  }

  // Run npm pack --dry-run
  const pkgFullPath = join(packagesDir, pkgDir)
  const { $ } = await import('bun')
  const packResult = await $`cd ${pkgFullPath} && npm pack --dry-run 2>&1`
    .text()
    .catch((e: Error) => e.message)

  if (packResult.includes('npm error') || packResult.includes('npm ERR')) {
    result.errors.push(`npm pack failed: ${packResult.slice(0, 200)}`)
    result.valid = false
  } else {
    // Extract files that would be included
    const lines = packResult.split('\n')
    for (const line of lines) {
      if (line.startsWith('npm notice') && !line.includes('=')) {
        const match = line.match(/npm notice \d+[.\d]*[kKMG]?B\s+(.+)/)
        if (match) result.files.push(match[1])
      }
    }
  }

  return result
}
