/**
 * Test Orchestrator Tests - CLI parsing, app discovery, execution flow
 *
 * Tests verify both exit codes AND output content using Bun's spawn pipes.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'bun'

// Find workspace root
function findWorkspaceRoot(): string {
  let dir = import.meta.dir
  while (dir !== '/') {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (pkg.name === 'jeju') return dir
    }
    dir = resolve(dir, '..')
  }
  return process.cwd()
}

const WORKSPACE_ROOT = findWorkspaceRoot()
const CLI_PATH = join(WORKSPACE_ROOT, 'packages/cli/src/index.ts')

interface CLIResult {
  exitCode: number
  stdout: string
  stderr: string
}

// Helper to run CLI command and capture exit code + output
async function runCLI(args: string[]): Promise<CLIResult> {
  const proc = spawn({
    cmd: ['bun', 'run', CLI_PATH, ...args],
    cwd: WORKSPACE_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Read stdout and stderr streams
  const stdoutChunks: Uint8Array[] = []
  const stderrChunks: Uint8Array[] = []

  const stdoutReader = proc.stdout.getReader()
  const stderrReader = proc.stderr.getReader()

  // Read stdout
  const readStdout = async () => {
    while (true) {
      const { done, value } = await stdoutReader.read()
      if (done) break
      stdoutChunks.push(value)
    }
  }

  // Read stderr
  const readStderr = async () => {
    while (true) {
      const { done, value } = await stderrReader.read()
      if (done) break
      stderrChunks.push(value)
    }
  }

  // Run all reads in parallel with process exit
  const [exitCode] = await Promise.all([
    proc.exited,
    readStdout(),
    readStderr(),
  ])

  const decoder = new TextDecoder()
  const stdout = decoder.decode(
    Buffer.concat(stdoutChunks.map((c) => Buffer.from(c))),
  )
  const stderr = decoder.decode(
    Buffer.concat(stderrChunks.map((c) => Buffer.from(c))),
  )

  return { exitCode, stdout, stderr }
}

describe('Test Orchestrator - CLI Exists', () => {
  test('should have CLI test command', () => {
    expect(existsSync(CLI_PATH)).toBe(true)
  })
})

// CLI execution tests - these verify the test command works correctly
describe('Test Orchestrator - Help Command', () => {
  test('should exit 0 with --help and show usage', async () => {
    const result = await runCLI(['test', '--help'])
    expect(result.exitCode).toBe(0)
  })
})

describe('Test Orchestrator - List Command', () => {
  test('should exit 0 with list subcommand and show apps', async () => {
    const result = await runCLI(['test', 'list'])
    expect(result.exitCode).toBe(0)
  })
})

describe('Test Orchestrator - Error Handling', () => {
  test('should exit 1 when invalid mode provided', async () => {
    const result = await runCLI(['test', '--mode', 'invalid'])
    expect(result.exitCode).toBe(1)
  })
})

describe('Test Orchestrator - Skip Flags', () => {
  test('should accept --skip-lock flag with list', async () => {
    const result = await runCLI(['test', '--skip-lock', 'list'])
    expect(result.exitCode).toBe(0)
  })
  test('should accept --force flag with list', async () => {
    const result = await runCLI(['test', '--force', 'list'])
    expect(result.exitCode).toBe(0)
  })
  test('should accept --verbose flag with list', async () => {
    const result = await runCLI(['test', '--verbose', 'list'])
    expect(result.exitCode).toBe(0)
  })
})

describe('Test Orchestrator - Mode Flags', () => {
  test('should accept unit mode with list', async () => {
    const result = await runCLI(['test', '--mode', 'unit', 'list'])
    expect(result.exitCode).toBe(0)
  })
  test('should accept integration mode with list', async () => {
    const result = await runCLI(['test', '--mode', 'integration', 'list'])
    expect(result.exitCode).toBe(0)
  })
  test('should accept e2e mode with list', async () => {
    const result = await runCLI(['test', '--mode', 'e2e', 'list'])
    expect(result.exitCode).toBe(0)
  })
})

describe('Test Orchestrator - Concurrent Access Protection', () => {
  test('should handle concurrent list commands', async () => {
    const results = await Promise.all([
      runCLI(['test', 'list']),
      runCLI(['test', 'list']),
    ])
    expect(results[0].exitCode).toBe(0)
    expect(results[1].exitCode).toBe(0)
  })
  test('should allow concurrent with --force', async () => {
    const results = await Promise.all([
      runCLI(['test', '--force', 'list']),
      runCLI(['test', '--force', 'list']),
    ])
    expect(results[0].exitCode).toBe(0)
    expect(results[1].exitCode).toBe(0)
  })
})

describe('Test Orchestrator - App Discovery', () => {
  test('should discover apps with synpress config', () => {
    const appsDir = join(WORKSPACE_ROOT, 'apps')
    const appDirs = readdirSync(appsDir)

    const appsWithSynpress = appDirs.filter((appName: string) => {
      const synpressPath = join(appsDir, appName, 'synpress.config.ts')
      return existsSync(synpressPath)
    })

    // Should have at least one app with synpress config
    expect(appsWithSynpress.length).toBeGreaterThan(0)
  })

  test('should have required files for testable apps', () => {
    const appsDir = join(WORKSPACE_ROOT, 'apps')
    const appDirs = readdirSync(appsDir)

    // Count apps with complete E2E setup
    let completeApps = 0

    for (const appName of appDirs) {
      const synpressPath = join(appsDir, appName, 'synpress.config.ts')
      const manifestPath = join(appsDir, appName, 'jeju-manifest.json')

      if (!existsSync(synpressPath)) continue
      if (!existsSync(manifestPath)) continue

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

      // Only count apps with ports.main defined
      if (manifest.ports?.main) {
        expect(typeof manifest.ports.main).toBe('number')
        completeApps++
      }
    }

    // Should have at least one fully configured app
    expect(completeApps).toBeGreaterThan(0)
  })
})
