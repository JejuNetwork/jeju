/**
 * Jeju Release CLI - Build and publish release artifacts
 *
 * Usage:
 *   jeju release build <app>     # Build release artifacts for an app
 *   jeju release publish <app>   # Publish built artifacts to DWS
 *   jeju release list <app>      # List available releases
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { getDWSUrl } from '@jejunetwork/config'
import {
  type ReleaseArtifact,
  type ReleaseIndex,
  type ReleaseManifest,
  ReleaseManifestSchema,
  type ReleasePlatform,
  type ReleaseArch,
} from '@jejunetwork/types'
import { Command } from 'commander'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

// Manifest schema for parsing
const ManifestSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
})

type Manifest = z.infer<typeof ManifestSchema>

const AppReleaseSchema = z.object({
  type: z.enum(['desktop', 'extension', 'mobile', 'static']),
  platforms: z.array(z.enum(['macos', 'windows', 'linux', 'chrome', 'firefox', 'edge', 'safari', 'ios', 'android'])),
  buildCommands: z.object({
    macos: z.string().optional(),
    windows: z.string().optional(),
    linux: z.string().optional(),
    chrome: z.string().optional(),
    firefox: z.string().optional(),
    edge: z.string().optional(),
  }).optional(),
  outputDir: z.string(),
})

type AppRelease = z.infer<typeof AppReleaseSchema>

interface ReleaseConfig {
  app: string
  version: string
  manifest: Manifest
  release: AppRelease
  appDir: string
  releaseDir: string
}

function getAppDir(appName: string): string {
  const root = findMonorepoRoot()
  return join(root, 'apps', appName)
}

function getReleaseDir(appDir: string): string {
  return join(appDir, 'releases')
}

function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function loadManifest(appDir: string): Manifest {
  const manifestPath = join(appDir, 'jeju-manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`jeju-manifest.json not found at ${manifestPath}`)
  }
  const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  return ManifestSchema.parse(raw)
}

function detectArtifactPlatform(filename: string): { platform: ReleasePlatform; arch?: ReleaseArch } {
  const lower = filename.toLowerCase()

  // macOS
  if (lower.includes('.dmg') || lower.includes('.app') || lower.includes('darwin') || lower.includes('macos')) {
    const arch = lower.includes('arm64') || lower.includes('aarch64') ? 'arm64' as const : 
                 lower.includes('x64') || lower.includes('x86_64') || lower.includes('intel') ? 'x64' as const : 
                 lower.includes('universal') ? 'universal' as const : undefined
    return { platform: 'macos', arch }
  }

  // Windows
  if (lower.includes('.msi') || lower.includes('.exe') || lower.includes('win') || lower.includes('windows')) {
    const arch = lower.includes('arm64') ? 'arm64' as const : 'x64' as const
    return { platform: 'windows', arch }
  }

  // Linux
  if (lower.includes('.appimage') || lower.includes('.deb') || lower.includes('.rpm') || lower.includes('linux')) {
    const arch = lower.includes('arm64') || lower.includes('aarch64') ? 'arm64' as const : 'x64' as const
    return { platform: 'linux', arch }
  }

  // Browser extensions
  if (lower.includes('chrome')) return { platform: 'chrome' }
  if (lower.includes('firefox') || lower.includes('.xpi')) return { platform: 'firefox' }
  if (lower.includes('edge')) return { platform: 'edge' }
  if (lower.includes('safari')) return { platform: 'safari' }

  // Mobile
  if (lower.includes('.ipa') || lower.includes('ios')) return { platform: 'ios' }
  if (lower.includes('.apk') || lower.includes('android')) return { platform: 'android' }

  // Default to the most specific detection
  throw new Error(`Cannot detect platform for artifact: ${filename}`)
}

async function uploadToDWS(data: Buffer, filename: string): Promise<string> {
  const dwsUrl = getDWSUrl()
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(data)]), filename)

  let response: Response
  try {
    response = await fetch(`${dwsUrl}/storage/upload`, {
      method: 'POST',
      body: formData,
    })
  } catch (err) {
    throw new Error(`Failed to connect to DWS at ${dwsUrl}. Is DWS running? Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => 'unknown error')
    throw new Error(`Failed to upload to DWS: ${response.status} ${response.statusText} - ${body}`)
  }

  const result = await response.json() as { cid: string }
  if (!result.cid) {
    throw new Error('DWS upload response missing CID')
  }
  return result.cid
}

async function fetchReleaseIndex(appName: string): Promise<ReleaseIndex> {
  const dwsUrl = getDWSUrl()
  
  let response: Response
  try {
    response = await fetch(`${dwsUrl}/storage/releases/${appName}/index.json`)
  } catch (err) {
    throw new Error(`Failed to connect to DWS at ${dwsUrl}. Is DWS running? Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        app: appName,
        latest: '0.0.0',
        versions: [],
      }
    }
    throw new Error(`Failed to fetch release index: ${response.status} ${response.statusText}`)
  }

  return await response.json() as ReleaseIndex
}

async function publishReleaseIndex(appName: string, index: ReleaseIndex): Promise<void> {
  const dwsUrl = getDWSUrl()
  
  let response: Response
  try {
    response = await fetch(`${dwsUrl}/storage/releases/${appName}/index.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(index),
    })
  } catch (err) {
    throw new Error(`Failed to connect to DWS at ${dwsUrl}. Is DWS running? Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => 'unknown error')
    throw new Error(`Failed to publish release index: ${response.status} ${response.statusText} - ${body}`)
  }
}

async function buildDesktopApp(config: ReleaseConfig): Promise<ReleaseArtifact[]> {
  const { execa } = await import('execa')
  const artifacts: ReleaseArtifact[] = []

  logger.info(`Building desktop app for ${config.app}...`)

  // Run Tauri build
  const tauriDir = join(config.appDir, 'app/src-tauri')
  if (!existsSync(tauriDir)) {
    throw new Error(`Tauri directory not found: ${tauriDir}`)
  }

  await execa('bun', ['tauri', 'build'], {
    cwd: tauriDir,
    stdio: 'inherit',
  })

  // Find built artifacts
  const targetDir = join(tauriDir, 'target/release/bundle')
  if (!existsSync(targetDir)) {
    throw new Error(`Build output not found: ${targetDir}`)
  }

  // Scan for artifacts
  const scanDir = (dir: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        scanDir(fullPath)
      } else if (stat.isFile()) {
        const ext = entry.split('.').pop()?.toLowerCase()
        if (['dmg', 'msi', 'exe', 'appimage', 'deb', 'rpm'].includes(ext ?? '')) {
          const data = readFileSync(fullPath)
          const { platform, arch } = detectArtifactPlatform(entry)

          artifacts.push({
            platform,
            arch,
            filename: entry,
            cid: '', // Set during publish
            size: data.length,
            sha256: computeSha256(data),
          })

          // Copy to releases dir
          const destPath = join(config.releaseDir, config.version, entry)
          mkdirSync(join(config.releaseDir, config.version), { recursive: true })
          writeFileSync(destPath, data)
        }
      }
    }
  }

  scanDir(targetDir)
  return artifacts
}

async function buildExtension(config: ReleaseConfig): Promise<ReleaseArtifact[]> {
  const { execa } = await import('execa')
  const artifacts: ReleaseArtifact[] = []

  logger.info(`Building browser extension for ${config.app}...`)

  // Run extension build
  const extensionDir = join(config.appDir, 'extension')
  if (!existsSync(extensionDir)) {
    throw new Error(`Extension directory not found: ${extensionDir}`)
  }

  // Build for each supported browser
  for (const browser of ['chrome', 'firefox', 'edge'] as const) {
    const outputFile = join(config.releaseDir, config.version, `${config.app}-${browser}-${config.version}.zip`)
    mkdirSync(join(config.releaseDir, config.version), { recursive: true })

    // Create zip of extension
    await execa('zip', ['-r', outputFile, '.', '-x', 'node_modules/*', '-x', 'scripts/*'], {
      cwd: extensionDir,
      stdio: 'inherit',
    })

    if (existsSync(outputFile)) {
      const data = readFileSync(outputFile)
      artifacts.push({
        platform: browser,
        filename: basename(outputFile),
        cid: '',
        size: data.length,
        sha256: computeSha256(data),
      })
    }
  }

  return artifacts
}

async function publishArtifacts(config: ReleaseConfig, artifacts: ReleaseArtifact[]): Promise<ReleaseArtifact[]> {
  const publishedArtifacts: ReleaseArtifact[] = []

  for (const artifact of artifacts) {
    const filePath = join(config.releaseDir, config.version, artifact.filename)
    if (!existsSync(filePath)) {
      logger.warn(`Artifact not found: ${filePath}`)
      continue
    }

    const data = readFileSync(filePath)
    logger.info(`Uploading ${artifact.filename} (${(data.length / 1024 / 1024).toFixed(2)} MB)...`)

    const cid = await uploadToDWS(data, artifact.filename)
    logger.info(`  -> CID: ${cid}`)

    publishedArtifacts.push({
      ...artifact,
      cid,
    })
  }

  return publishedArtifacts
}

export const releaseCommand = new Command('release')
  .description('Build and publish app releases')

releaseCommand
  .command('build')
  .description('Build release artifacts for an app')
  .argument('<app>', 'App name (otto, vpn, wallet, node)')
  .option('--version <version>', 'Override version from package.json')
  .option('--platform <platform>', 'Build only for specific platform')
  .action(async (appName: string, options: { version?: string; platform?: string }) => {
    const appDir = getAppDir(appName)
    if (!existsSync(appDir)) {
      logger.error(`App not found: ${appName}`)
      process.exit(1)
    }

    // Load manifest
    const manifest = loadManifest(appDir)

    // Determine version
    const packageJsonPath = join(appDir, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    const version = options.version ?? packageJson.version

    // Determine release type from manifest
    const hasDesktop = existsSync(join(appDir, 'app/src-tauri'))
    const hasExtension = existsSync(join(appDir, 'extension'))

    const releaseDir = getReleaseDir(appDir)
    const releaseConfig: ReleaseConfig = {
      app: appName,
      version,
      manifest,
      release: {
        type: hasDesktop ? 'desktop' : hasExtension ? 'extension' : 'static',
        platforms: hasDesktop 
          ? ['macos', 'windows', 'linux'] 
          : hasExtension 
            ? ['chrome', 'firefox', 'edge']
            : [],
        outputDir: releaseDir,
      },
      appDir,
      releaseDir,
    }

    logger.info(`Building ${appName} v${version}...`)
    logger.info(`Type: ${releaseConfig.release.type}`)

    let artifacts: ReleaseArtifact[] = []

    if (hasDesktop && (!options.platform || ['macos', 'windows', 'linux'].includes(options.platform))) {
      artifacts = [...artifacts, ...await buildDesktopApp(releaseConfig)]
    }

    if (hasExtension && (!options.platform || ['chrome', 'firefox', 'edge'].includes(options.platform))) {
      artifacts = [...artifacts, ...await buildExtension(releaseConfig)]
    }

    // Save manifest locally
    const localManifest: ReleaseManifest = {
      app: appName,
      version,
      releasedAt: new Date().toISOString(),
      channel: 'stable',
      artifacts,
    }

    const manifestPath = join(releaseDir, version, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(localManifest, null, 2))

    logger.info('')
    logger.info('Build complete.')
    logger.info(`Artifacts: ${artifacts.length}`)
    artifacts.forEach((a) => {
      logger.info(`  - ${a.filename} (${a.platform}${a.arch ? `/${a.arch}` : ''})`)
    })
    logger.info('')
    logger.info(`Run 'jeju release publish ${appName}' to upload to DWS`)
  })

releaseCommand
  .command('publish')
  .description('Publish built artifacts to DWS')
  .argument('<app>', 'App name')
  .option('--version <version>', 'Version to publish')
  .option('--channel <channel>', 'Release channel (stable, beta, nightly)', 'stable')
  .action(async (appName: string, options: { version?: string; channel?: string }) => {
    const appDir = getAppDir(appName)
    const releaseDir = getReleaseDir(appDir)

    // Find version to publish
    let version = options.version
    if (!version) {
      // Use latest in releases dir
      const versions = readdirSync(releaseDir)
        .filter((v) => existsSync(join(releaseDir, v, 'manifest.json')))
        .sort()
        .reverse()

      if (versions.length === 0) {
        logger.error('No built releases found. Run `jeju release build` first.')
        process.exit(1)
      }
      version = versions[0]
    }

    const manifestPath = join(releaseDir, version, 'manifest.json')
    if (!existsSync(manifestPath)) {
      logger.error(`Manifest not found for version ${version}`)
      process.exit(1)
    }

    const localManifest = ReleaseManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, 'utf-8'))
    )

    logger.info(`Publishing ${appName} v${version} to DWS...`)

    // Load manifest
    const manifest = loadManifest(appDir)

    const config: ReleaseConfig = {
      app: appName,
      version,
      manifest,
      release: {
        type: 'static',
        platforms: [],
        outputDir: releaseDir,
      },
      appDir,
      releaseDir,
    }

    // Upload artifacts
    const publishedArtifacts = await publishArtifacts(config, localManifest.artifacts)

    // Create and upload final manifest
    const finalManifest: ReleaseManifest = {
      ...localManifest,
      artifacts: publishedArtifacts,
      channel: (options.channel as 'stable' | 'beta' | 'nightly') ?? 'stable',
    }

    const manifestCid = await uploadToDWS(
      Buffer.from(JSON.stringify(finalManifest, null, 2)),
      `${appName}-${version}-manifest.json`
    )

    logger.info(`Manifest CID: ${manifestCid}`)

    // Update release index
    const index = await fetchReleaseIndex(appName)
    const existingVersionIndex = index.versions.findIndex((v) => v.version === version)

    const versionEntry = {
      version,
      channel: finalManifest.channel,
      releasedAt: finalManifest.releasedAt,
      manifestCid,
    }

    if (existingVersionIndex >= 0) {
      index.versions[existingVersionIndex] = versionEntry
    } else {
      index.versions.unshift(versionEntry)
    }

    // Update latest pointers
    if (finalManifest.channel === 'stable') {
      index.latest = version
    } else if (finalManifest.channel === 'beta') {
      index.latestBeta = version
    } else if (finalManifest.channel === 'nightly') {
      index.latestNightly = version
    }

    await publishReleaseIndex(appName, index)

    logger.info('')
    logger.info('Published successfully.')
    logger.info(`Download URL: ${getDWSUrl()}/storage/releases/${appName}/${version}/manifest.json`)
  })

releaseCommand
  .command('list')
  .description('List available releases for an app')
  .argument('<app>', 'App name')
  .action(async (appName: string) => {
    const index = await fetchReleaseIndex(appName)

    if (index.versions.length === 0) {
      logger.info(`No releases found for ${appName}`)
      return
    }

    logger.info(`Releases for ${appName}:`)
    logger.info('')
    logger.info(`  Latest stable: ${index.latest}`)
    if (index.latestBeta) logger.info(`  Latest beta: ${index.latestBeta}`)
    if (index.latestNightly) logger.info(`  Latest nightly: ${index.latestNightly}`)
    logger.info('')
    logger.info('  All versions:')
    for (const v of index.versions.slice(0, 10)) {
      logger.info(`    - ${v.version} (${v.channel}) - ${new Date(v.releasedAt).toLocaleDateString()}`)
    }
    if (index.versions.length > 10) {
      logger.info(`    ... and ${index.versions.length - 10} more`)
    }
  })

releaseCommand
  .command('info')
  .description('Show release info for a specific version')
  .argument('<app>', 'App name')
  .argument('[version]', 'Version (defaults to latest)')
  .action(async (appName: string, version?: string) => {
    const dwsUrl = getDWSUrl()

    // Get version to display
    let targetVersion = version
    if (!targetVersion) {
      const index = await fetchReleaseIndex(appName)
      targetVersion = index.latest
      if (targetVersion === '0.0.0' || !targetVersion) {
        logger.info(`No releases found for ${appName}`)
        return
      }
    }

    // Fetch manifest
    const response = await fetch(`${dwsUrl}/storage/releases/${appName}/${targetVersion}/manifest.json`)
    if (!response.ok) {
      logger.error(`Release ${appName}@${targetVersion} not found`)
      return
    }

    const manifest = ReleaseManifestSchema.parse(await response.json())

    logger.info(`${appName} v${manifest.version}`)
    logger.info(`Channel: ${manifest.channel}`)
    logger.info(`Released: ${new Date(manifest.releasedAt).toLocaleString()}`)
    logger.info('')
    logger.info('Artifacts:')
    for (const artifact of manifest.artifacts) {
      const size = (artifact.size / 1024 / 1024).toFixed(2)
      logger.info(`  - ${artifact.filename}`)
      logger.info(`    Platform: ${artifact.platform}${artifact.arch ? ` (${artifact.arch})` : ''}`)
      logger.info(`    Size: ${size} MB`)
      logger.info(`    SHA256: ${artifact.sha256.slice(0, 16)}...`)
      logger.info(`    CID: ${artifact.cid}`)
    }
  })
