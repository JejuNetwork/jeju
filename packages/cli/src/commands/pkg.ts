/**
 * JejuPkg - Decentralized Package Registry
 * npm/bun compatible CLI for publishing and installing packages
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl } from '@jejunetwork/config'
import { Command } from 'commander'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { validate } from '../schemas'

const PkgConfigSchema = z.object({
  registry: z.string().url(),
  address: z.string().optional(),
  token: z.string().optional(),
})

type PkgConfig = z.infer<typeof PkgConfigSchema>

const PackageJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  main: z.string().optional(),
  types: z.string().optional(),
  module: z.string().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  author: z
    .union([z.string(), z.object({ name: z.string().optional() })])
    .optional(),
  license: z.string().optional(),
  repository: z
    .union([z.string(), z.object({ url: z.string().optional() })])
    .optional(),
  homepage: z.string().optional(),
  bugs: z
    .union([z.string(), z.object({ url: z.string().optional() })])
    .optional(),
})

type PackageJson = z.infer<typeof PackageJsonSchema>
void (null as PackageJson | null) // Type guard ensures schema usage

function getRegistryUrl(): string {
  // Check env first for explicit override
  if (process.env.JEJUPKG_URL) return process.env.JEJUPKG_URL
  if (process.env.npm_config_registry) return process.env.npm_config_registry

  // Default to local DWS pkg endpoint
  return `${getDWSUrl()}/pkg`
}

function loadPkgConfig(): PkgConfig {
  const configPath = join(
    process.env.HOME ?? '~',
    '.jeju',
    'pkg-config.json',
  )

  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    return validate(raw, PkgConfigSchema, 'pkg config')
  }

  return {
    registry: getRegistryUrl(),
  }
}

function savePkgConfig(config: PkgConfig): void {
  const configDir = join(process.env.HOME ?? '~', '.jeju')
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  const configPath = join(configDir, 'pkg-config.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}

async function packPackage(packageDir: string): Promise<Buffer> {
  const { execa } = await import('execa')
  const result = await execa('npm', ['pack', '--pack-destination', '/tmp'], {
    cwd: packageDir,
    stdio: 'pipe',
  })

  // Extract tarball name from output
  const tarballName = result.stdout.trim().split('\n').pop()
  if (!tarballName) {
    throw new Error('Failed to pack package')
  }

  const tarballPath = join('/tmp', tarballName)
  return readFileSync(tarballPath)
}

function computeShasum(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex')
}

function computeIntegrity(data: Buffer): string {
  const hash = createHash('sha512').update(data).digest('base64')
  return `sha512-${hash}`
}

export const pkgCommand = new Command('pkg')
  .description('JejuPkg - Decentralized package registry (npm compatible)')

// Login/configure
pkgCommand
  .command('login')
  .description('Configure JejuPkg credentials')
  .option('--registry <url>', 'Registry URL')
  .option('--address <address>', 'Ethereum address for publishing')
  .action(async (options) => {
    logger.header('JEJUPKG LOGIN')

    const config = loadPkgConfig()

    if (options.registry) {
      config.registry = options.registry
    }

    if (options.address) {
      config.address = options.address
    }

    // If no address provided, try to get from keystore
    if (!config.address) {
      const keystorePath = join(findMonorepoRoot(), '.keystore')
      if (existsSync(keystorePath)) {
        const keystore = JSON.parse(readFileSync(keystorePath, 'utf-8'))
        config.address = keystore.deployer?.address
        logger.info(`Using address from keystore: ${config.address}`)
      }
    }

    if (!config.address) {
      logger.warn('No address configured. Set with --address or via .keystore')
    }

    // Generate token
    config.token = randomBytes(32).toString('hex')

    savePkgConfig(config)
    logger.success(`Logged in to ${config.registry}`)
    logger.keyValue('Address', config.address ?? 'not set')
  })

// Whoami
pkgCommand
  .command('whoami')
  .description('Display current user')
  .action(async () => {
    const config = loadPkgConfig()

    const res = await fetch(`${config.registry}/-/whoami`, {
      headers: {
        'x-jeju-address': config.address ?? '',
        Authorization: config.token ? `Bearer ${config.token}` : '',
      },
    })

    if (!res.ok) {
      logger.error('Not logged in')
      return
    }

    const body = (await res.json()) as { username: string }
    logger.info(`Logged in as: ${body.username}`)
  })

// Publish
pkgCommand
  .command('publish')
  .description('Publish package to JejuPkg registry')
  .argument('[path]', 'Path to package directory', '.')
  .option('--dry-run', 'Simulate without publishing')
  .option('--tag <tag>', 'Publish with tag', 'latest')
  .option('--access <access>', 'Access level', 'public')
  .action(async (packagePath, options) => {
    logger.header('JEJUPKG PUBLISH')

    const config = loadPkgConfig()
    if (!config.address) {
      logger.error('Not logged in. Run: jeju pkg login --address <addr>')
      process.exit(1)
    }

    const absPath = join(process.cwd(), packagePath)
    const pkgJsonPath = join(absPath, 'package.json')

    if (!existsSync(pkgJsonPath)) {
      logger.error('package.json not found')
      process.exit(1)
    }

    const pkgJson = validate(
      JSON.parse(readFileSync(pkgJsonPath, 'utf-8')),
      PackageJsonSchema,
      'package.json',
    )

    logger.keyValue('Package', pkgJson.name)
    logger.keyValue('Version', pkgJson.version)
    logger.keyValue('Registry', config.registry)
    logger.newline()

    if (options.dryRun) {
      logger.warn('DRY RUN - not publishing')
      return
    }

    logger.step('Packing package...')
    const tarball = await packPackage(absPath)
    const shasum = computeShasum(tarball)
    const integrity = computeIntegrity(tarball)

    logger.keyValue('Size', `${tarball.length} bytes`)
    logger.keyValue('Shasum', shasum)
    logger.newline()

    logger.step('Publishing to registry...')

    // Build npm-compatible publish payload
    const tarballName = `${pkgJson.name.replace('@', '').replace('/', '-')}-${pkgJson.version}.tgz`
    const tarballUrl = `${config.registry}/${pkgJson.name}/-/${tarballName}`

    const publishPayload = {
      name: pkgJson.name,
      description: pkgJson.description ?? '',
      'dist-tags': {
        [options.tag]: pkgJson.version,
      },
      versions: {
        [pkgJson.version]: {
          name: pkgJson.name,
          version: pkgJson.version,
          description: pkgJson.description,
          main: pkgJson.main,
          types: pkgJson.types,
          module: pkgJson.module,
          dependencies: pkgJson.dependencies,
          devDependencies: pkgJson.devDependencies,
          peerDependencies: pkgJson.peerDependencies,
          keywords: pkgJson.keywords,
          author: pkgJson.author,
          license: pkgJson.license,
          repository: pkgJson.repository,
          homepage: pkgJson.homepage,
          bugs: pkgJson.bugs,
          dist: {
            tarball: tarballUrl,
            shasum,
            integrity,
          },
        },
      },
      _attachments: {
        [tarballName]: {
          content_type: 'application/octet-stream',
          data: tarball.toString('base64'),
          length: tarball.length,
        },
      },
    }

    const packageNameEncoded = pkgJson.name.replace('/', '%2f')
    const res = await fetch(`${config.registry}/${packageNameEncoded}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': config.address,
        Authorization: config.token ? `Bearer ${config.token}` : '',
      },
      body: JSON.stringify(publishPayload),
    })

    if (!res.ok) {
      const body = await res.text()
      logger.error(`Failed to publish: ${res.status} ${body}`)
      process.exit(1)
    }

    const result = (await res.json()) as { ok: boolean; id: string; rev: string }
    logger.success(`Published ${pkgJson.name}@${pkgJson.version}`)
    logger.keyValue('Package ID', result.id)
    logger.keyValue('Revision', result.rev)
  })

// Search
pkgCommand
  .command('search')
  .description('Search for packages')
  .argument('<query>', 'Search query')
  .option('--limit <n>', 'Max results', '20')
  .action(async (query, options) => {
    const config = loadPkgConfig()

    const res = await fetch(
      `${config.registry}/-/v1/search?text=${encodeURIComponent(query)}&size=${options.limit}`,
    )

    if (!res.ok) {
      logger.error('Search failed')
      return
    }

    interface SearchObject {
      package: {
        name: string
        version: string
        description?: string
      }
    }

    const body = (await res.json()) as { objects: SearchObject[]; total: number }

    logger.header('SEARCH RESULTS')
    logger.keyValue('Query', query)
    logger.keyValue('Total', String(body.total))
    logger.newline()

    for (const result of body.objects) {
      const pkg = result.package
      logger.info(`${pkg.name}@${pkg.version}`)
      if (pkg.description) {
        logger.info(`  ${pkg.description}`)
      }
    }
  })

// View package info
pkgCommand
  .command('view')
  .alias('info')
  .description('View package information')
  .argument('<package>', 'Package name')
  .action(async (packageName) => {
    const config = loadPkgConfig()

    const packageNameEncoded = packageName.replace('/', '%2f')
    const res = await fetch(`${config.registry}/${packageNameEncoded}`)

    if (!res.ok) {
      logger.error(`Package not found: ${packageName}`)
      return
    }

    interface VersionInfo {
      name: string
      version: string
      description?: string
      dependencies?: Record<string, string>
      dist?: {
        tarball?: string
        shasum?: string
      }
    }

    const pkg = (await res.json()) as {
      name: string
      description?: string
      'dist-tags'?: Record<string, string>
      versions?: Record<string, VersionInfo>
    }

    logger.header(pkg.name)
    if (pkg.description) {
      logger.info(pkg.description)
    }
    logger.newline()

    if (pkg['dist-tags']) {
      logger.subheader('Tags')
      for (const [tag, version] of Object.entries(pkg['dist-tags'])) {
        logger.keyValue(tag, version)
      }
      logger.newline()
    }

    if (pkg.versions) {
      logger.subheader('Versions')
      const versions = Object.keys(pkg.versions).sort().reverse()
      for (const v of versions.slice(0, 10)) {
        logger.info(`  ${v}`)
      }
      if (versions.length > 10) {
        logger.info(`  ... and ${versions.length - 10} more`)
      }
    }
  })

// Install
pkgCommand
  .command('install')
  .alias('add')
  .description('Install package from JejuPkg')
  .argument('<package>', 'Package name[@version]')
  .option('--save-dev', 'Save as dev dependency')
  .action(async (packageSpec, options) => {
    const config = loadPkgConfig()

    // Parse package@version
    let packageName = packageSpec
    let version = 'latest'
    if (packageSpec.includes('@') && !packageSpec.startsWith('@')) {
      const parts = packageSpec.split('@')
      packageName = parts[0]
      version = parts[1] ?? 'latest'
    } else if (
      packageSpec.startsWith('@') &&
      packageSpec.indexOf('@', 1) !== -1
    ) {
      // Scoped package @scope/name@version
      const idx = packageSpec.indexOf('@', 1)
      packageName = packageSpec.slice(0, idx)
      version = packageSpec.slice(idx + 1)
    }

    logger.header('JEJUPKG INSTALL')
    logger.keyValue('Package', packageName)
    logger.keyValue('Version', version)
    logger.newline()

    // Fetch package metadata
    const packageNameEncoded = packageName.replace('/', '%2f')
    const res = await fetch(`${config.registry}/${packageNameEncoded}`)

    if (!res.ok) {
      logger.error(`Package not found: ${packageName}`)
      process.exit(1)
    }

    interface DistInfo {
      tarball: string
      shasum: string
      integrity?: string
    }

    interface VersionInfo {
      version: string
      dist: DistInfo
    }

    const pkg = (await res.json()) as {
      name: string
      'dist-tags': Record<string, string>
      versions: Record<string, VersionInfo>
    }

    // Resolve version
    const resolvedVersion =
      version === 'latest' ? pkg['dist-tags']?.latest : version

    if (!resolvedVersion) {
      logger.error(`Version not found: ${version}`)
      process.exit(1)
    }

    const versionData = pkg.versions[resolvedVersion]
    if (!versionData) {
      logger.error(`Version data not found: ${resolvedVersion}`)
      process.exit(1)
    }

    logger.keyValue('Resolved', resolvedVersion)
    logger.step('Downloading tarball...')

    // Download tarball
    const tarballRes = await fetch(versionData.dist.tarball)
    if (!tarballRes.ok) {
      logger.error('Failed to download tarball')
      process.exit(1)
    }

    const tarball = Buffer.from(await tarballRes.arrayBuffer())

    // Verify integrity
    const shasum = computeShasum(tarball)
    if (shasum !== versionData.dist.shasum) {
      logger.error('Integrity check failed')
      process.exit(1)
    }

    logger.success('Integrity verified')

    // Run bun add with tarball
    const tmpPath = `/tmp/${packageName.replace('/', '-')}-${resolvedVersion}.tgz`
    writeFileSync(tmpPath, tarball)

    logger.step('Installing...')
    const { execa } = await import('execa')

    const bunArgs = ['add', tmpPath]
    if (options.saveDev) bunArgs.push('--dev')

    await execa('bun', bunArgs, {
      stdio: 'inherit',
    })

    logger.success(`Installed ${packageName}@${resolvedVersion}`)
  })

// Health check
pkgCommand
  .command('health')
  .description('Check registry health')
  .action(async () => {
    const config = loadPkgConfig()

    logger.header('JEJUPKG HEALTH')
    logger.keyValue('Registry', config.registry)
    logger.newline()

    const res = await fetch(`${config.registry}/health`)

    if (!res.ok) {
      logger.error('Registry unhealthy')
      process.exit(1)
    }

    const body = (await res.json()) as { service: string; status: string }
    logger.success(`${body.service}: ${body.status}`)
  })

// Config
pkgCommand
  .command('config')
  .description('View or set configuration')
  .argument('[key]', 'Config key')
  .argument('[value]', 'Config value')
  .action(async (key, value) => {
    const config = loadPkgConfig()

    if (!key) {
      logger.header('JEJUPKG CONFIG')
      logger.keyValue('Registry', config.registry)
      logger.keyValue('Address', config.address ?? 'not set')
      logger.keyValue('Token', config.token ? '***' : 'not set')
      return
    }

    if (value) {
      if (key === 'registry') {
        config.registry = value
      } else if (key === 'address') {
        config.address = value
      }
      savePkgConfig(config)
      logger.success(`Set ${key} = ${value}`)
    } else {
      const configRecord = config as Record<string, string | undefined>
      logger.info(configRecord[key] ?? 'not set')
    }
  })

