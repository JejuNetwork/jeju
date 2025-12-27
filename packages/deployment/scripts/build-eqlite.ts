#!/usr/bin/env bun
/**
 * Build EQLite from local source
 *
 * Compiles EQLite binaries for the current platform or cross-compiles for deployment.
 * Supports building for:
 * - Local development (native platform)
 * - Docker multi-arch (linux/amd64, linux/arm64)
 * - TEE enclaves
 */

import { spawn, spawnSync } from 'bun'
import { existsSync, mkdirSync, cpSync, chmodSync } from 'node:fs'
import path from 'node:path'

// ============================================================================
// Config
// ============================================================================

const EQLITE_SOURCE_DIR = path.resolve(import.meta.dir, '../../../eqlite')
const OUTPUT_DIR = path.resolve(import.meta.dir, '../../../eqlite/bin')

const BINARIES = [
  { name: 'eqlite', path: './cmd/eqlite' },
  { name: 'eqlited', path: './cmd/eqlited' },
  { name: 'eqlite-minerd', path: './cmd/eqlite-minerd' },
  { name: 'eqlite-proxy', path: './cmd/eqlite-proxy' },
] as const

interface BuildOptions {
  platform?: 'linux' | 'darwin' | 'windows'
  arch?: 'amd64' | 'arm64'
  cgo?: boolean
  static?: boolean
  tee?: boolean
  debug?: boolean
}

// ============================================================================
// Build Functions
// ============================================================================

async function checkGoInstalled(): Promise<void> {
  const result = spawnSync(['go', 'version'])
  if (result.exitCode !== 0) {
    throw new Error('Go is not installed or not in PATH')
  }
  console.log(`[EQLite Build] ${new TextDecoder().decode(result.stdout).trim()}`)
}

async function ensureModulesDownloaded(): Promise<void> {
  console.log('[EQLite Build] Downloading Go modules...')

  const proc = spawn({
    cmd: ['go', 'mod', 'download'],
    cwd: EQLITE_SOURCE_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      GOPROXY: 'https://proxy.golang.org,https://goproxy.io,direct',
    },
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Failed to download Go modules (exit code: ${exitCode})`)
  }
}

async function buildBinary(
  binary: (typeof BINARIES)[number],
  options: BuildOptions,
): Promise<void> {
  const outputName =
    options.platform === 'windows' ? `${binary.name}.exe` : binary.name

  const outputPath = path.join(OUTPUT_DIR, outputName)

  console.log(`[EQLite Build] Building ${binary.name}...`)

  const ldflags = ['-s', '-w']

  if (options.static) {
    ldflags.push('-extldflags', '-static')
  }

  const buildArgs = [
    'build',
    `-ldflags=${ldflags.join(' ')}`,
    '-o',
    outputPath,
    binary.path,
  ]

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CGO_ENABLED: options.cgo ? '1' : '0',
  }

  if (options.platform) {
    env.GOOS = options.platform
  }

  if (options.arch) {
    env.GOARCH = options.arch
  }

  // TEE-specific settings
  if (options.tee) {
    // Build with specific flags for TEE compatibility
    env.CGO_ENABLED = '1' // Required for sqlite3
  }

  const proc = spawn({
    cmd: ['go', ...buildArgs],
    cwd: EQLITE_SOURCE_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Failed to build ${binary.name} (exit code: ${exitCode})`)
  }

  // Make executable
  chmodSync(outputPath, 0o755)

  console.log(`[EQLite Build] Built ${binary.name} -> ${outputPath}`)
}

async function buildAll(options: BuildOptions): Promise<void> {
  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  // Check Go installation
  await checkGoInstalled()

  // Download modules
  await ensureModulesDownloaded()

  // Build each binary
  for (const binary of BINARIES) {
    await buildBinary(binary, options)
  }

  console.log('[EQLite Build] All binaries built successfully')
}

// ============================================================================
// CLI
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  const options: BuildOptions = {
    cgo: true, // Required for sqlite3 and secp256k1
    static: false,
    debug: false,
  }

  for (const arg of args) {
    switch (arg) {
      case '--linux':
        options.platform = 'linux'
        break
      case '--darwin':
        options.platform = 'darwin'
        break
      case '--amd64':
        options.arch = 'amd64'
        break
      case '--arm64':
        options.arch = 'arm64'
        break
      case '--static':
        options.static = true
        break
      case '--tee':
        options.tee = true
        break
      case '--debug':
        options.debug = true
        break
      case '--help':
        console.log(`
Usage: bun run build-eqlite.ts [options]

Options:
  --linux     Build for Linux
  --darwin    Build for macOS
  --amd64     Build for x86_64
  --arm64     Build for ARM64
  --static    Build static binary
  --tee       Build for TEE environment
  --debug     Include debug info
  --help      Show this help

Examples:
  bun run build-eqlite.ts                    # Build for current platform
  bun run build-eqlite.ts --linux --amd64    # Cross-compile for Linux x64
  bun run build-eqlite.ts --tee --linux      # Build for TEE on Linux
`)
        process.exit(0)
    }
  }

  console.log('[EQLite Build] Starting build...')
  console.log(`[EQLite Build] Source: ${EQLITE_SOURCE_DIR}`)
  console.log(`[EQLite Build] Output: ${OUTPUT_DIR}`)
  console.log(`[EQLite Build] Options: ${JSON.stringify(options)}`)

  await buildAll(options)
}

main().catch((err) => {
  console.error('[EQLite Build] Error:', err)
  process.exit(1)
})

export { buildAll, buildBinary, type BuildOptions }

