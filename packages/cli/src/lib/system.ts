/** System utilities for dependency checking */

import { existsSync } from 'node:fs'
import { arch, homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { randomHex } from '@jejunetwork/shared'
import { execa } from 'execa'
import which from 'which'
import { z } from 'zod'
import type { HealthCheckResult } from '../types'

// GitHub release API schema
const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
})

/** Allowlist of commands that can have their version checked */
const ALLOWED_VERSION_COMMANDS = new Set([
  'docker',
  'kurtosis',
  'forge',
  'bun',
  'socat',
  'node',
  'npm',
  'git',
  'anvil',
  'cast',
  'helm',
  'kubectl',
  'helmfile',
  'terraform',
  'cargo',
  'ruff',
])

export async function checkCommand(cmd: string): Promise<boolean> {
  try {
    await which(cmd)
    return true
  } catch {
    return false
  }
}

export async function getCommandVersion(
  cmd: string,
  versionFlag = '--version',
): Promise<string | undefined> {
  // Validate command against allowlist to prevent arbitrary command execution
  if (!ALLOWED_VERSION_COMMANDS.has(cmd)) {
    return undefined
  }

  // Validate version flag to prevent command injection
  if (!/^--?[a-zA-Z][a-zA-Z0-9-]*$/.test(versionFlag)) {
    return undefined
  }

  try {
    const result = await execa(cmd, [versionFlag], { timeout: 5000 })
    const output = result.stdout || result.stderr
    // Extract version number from output
    const match = output.match(/\d+\.\d+(\.\d+)?/)
    return match ? match[0] : output.split('\n')[0].trim()
  } catch {
    return undefined
  }
}

export async function checkDocker(): Promise<HealthCheckResult> {
  const hasDocker = await checkCommand('docker')
  if (!hasDocker) {
    return {
      name: 'Docker',
      status: 'error',
      message: 'Docker not installed',
      details: { install: 'https://docs.docker.com/get-docker/' },
    }
  }

  try {
    await execa('docker', ['info'], { timeout: 10000 })
    const version = await getCommandVersion('docker')
    return {
      name: 'Docker',
      status: 'ok',
      message: version || 'running',
    }
  } catch {
    return {
      name: 'Docker',
      status: 'error',
      message: 'Docker not running - start Docker Desktop',
    }
  }
}

export async function checkKurtosis(): Promise<HealthCheckResult> {
  const hasKurtosis = await checkCommand('kurtosis')
  if (!hasKurtosis) {
    return {
      name: 'Kurtosis',
      status: 'warn',
      message: 'Not installed (will install automatically)',
    }
  }

  const version = await getCommandVersion('kurtosis', 'version')
  return {
    name: 'Kurtosis',
    status: 'ok',
    message: version || 'installed',
  }
}

export async function checkFoundry(): Promise<HealthCheckResult> {
  const hasForge = await checkCommand('forge')
  if (!hasForge) {
    return {
      name: 'Foundry',
      status: 'warn',
      message: 'Not installed (needed for contract tests)',
      details: { install: 'curl -L https://foundry.paradigm.xyz | bash' },
    }
  }

  const version = await getCommandVersion('forge')
  return {
    name: 'Foundry',
    status: 'ok',
    message: version || 'installed',
  }
}

export async function checkBun(): Promise<HealthCheckResult> {
  const hasBun = await checkCommand('bun')
  if (!hasBun) {
    return {
      name: 'Bun',
      status: 'error',
      message: 'Not installed',
      details: { install: 'curl -fsSL https://bun.sh/install | bash' },
    }
  }

  const version = await getCommandVersion('bun')
  return {
    name: 'Bun',
    status: 'ok',
    message: version || 'installed',
  }
}

export async function checkSocat(): Promise<HealthCheckResult> {
  const hasSocat = await checkCommand('socat')
  if (!hasSocat) {
    const os = platform()
    let install = 'Install socat'
    if (os === 'darwin') install = 'brew install socat'
    else if (os === 'linux') install = 'apt-get install socat'

    return {
      name: 'Socat',
      status: 'warn',
      message: 'Not installed (needed for port forwarding)',
      details: { install },
    }
  }

  return {
    name: 'Socat',
    status: 'ok',
    message: 'installed',
  }
}

export function getSystemInfo(): { os: string; arch: string; home: string } {
  return {
    os: `${platform()} ${arch()}`,
    arch: arch(),
    home: homedir(),
  }
}

export function getNetworkDir(): string {
  return join(homedir(), '.jeju')
}

export function getKeysDir(): string {
  return join(getNetworkDir(), 'keys')
}

export function getConfigPath(): string {
  return join(getNetworkDir(), 'config.json')
}

export async function installKurtosis(): Promise<boolean> {
  const os = platform()

  try {
    if (os === 'darwin') {
      // macOS - use Homebrew (safe package manager install)
      const hasBrew = await checkCommand('brew')
      if (!hasBrew) {
        return false
      }
      await execa('brew', ['install', 'kurtosis-tech/tap/kurtosis'], {
        timeout: 120000,
      })
      return true
    } else if (os === 'linux') {
      // Linux - download binary directly (safer than piping to bash)
      // SECURITY: Never pipe web content to shell. Download binary directly.
      const archStr = arch() === 'x64' ? 'amd64' : 'arm64'
      const releaseUrl =
        'https://api.github.com/repos/kurtosis-tech/kurtosis-cli-release-artifacts/releases/latest'
      const releaseInfo = GitHubReleaseSchema.parse(
        await fetch(releaseUrl, {
          signal: AbortSignal.timeout(10000),
        }).then((r) => r.json()),
      )
      const version = releaseInfo.tag_name

      // Validate version format to prevent injection
      if (!/^[\d.]+$/.test(version.replace(/^v/, ''))) {
        throw new Error('Invalid version format from GitHub API')
      }

      const tarball = `kurtosis-cli_${version}_linux_${archStr}.tar.gz`
      const url = `https://github.com/kurtosis-tech/kurtosis-cli-release-artifacts/releases/download/${version}/${tarball}`

      // Use cryptographically secure temp path to prevent race conditions
      const tmpPath = `/tmp/kurtosis-${randomHex(16).slice(2)}.tar.gz`
      await execa('curl', ['-fsSL', url, '-o', tmpPath], { timeout: 60000 })

      // Extract only the kurtosis binary to prevent writing arbitrary files
      await execa(
        'tar',
        ['-xzf', tmpPath, '-C', '/usr/local/bin', '--no-wildcards', 'kurtosis'],
        { timeout: 30000 },
      )

      // Clean up temp file
      await execa('rm', ['-f', tmpPath], { timeout: 5000 })

      return true
    }
    return false
  } catch {
    return false
  }
}

export async function isPortAvailable(port: number): Promise<boolean> {
  // Validate port number
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port number')
  }
  const result = await execa('lsof', ['-i', `:${port}`], {
    reject: false,
    timeout: 5000,
  })
  return result.exitCode !== 0
}

export async function killPort(port: number): Promise<void> {
  // Validate port number to prevent command injection
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port number')
  }

  const result = await execa('lsof', ['-ti', `:${port}`], {
    reject: false,
    timeout: 5000,
  })
  if (result.exitCode === 0 && result.stdout) {
    const pids = result.stdout.trim().split('\n').filter(Boolean)
    for (const pid of pids) {
      // Validate PID is numeric only
      if (/^\d+$/.test(pid)) {
        // Try SIGTERM first for graceful shutdown
        await execa('kill', ['-TERM', pid], { reject: false, timeout: 2000 })
      }
    }
    
    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000))
    
    // Don't force kill - let processes exit naturally
    // If ports are still in use, they'll be cleaned up when processes exit
  }
}

/**
 * Ensure a port is available by killing any process using it
 * Returns true if port is now available, false if still in use
 */
export async function ensurePortAvailable(port: number): Promise<boolean> {
  await killPort(port)
  // Verify port is actually available
  return await isPortAvailable(port)
}

export function findMonorepoRoot(): string {
  let dir = resolve(process.cwd())
  const root = platform() === 'win32' ? `${dir.split(':')[0]}:/` : '/'

  // Limit traversal to prevent infinite loops
  let iterations = 0
  const maxIterations = 50

  while (dir !== root && iterations < maxIterations) {
    iterations++
    if (
      existsSync(join(dir, 'bun.lock')) &&
      existsSync(join(dir, 'packages'))
    ) {
      return dir
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break // Reached filesystem root
    dir = parent
  }
  return resolve(process.cwd())
}
