#!/usr/bin/env bun

/**
 * Workerd Installation Script
 * Auto-installs workerd binary for Windows, Linux, and macOS
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const WORKERD_VERSION = '1.20240909.0'

interface PlatformConfig {
  asset: string
  binary: string
  extractCmd: (archivePath: string, destDir: string) => string[]
}

const PLATFORMS: Record<string, PlatformConfig> = {
  'linux-x64': {
    asset: `workerd-linux-64.gz`,
    binary: 'workerd',
    extractCmd: (archive, _dest) => ['gunzip', '-c', archive],
  },
  'linux-arm64': {
    asset: `workerd-linux-arm64.gz`,
    binary: 'workerd',
    extractCmd: (archive, _dest) => ['gunzip', '-c', archive],
  },
  'darwin-x64': {
    asset: `workerd-darwin-64.gz`,
    binary: 'workerd',
    extractCmd: (archive, _dest) => ['gunzip', '-c', archive],
  },
  'darwin-arm64': {
    asset: `workerd-darwin-arm64.gz`,
    binary: 'workerd',
    extractCmd: (archive, _dest) => ['gunzip', '-c', archive],
  },
  'win32-x64': {
    asset: `workerd-windows-64.exe.gz`,
    binary: 'workerd.exe',
    extractCmd: (archive, _dest) => ['gunzip', '-c', archive],
  },
}

function getPlatformKey(): string {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'

  throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`[workerd] Downloading from ${url}`)

  const response = await fetch(url, {
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(
      `Failed to download: ${response.status} ${response.statusText}`,
    )
  }

  const buffer = await response.arrayBuffer()
  await Bun.write(destPath, buffer)
  console.log(`[workerd] Downloaded to ${destPath}`)
}

async function extractGzip(gzPath: string, destPath: string): Promise<void> {
  console.log(`[workerd] Extracting ${gzPath}`)

  const gzFile = Bun.file(gzPath)
  const gzBuffer = await gzFile.arrayBuffer()

  // Use Bun's built-in gzip decompression
  const decompressed = Bun.gunzipSync(new Uint8Array(gzBuffer))
  await Bun.write(destPath, decompressed)

  console.log(`[workerd] Extracted to ${destPath}`)
}

async function makeExecutable(path: string): Promise<void> {
  if (process.platform === 'win32') return

  const proc = Bun.spawn(['chmod', '+x', path])
  await proc.exited
  console.log(`[workerd] Made executable: ${path}`)
}

async function getInstallDir(): Promise<string> {
  // Install to node_modules/.bin for consistency with npm
  const binDir = join(process.cwd(), 'node_modules', '.bin')
  await mkdir(binDir, { recursive: true })
  return binDir
}

async function isWorkerdInstalled(binPath: string): Promise<boolean> {
  if (!existsSync(binPath)) return false

  // Verify it works
  const proc = Bun.spawn([binPath, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  return exitCode === 0
}

async function installWorkerd(): Promise<string> {
  console.log(`[workerd] Installing workerd v${WORKERD_VERSION}`)

  const platformKey = getPlatformKey()
  const config = PLATFORMS[platformKey]

  if (!config) {
    throw new Error(`No workerd binary available for ${platformKey}`)
  }

  console.log(`[workerd] Platform: ${platformKey}`)

  const installDir = await getInstallDir()
  const binaryPath = join(installDir, config.binary)

  // Check if already installed
  if (await isWorkerdInstalled(binaryPath)) {
    console.log(`[workerd] Already installed at ${binaryPath}`)
    return binaryPath
  }

  // Download
  const downloadUrl = `https://github.com/cloudflare/workerd/releases/download/v${WORKERD_VERSION}/${config.asset}`
  const archivePath = join(installDir, config.asset)

  await downloadFile(downloadUrl, archivePath)

  // Extract
  await extractGzip(archivePath, binaryPath)

  // Make executable
  await makeExecutable(binaryPath)

  // Cleanup archive
  await Bun.write(archivePath, '') // Truncate
  // Note: Bun doesn't have a direct unlink, but we can just leave the empty file

  // Verify installation
  if (!(await isWorkerdInstalled(binaryPath))) {
    throw new Error('workerd installation verification failed')
  }

  console.log(`[workerd] Successfully installed to ${binaryPath}`)
  return binaryPath
}

// Also install to a known system location for global access
async function installToSystemPath(): Promise<string | null> {
  if (process.platform === 'win32') {
    // On Windows, we just use node_modules/.bin
    return null
  }

  const systemPaths = [
    '/usr/local/bin',
    join(process.env.HOME || '', '.local', 'bin'),
  ]

  for (const dir of systemPaths) {
    try {
      await mkdir(dir, { recursive: true })

      // Check if we can write to this directory
      const testFile = join(dir, '.workerd-test')
      await Bun.write(testFile, 'test')
      await Bun.spawn(['rm', testFile]).exited

      const platformKey = getPlatformKey()
      const config = PLATFORMS[platformKey]
      const binaryPath = join(dir, config.binary)

      if (await isWorkerdInstalled(binaryPath)) {
        console.log(`[workerd] Already installed at ${binaryPath}`)
        return binaryPath
      }

      // Download and install
      const downloadUrl = `https://github.com/cloudflare/workerd/releases/download/v${WORKERD_VERSION}/${config.asset}`
      const archivePath = join(dir, config.asset)

      await downloadFile(downloadUrl, archivePath)
      await extractGzip(archivePath, binaryPath)
      await makeExecutable(binaryPath)

      // Cleanup
      await Bun.spawn(['rm', '-f', archivePath]).exited

      if (await isWorkerdInstalled(binaryPath)) {
        console.log(`[workerd] Installed to system path: ${binaryPath}`)
        return binaryPath
      }
    } catch {}
  }

  return null
}

async function main(): Promise<void> {
  console.log('[workerd] Starting installation...')
  console.log(`[workerd] Platform: ${process.platform}, Arch: ${process.arch}`)

  try {
    // Install to node_modules/.bin
    const localPath = await installWorkerd()

    // Try to install to system path (optional, best effort)
    const systemPath = await installToSystemPath().catch(() => null)

    console.log('[workerd] Installation complete.')
    console.log(`[workerd] Local binary: ${localPath}`)
    if (systemPath) {
      console.log(`[workerd] System binary: ${systemPath}`)
    }

    // Write path to a file for other scripts to read
    const pathFile = join(process.cwd(), 'node_modules', '.workerd-path')
    await Bun.write(pathFile, systemPath || localPath)
  } catch (error) {
    console.error('[workerd] Installation failed:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.main) {
  main()
}

export { installWorkerd, isWorkerdInstalled, getPlatformKey, WORKERD_VERSION }
