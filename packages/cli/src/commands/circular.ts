/** Circular dependency detection for apps, packages, and the whole repo */

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import madge from 'madge'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

interface CircularResult {
  name: string
  type: 'app' | 'package'
  path: string
  circularDeps: string[][]
  entryFile: string
}

interface RepoSummary {
  totalApps: number
  totalPackages: number
  appsWithCircular: number
  packagesWithCircular: number
  totalCircularPaths: number
  results: CircularResult[]
}

function getEntryFile(dir: string): string | null {
  // Common entry points in order of preference
  const entryPoints = [
    'src/index.ts',
    'api/index.ts',
    'web/main.tsx',
    'web/App.tsx',
    'web/client.tsx',
    'index.ts',
    'lib/index.ts',
    'ts/index.ts',
  ]

  for (const entry of entryPoints) {
    if (existsSync(join(dir, entry))) {
      return entry
    }
  }

  // Fall back to any .ts or .tsx file in common directories
  const searchDirs = ['src', 'api', 'web', 'lib', 'ts', '.']
  for (const searchDir of searchDirs) {
    const fullPath = join(dir, searchDir)
    if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
      const files = readdirSync(fullPath)
      const tsFile = files.find(
        (f) =>
          (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.endsWith('.d.ts'),
      )
      if (tsFile) {
        return join(searchDir, tsFile)
      }
    }
  }

  return null
}

async function checkCircular(
  dir: string,
  name: string,
  type: 'app' | 'package',
): Promise<CircularResult> {
  const entryFile = getEntryFile(dir)

  if (!entryFile) {
    return {
      name,
      type,
      path: dir,
      circularDeps: [],
      entryFile: 'none',
    }
  }

  const result = await madge(join(dir, entryFile), {
    fileExtensions: ['ts', 'tsx', 'js', 'jsx'],
    tsConfig: existsSync(join(dir, 'tsconfig.json'))
      ? join(dir, 'tsconfig.json')
      : undefined,
    detectiveOptions: {
      ts: {
        skipTypeImports: true,
      },
    },
  })

  const circular = result.circular()

  return {
    name,
    type,
    path: dir,
    circularDeps: circular,
    entryFile,
  }
}

function discoverTargets(
  rootDir: string,
  targetType: 'apps' | 'packages' | 'all',
): Array<{ name: string; path: string; type: 'app' | 'package' }> {
  const targets: Array<{
    name: string
    path: string
    type: 'app' | 'package'
  }> = []

  if (targetType === 'apps' || targetType === 'all') {
    const appsDir = join(rootDir, 'apps')
    if (existsSync(appsDir)) {
      const appDirs = readdirSync(appsDir).filter((name) => {
        const fullPath = join(appsDir, name)
        return (
          statSync(fullPath).isDirectory() &&
          !name.startsWith('.') &&
          name !== 'node_modules'
        )
      })

      for (const name of appDirs) {
        targets.push({
          name,
          path: join(appsDir, name),
          type: 'app',
        })
      }
    }
  }

  if (targetType === 'packages' || targetType === 'all') {
    const packagesDir = join(rootDir, 'packages')
    if (existsSync(packagesDir)) {
      const packageDirs = readdirSync(packagesDir).filter((name) => {
        const fullPath = join(packagesDir, name)
        return (
          statSync(fullPath).isDirectory() &&
          !name.startsWith('.') &&
          name !== 'node_modules' &&
          name !== 'tests' // Skip tests package for circular check
        )
      })

      for (const name of packageDirs) {
        targets.push({
          name,
          path: join(packagesDir, name),
          type: 'package',
        })
      }
    }
  }

  return targets
}

function printResult(result: CircularResult, rootDir: string): void {
  const relativePath = relative(rootDir, result.path)
  const icon = result.type === 'app' ? '📱' : '📦'

  if (result.circularDeps.length === 0) {
    logger.info(
      `${icon} ${chalk.green('✓')} ${chalk.bold(result.name)} ${chalk.dim(`(${relativePath})`)}`,
    )
  } else {
    logger.info(
      `${icon} ${chalk.red('✗')} ${chalk.bold(result.name)} ${chalk.dim(`(${relativePath})`)} - ${chalk.red(`${result.circularDeps.length} circular`)}`,
    )

    for (const cycle of result.circularDeps) {
      const cycleStr = cycle.join(' → ')
      logger.info(`      ${chalk.yellow('⟳')} ${chalk.dim(cycleStr)}`)
    }
  }
}

function printSummary(summary: RepoSummary): void {
  logger.newline()
  logger.info(chalk.bold('═══════════════════════════════════════════════════'))
  logger.info(chalk.bold('                    SUMMARY'))
  logger.info(chalk.bold('═══════════════════════════════════════════════════'))
  logger.newline()

  const totalTargets = summary.totalApps + summary.totalPackages
  const totalWithCircular =
    summary.appsWithCircular + summary.packagesWithCircular
  const healthyPercent = (
    ((totalTargets - totalWithCircular) / totalTargets) *
    100
  ).toFixed(1)

  logger.info(
    `  📱 Apps:     ${summary.totalApps} total, ${chalk.red(`${summary.appsWithCircular} with circular deps`)}`,
  )
  logger.info(
    `  📦 Packages: ${summary.totalPackages} total, ${chalk.red(`${summary.packagesWithCircular} with circular deps`)}`,
  )
  logger.newline()
  logger.info(
    `  🔄 Total circular dependency paths: ${chalk.red(summary.totalCircularPaths.toString())}`,
  )
  logger.info(`  ✅ Healthy targets: ${chalk.green(`${healthyPercent}%`)}`)
  logger.newline()

  if (totalWithCircular > 0) {
    logger.warn(chalk.yellow('  ⚠️  Circular dependencies can cause:'))
    logger.info(chalk.dim('     - Import order issues and runtime errors'))
    logger.info(chalk.dim('     - Bundler problems and larger bundle sizes'))
    logger.info(chalk.dim('     - Harder to understand and maintain code'))
    logger.newline()
  }
}

function generateJsonReport(
  summary: RepoSummary,
  rootDir: string,
): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalApps: summary.totalApps,
      totalPackages: summary.totalPackages,
      appsWithCircular: summary.appsWithCircular,
      packagesWithCircular: summary.packagesWithCircular,
      totalCircularPaths: summary.totalCircularPaths,
    },
    results: summary.results.map((r) => ({
      name: r.name,
      type: r.type,
      path: relative(rootDir, r.path),
      entryFile: r.entryFile,
      hasCircular: r.circularDeps.length > 0,
      circularCount: r.circularDeps.length,
      circularDeps: r.circularDeps,
    })),
  }
}

const circularCommand = new Command('circular')
  .description('Check for circular dependencies in apps and packages')
  .alias('deps')

circularCommand
  .command('check')
  .description('Check all apps and packages for circular dependencies')
  .option('--apps', 'Check only apps')
  .option('--packages', 'Check only packages')
  .option('--json', 'Output as JSON')
  .option('--output <file>', 'Write report to file')
  .option('--fail', 'Exit with error code if circular dependencies found')
  .action(
    async (opts: {
      apps?: boolean
      packages?: boolean
      json?: boolean
      output?: string
      fail?: boolean
    }) => {
      const rootDir = findMonorepoRoot()

      let targetType: 'apps' | 'packages' | 'all' = 'all'
      if (opts.apps && !opts.packages) targetType = 'apps'
      if (opts.packages && !opts.apps) targetType = 'packages'

      if (!opts.json) {
        logger.header('CIRCULAR DEPENDENCY CHECK')
        logger.info(`Scanning ${targetType}...`)
        logger.newline()
      }

      const targets = discoverTargets(rootDir, targetType)
      const results: CircularResult[] = []

      for (const target of targets) {
        try {
          const result = await checkCircular(
            target.path,
            target.name,
            target.type,
          )
          results.push(result)

          if (!opts.json) {
            printResult(result, rootDir)
          }
        } catch (error) {
          if (!opts.json) {
            logger.warn(
              `Could not analyze ${target.name}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
      }

      const summary: RepoSummary = {
        totalApps: results.filter((r) => r.type === 'app').length,
        totalPackages: results.filter((r) => r.type === 'package').length,
        appsWithCircular: results.filter(
          (r) => r.type === 'app' && r.circularDeps.length > 0,
        ).length,
        packagesWithCircular: results.filter(
          (r) => r.type === 'package' && r.circularDeps.length > 0,
        ).length,
        totalCircularPaths: results.reduce(
          (sum, r) => sum + r.circularDeps.length,
          0,
        ),
        results,
      }

      if (opts.json) {
        const report = generateJsonReport(summary, rootDir)
        console.log(JSON.stringify(report, null, 2))
      } else {
        printSummary(summary)
      }

      if (opts.output) {
        const report = generateJsonReport(summary, rootDir)
        writeFileSync(opts.output, JSON.stringify(report, null, 2))
        if (!opts.json) {
          logger.info(`Report written to ${opts.output}`)
        }
      }

      if (opts.fail && summary.totalCircularPaths > 0) {
        process.exit(1)
      }
    },
  )

circularCommand
  .command('app <name>')
  .description('Check a specific app for circular dependencies')
  .option('--json', 'Output as JSON')
  .action(async (name: string, opts: { json?: boolean }) => {
    const rootDir = findMonorepoRoot()
    const appPath = join(rootDir, 'apps', name)

    if (!existsSync(appPath)) {
      logger.error(`App not found: ${name}`)
      process.exit(1)
    }

    if (!opts.json) {
      logger.header(`CIRCULAR CHECK: ${name}`)
    }

    const result = await checkCircular(appPath, name, 'app')

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printResult(result, rootDir)
      logger.newline()

      if (result.circularDeps.length === 0) {
        logger.info(chalk.green('No circular dependencies found.'))
      } else {
        logger.error(
          `Found ${result.circularDeps.length} circular dependency path(s).`,
        )
      }
    }
  })

circularCommand
  .command('package <name>')
  .description('Check a specific package for circular dependencies')
  .option('--json', 'Output as JSON')
  .action(async (name: string, opts: { json?: boolean }) => {
    const rootDir = findMonorepoRoot()
    const pkgPath = join(rootDir, 'packages', name)

    if (!existsSync(pkgPath)) {
      logger.error(`Package not found: ${name}`)
      process.exit(1)
    }

    if (!opts.json) {
      logger.header(`CIRCULAR CHECK: ${name}`)
    }

    const result = await checkCircular(pkgPath, name, 'package')

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printResult(result, rootDir)
      logger.newline()

      if (result.circularDeps.length === 0) {
        logger.info(chalk.green('No circular dependencies found.'))
      } else {
        logger.error(
          `Found ${result.circularDeps.length} circular dependency path(s).`,
        )
      }
    }
  })

circularCommand
  .command('cross')
  .description('Check for circular dependencies across packages')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const rootDir = findMonorepoRoot()

    if (!opts.json) {
      logger.header('CROSS-PACKAGE CIRCULAR DEPENDENCIES')
      logger.info('Analyzing package interdependencies...')
      logger.newline()
    }

    // Check from packages entry points for cross-package cycles
    const packagesDir = join(rootDir, 'packages')
    const indexFile = join(packagesDir, 'types/src/index.ts')

    if (!existsSync(indexFile)) {
      logger.error('Could not find packages/types entry point')
      process.exit(1)
    }

    // Use a broader scan by checking from multiple package entry points
    const packageNames = [
      'types',
      'shared',
      'sdk',
      'contracts',
      'db',
      'config',
      'api',
    ]
    const crossPackageCycles: string[][] = []

    for (const pkgName of packageNames) {
      const pkgPath = join(packagesDir, pkgName)
      const entry = getEntryFile(pkgPath)

      if (!entry) continue

      try {
        const result = await madge(join(pkgPath, entry), {
          fileExtensions: ['ts', 'tsx', 'js', 'jsx'],
          tsConfig: existsSync(join(pkgPath, 'tsconfig.json'))
            ? join(pkgPath, 'tsconfig.json')
            : undefined,
          detectiveOptions: {
            ts: {
              skipTypeImports: true,
            },
          },
        })

        const circular = result.circular()

        // Filter for cross-package cycles (paths that span multiple packages)
        for (const cycle of circular) {
          const packages = new Set(
            cycle.map((cyclePath: string) => {
              const match = cyclePath.match(/packages\/([^/]+)/)
              return match ? match[1] : null
            }),
          )
          packages.delete(null)

          if (packages.size > 1) {
            crossPackageCycles.push(cycle)
          }
        }
      } catch {
        // Skip packages that can't be analyzed
      }
    }

    // Deduplicate cycles
    const uniqueCycles = crossPackageCycles.filter(
      (cycle, index, self) =>
        index ===
        self.findIndex(
          (c) =>
            c.length === cycle.length &&
            c.every((item, i) => item === cycle[i]),
        ),
    )

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            crossPackageCycles: uniqueCycles,
            count: uniqueCycles.length,
          },
          null,
          2,
        ),
      )
    } else {
      if (uniqueCycles.length === 0) {
        logger.info(
          chalk.green('No cross-package circular dependencies found.'),
        )
      } else {
        logger.error(
          `Found ${uniqueCycles.length} cross-package circular dependency path(s):`,
        )
        logger.newline()

        for (const cycle of uniqueCycles) {
          const cycleStr = cycle.map((p) => relative(rootDir, p)).join(' → ')
          logger.info(`  ${chalk.yellow('⟳')} ${cycleStr}`)
        }
      }
    }
  })

// Default action shows help
circularCommand.action(() => {
  circularCommand.outputHelp()
})

export { circularCommand }
