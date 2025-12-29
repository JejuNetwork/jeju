/**
 * JejuPyPkg - Decentralized Python Package Registry
 * pip/twine compatible CLI for publishing and installing Python packages
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { getDWSUrl } from '@jejunetwork/config'
import { Command } from 'commander'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { validate } from '../schemas'

const PyPkgConfigSchema = z.object({
  registry: z.string().url(),
  address: z.string().optional(),
  token: z.string().optional(),
})

type PyPkgConfig = z.infer<typeof PyPkgConfigSchema>

function getRegistryUrl(): string {
  if (process.env.JEJUPYPKG_URL) return process.env.JEJUPYPKG_URL
  return `${getDWSUrl()}/pypkg`
}

function loadPyPkgConfig(): PyPkgConfig {
  const configPath = join(process.env.HOME ?? '~', '.jeju', 'pypkg-config.json')

  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    return validate(raw, PyPkgConfigSchema, 'pypkg config')
  }

  return {
    registry: getRegistryUrl(),
  }
}

function savePyPkgConfig(config: PyPkgConfig): void {
  const configDir = join(process.env.HOME ?? '~', '.jeju')
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  const configPath = join(configDir, 'pypkg-config.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}

function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export const pypkgCommand = new Command('pypkg').description(
  'JejuPyPkg - Decentralized Python package registry (pip compatible)',
)

// Login/configure
pypkgCommand
  .command('login')
  .description('Configure JejuPyPkg credentials')
  .option('--registry <url>', 'Registry URL')
  .option('--address <address>', 'Ethereum address for publishing')
  .action(async (options) => {
    logger.header('JEJUPYPKG LOGIN')

    const config = loadPyPkgConfig()

    if (options.registry) {
      config.registry = options.registry
    }

    if (options.address) {
      config.address = options.address
    }

    savePyPkgConfig(config)
    logger.success(`Configured registry: ${config.registry}`)
    logger.keyValue('Address', config.address ?? 'not set')
  })

// Health check
pypkgCommand
  .command('health')
  .description('Check registry health')
  .action(async () => {
    const config = loadPyPkgConfig()

    logger.header('JEJUPYPKG HEALTH')
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

// Publish (twine-like)
pypkgCommand
  .command('publish')
  .description('Publish Python package to JejuPyPkg (like twine upload)')
  .argument('<file>', 'Path to wheel file (.whl)')
  .option('--dry-run', 'Simulate without publishing')
  .action(async (filePath, options) => {
    logger.header('JEJUPYPKG PUBLISH')

    const config = loadPyPkgConfig()
    if (!config.address) {
      logger.error('Not logged in. Run: jeju pypkg login --address <addr>')
      process.exit(1)
    }

    if (!existsSync(filePath)) {
      logger.error(`File not found: ${filePath}`)
      process.exit(1)
    }

    const filename = basename(filePath)
    if (!filename.endsWith('.whl')) {
      logger.error('Only wheel files (.whl) are supported')
      process.exit(1)
    }

    // Parse package name and version from wheel filename
    // Format: {distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl
    const parts = filename.replace('.whl', '').split('-')
    if (parts.length < 5) {
      logger.error('Invalid wheel filename format')
      process.exit(1)
    }

    const packageName = parts[0]
    const version = parts[1]

    logger.keyValue('Package', packageName)
    logger.keyValue('Version', version)
    logger.keyValue('File', filename)
    logger.keyValue('Registry', config.registry)
    logger.newline()

    if (options.dryRun) {
      logger.warn('DRY RUN - not publishing')
      return
    }

    const wheelData = readFileSync(filePath)
    const sha256 = computeSha256(wheelData)

    logger.keyValue('Size', `${wheelData.length} bytes`)
    logger.keyValue('SHA256', sha256)
    logger.newline()

    logger.step('Publishing to registry...')

    const formData = new FormData()
    formData.append('name', packageName)
    formData.append('version', version)
    formData.append('content', new Blob([wheelData]), filename)
    formData.append(':action', 'file_upload')
    formData.append('protocol_version', '1')

    const res = await fetch(`${config.registry}/upload`, {
      method: 'POST',
      headers: {
        'x-jeju-address': config.address,
      },
      body: formData,
    })

    if (!res.ok) {
      const body = await res.text()
      logger.error(`Failed to publish: ${res.status} ${body}`)
      process.exit(1)
    }

    const result = (await res.json()) as {
      ok: boolean
      package: string
      version: string
      sha256: string
    }
    logger.success(`Published ${result.package}@${result.version}`)
    logger.keyValue('SHA256', result.sha256)
  })

// Search
pypkgCommand
  .command('search')
  .description('Search for packages')
  .argument('<query>', 'Search query')
  .action(async (query) => {
    const config = loadPyPkgConfig()

    const res = await fetch(
      `${config.registry}/search?q=${encodeURIComponent(query)}`,
    )

    if (!res.ok) {
      logger.error('Search failed')
      return
    }

    interface SearchResult {
      name: string
      version: string
      summary: string
    }

    const body = (await res.json()) as {
      results: SearchResult[]
      total: number
    }

    logger.header('SEARCH RESULTS')
    logger.keyValue('Query', query)
    logger.keyValue('Total', String(body.total))
    logger.newline()

    for (const result of body.results) {
      logger.info(`${result.name}==${result.version}`)
      if (result.summary) {
        logger.info(`  ${result.summary}`)
      }
    }
  })

// View package info
pypkgCommand
  .command('show')
  .alias('info')
  .description('View package information')
  .argument('<package>', 'Package name')
  .action(async (packageName) => {
    const config = loadPyPkgConfig()

    const res = await fetch(`${config.registry}/pypi/${packageName}/json`)

    if (!res.ok) {
      logger.error(`Package not found: ${packageName}`)
      return
    }

    interface PackageInfo {
      info: {
        name: string
        version: string
        summary: string
        author: string
        license: string
        home_page: string
        requires_python: string
      }
      releases: Record<string, Array<{ filename: string; size: number }>>
    }

    const pkg = (await res.json()) as PackageInfo

    logger.header(pkg.info.name)
    logger.keyValue('Version', pkg.info.version)
    if (pkg.info.summary) {
      logger.info(pkg.info.summary)
    }
    logger.newline()

    logger.keyValue('Author', pkg.info.author || 'unknown')
    logger.keyValue('License', pkg.info.license || 'unknown')
    logger.keyValue('Python', pkg.info.requires_python || 'any')
    if (pkg.info.home_page) {
      logger.keyValue('Homepage', pkg.info.home_page)
    }
    logger.newline()

    logger.subheader('Versions')
    const versions = Object.keys(pkg.releases).sort().reverse()
    for (const v of versions.slice(0, 10)) {
      const files = pkg.releases[v]
      const size = files.reduce((sum, f) => sum + f.size, 0)
      logger.info(`  ${v} (${Math.round(size / 1024)}KB)`)
    }
    if (versions.length > 10) {
      logger.info(`  ... and ${versions.length - 10} more`)
    }
  })

// Install (wrapper around pip)
pypkgCommand
  .command('install')
  .description('Install package from JejuPyPkg')
  .argument('<package>', 'Package name[==version]')
  .option('--upgrade', 'Upgrade if already installed')
  .action(async (packageSpec, options) => {
    const config = loadPyPkgConfig()

    logger.header('JEJUPYPKG INSTALL')
    logger.keyValue('Package', packageSpec)
    logger.keyValue('Registry', config.registry)
    logger.newline()

    logger.step('Installing via pip...')

    const { execa } = await import('execa')

    const pipArgs = [
      'install',
      '--extra-index-url',
      `${config.registry}/simple/`,
      packageSpec,
    ]

    if (options.upgrade) {
      pipArgs.push('--upgrade')
    }

    await execa('pip', pipArgs, {
      stdio: 'inherit',
    })

    logger.success(`Installed ${packageSpec}`)
  })

// List packages
pypkgCommand
  .command('list')
  .description('List all packages in registry')
  .action(async () => {
    const config = loadPyPkgConfig()

    const res = await fetch(`${config.registry}/packages`)

    if (!res.ok) {
      logger.error('Failed to list packages')
      return
    }

    interface PackageListItem {
      name: string
      latestVersion: string
      versions: string[]
    }

    const body = (await res.json()) as {
      packages: PackageListItem[]
      total: number
    }

    logger.header('PACKAGES')
    logger.keyValue('Total', String(body.total))
    logger.newline()

    for (const pkg of body.packages) {
      logger.info(
        `${pkg.name}==${pkg.latestVersion} (${pkg.versions.length} versions)`,
      )
    }
  })

// Config
pypkgCommand
  .command('config')
  .description('View or set configuration')
  .argument('[key]', 'Config key')
  .argument('[value]', 'Config value')
  .action(async (key, value) => {
    const config = loadPyPkgConfig()

    if (!key) {
      logger.header('JEJUPYPKG CONFIG')
      logger.keyValue('Registry', config.registry)
      logger.keyValue('Address', config.address ?? 'not set')
      return
    }

    if (value) {
      if (key === 'registry') {
        config.registry = value
      } else if (key === 'address') {
        config.address = value
      }
      savePyPkgConfig(config)
      logger.success(`Set ${key} = ${value}`)
    } else {
      const configRecord = config as Record<string, string | undefined>
      logger.info(configRecord[key] ?? 'not set')
    }
  })
