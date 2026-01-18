/**
 * Build commands for Docker images, apps, and other artifacts
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { discoverApps } from '../lib/testing'

// Contracts to extract ABIs from (matches wagmi.config.ts)
const CONTRACTS_TO_EXTRACT = [
  // Core contracts
  'ERC20',
  'ERC20Factory',
  'Bazaar',

  // Identity & Moderation
  'IdentityRegistry',
  'ReputationRegistry',
  'ValidationRegistry',
  'BanManager',
  'ModerationMarketplace',

  // OIF (Open Intents Framework)
  'InputSettler',
  'OutputSettler',
  'SolverRegistry',
  'SimpleOracle',
  'HyperlaneOracle',
  'SuperchainOracle',
  'FederatedIdentity',
  'FederatedLiquidity',
  'FederatedSolver',

  // Native Token
  'NetworkToken',
  'JejuToken',

  // Service Contracts
  'CreditManager',
  'MultiTokenPaymaster',

  // Paymaster System
  'TokenRegistry',
  'PaymasterFactory',
  'LiquidityVault',
  'AppTokenPreference',
  'SponsoredPaymaster',

  // Launchpad
  'TokenLaunchpad',
  'BondingCurve',
  'ICOPresale',
  'LPLocker',
  'LaunchpadToken',

  // Chainlink
  'AutomationRegistry',
  'OracleRouter',
  'ChainlinkGovernance',
  'VRFCoordinatorV2_5',

  // Registry contracts
  'NetworkRegistry',
  'RegistrationHelper',
  'UserBlockRegistry',

  // Oracle contracts
  'MockAggregatorV3',
  'SimplePoolOracle',

  // OTC
  'OTC',
] as const

const ForgeArtifactSchema = z.object({
  abi: z.array(z.record(z.string(), z.unknown())),
  bytecode: z.object({ object: z.string() }).optional(),
  deployedBytecode: z.object({ object: z.string() }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

interface AbiOutput {
  abi: readonly Record<string, unknown>[]
}

async function parseArtifact(
  filePath: string,
): Promise<z.infer<typeof ForgeArtifactSchema>> {
  const file = Bun.file(filePath)
  const json: unknown = await file.json()
  return ForgeArtifactSchema.parse(json)
}

async function findArtifact(
  outDir: string,
  contractName: string,
): Promise<z.infer<typeof ForgeArtifactSchema> | null> {
  // Forge outputs to out/{ContractName}.sol/{ContractName}.json
  const solDir = join(outDir, `${contractName}.sol`)

  const dirExists = await Bun.file(solDir)
    .exists()
    .catch(() => false)
  if (!dirExists) {
    // Try to find in subdirectories
    let outDirs: string[] = []
    if (existsSync(outDir)) {
      outDirs = readdirSync(outDir)
    }
    for (const dir of outDirs) {
      if (dir.endsWith('.sol')) {
        const artifactPath = join(outDir, dir, `${contractName}.json`)
        const file = Bun.file(artifactPath)
        if (await file.exists()) {
          return parseArtifact(artifactPath)
        }
      }
    }
    return null
  }

  const artifactPath = join(solDir, `${contractName}.json`)
  const file = Bun.file(artifactPath)
  if (await file.exists()) {
    return parseArtifact(artifactPath)
  }

  return null
}

/**
 * Sync ABIs from Forge out/ directory to abis/ directory
 */
export async function syncAbis(contractsDir: string): Promise<{
  synced: number
  skipped: number
}> {
  const outDir = join(contractsDir, 'out')
  const abisDir = join(contractsDir, 'abis')

  let synced = 0
  let skipped = 0

  for (const contractName of CONTRACTS_TO_EXTRACT) {
    const artifact = await findArtifact(outDir, contractName)

    if (!artifact) {
      logger.debug(`  [skip] ${contractName} - artifact not found`)
      skipped++
      continue
    }

    if (!artifact.abi || artifact.abi.length === 0) {
      logger.debug(`  [skip] ${contractName} - no ABI in artifact`)
      skipped++
      continue
    }

    const output: AbiOutput = { abi: artifact.abi }
    const outputPath = join(abisDir, `${contractName}.json`)

    await Bun.write(outputPath, JSON.stringify(output, null, 2))
    logger.debug(`  [sync] ${contractName}`)
    synced++
  }

  return { synced, skipped }
}

// External packages that should not be bundled for browser
const BROWSER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'http2',
  'tls',
  'dgram',
  'fs',
  'net',
  'dns',
  'stream',
  'crypto',
  'node:url',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:events',
  '@jejunetwork/config',
  '@jejunetwork/shared',
  '@jejunetwork/sdk',
  '@jejunetwork/deployment',
  '@jejunetwork/contracts',
]

const buildCommand = new Command('build')
  .description('Build all components (contracts, TypeScript, apps)')
  .option('--contracts-only', 'Build contracts only')
  .option('--types-only', 'Build TypeScript types only')
  .option('--skip-docs', 'Skip documentation generation')
  .option('-a, --app <app>', 'Build specific app')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()

    // App-specific build
    if (options.app) {
      await buildApp(rootDir, options.app)
      process.exit(0)
    }

    if (options.contractsOnly) {
      const contractsDir = join(rootDir, 'packages/contracts')
      logger.step('Building contracts...')
      await execa('forge', ['build'], {
        cwd: contractsDir,
        stdio: 'inherit',
      })
      logger.step('Syncing ABIs...')
      const { synced, skipped } = await syncAbis(contractsDir)
      logger.info(`  ${synced} synced, ${skipped} skipped`)
      logger.success('Contracts built')
      process.exit(0)
    }

    if (options.typesOnly) {
      logger.step('Building types...')
      await execa('bun', ['run', 'build'], {
        cwd: join(rootDir, 'packages/types'),
        stdio: 'inherit',
      })
      logger.success('Types built')
      process.exit(0)
    }

    // Build types first
    logger.step('Building types...')
    await execa('bun', ['run', 'build'], {
      cwd: join(rootDir, 'packages/types'),
      stdio: 'inherit',
    })

    // Build contracts
    const contractsDir = join(rootDir, 'packages/contracts')
    logger.step('Building contracts...')
    await execa('forge', ['build'], {
      cwd: contractsDir,
      stdio: 'inherit',
    })
    logger.step('Syncing ABIs...')
    const { synced, skipped } = await syncAbis(contractsDir)
    logger.info(`  ${synced} synced, ${skipped} skipped`)

    // Generate docs if not skipped
    if (!options.skipDocs) {
      logger.step('Generating documentation...')
      await execa('bun', ['run', 'docs:generate'], {
        cwd: rootDir,
        stdio: 'pipe',
      }).catch(() => {
        logger.warn('Documentation generation skipped (optional)')
      })
    }

    logger.success('Build complete')
    process.exit(0)
  })

/**
 * Build a specific app (frontend + worker)
 */
async function buildApp(rootDir: string, appName: string): Promise<void> {
  logger.header(`BUILD ${appName.toUpperCase()}`)

  const apps = discoverApps(rootDir)
  const app = apps.find(
    (a) =>
      (a._folderName ?? a.slug ?? a.name) === appName || a.name === appName,
  )

  if (!app) {
    logger.error(`App not found: ${appName}`)
    process.exit(1)
  }

  const folderName = app._folderName ?? app.slug ?? appName
  let appDir = join(rootDir, 'apps', folderName)
  if (!existsSync(appDir)) {
    appDir = join(rootDir, 'vendor', folderName)
  }

  if (!existsSync(appDir)) {
    logger.error(`App directory not found: ${folderName}`)
    process.exit(1)
  }

  const distDir = join(appDir, 'dist')
  const staticDir = join(distDir, 'static')
  const workerDir = join(distDir, 'worker')

  // Clean and create dist directories
  if (existsSync(distDir)) {
    await execa('rm', ['-rf', distDir])
  }
  await execa('mkdir', ['-p', staticDir, workerDir])

  // Build frontend
  logger.step('Building frontend...')
  const clientEntry = existsSync(join(appDir, 'src/client.tsx'))
    ? join(appDir, 'src/client.tsx')
    : existsSync(join(appDir, 'src/client/index.tsx'))
      ? join(appDir, 'src/client/index.tsx')
      : null

  if (clientEntry) {
    const result = await Bun.build({
      entrypoints: [clientEntry],
      outdir: staticDir,
      target: 'browser',
      splitting: true,
      minify: true,
      sourcemap: 'external',
      external: BROWSER_EXTERNALS,
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.PUBLIC_API_URL': JSON.stringify(
          process.env.PUBLIC_API_URL ?? '',
        ),
      },
      naming: {
        entry: '[name]-[hash].js',
        chunk: 'chunks/[name]-[hash].js',
        asset: 'assets/[name]-[hash].[ext]',
      },
    })

    if (!result.success) {
      logger.error('Frontend build failed:')
      for (const log of result.logs) {
        console.error(log)
      }
      process.exit(1)
    }

    // Find main entry file
    const mainEntry = result.outputs.find(
      (o) => o.kind === 'entry-point' && o.path.includes('client'),
    )
    const mainFileName = mainEntry?.path.split('/').pop() ?? 'client.js'

    // Copy CSS if exists
    const cssPath = join(appDir, 'src/globals.css')
    if (existsSync(cssPath)) {
      const css = await Bun.file(cssPath).text()
      await Bun.write(join(staticDir, 'globals.css'), css)
    }

    // Create index.html
    const indexHtml = createIndexHtml(app.displayName || appName, mainFileName)
    await Bun.write(join(staticDir, 'index.html'), indexHtml)

    logger.success(`Frontend built to ${staticDir}`)
  } else {
    logger.info('No frontend entry found, skipping')
  }

  // Build worker/API
  logger.step('Building API worker...')
  const workerEntry = existsSync(join(appDir, 'api/worker.ts'))
    ? join(appDir, 'api/worker.ts')
    : existsSync(join(appDir, 'src/worker/index.ts'))
      ? join(appDir, 'src/worker/index.ts')
      : existsSync(join(appDir, 'src/server.ts'))
        ? join(appDir, 'src/server.ts')
        : null

  if (workerEntry) {
    const result = await Bun.build({
      entrypoints: [workerEntry],
      outdir: workerDir,
      target: 'bun',
      minify: true,
      sourcemap: 'external',
      external: ['bun:sqlite', 'child_process', 'node:child_process'],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    })

    if (!result.success) {
      logger.error('Worker build failed:')
      for (const log of result.logs) {
        console.error(log)
      }
      process.exit(1)
    }

    // Create worker metadata
    const metadata = {
      name: `${appName}-api`,
      version: app.version ?? '1.0.0',
      entrypoint: 'worker.js',
      compatibilityDate: new Date().toISOString().split('T')[0],
      buildTime: new Date().toISOString(),
    }
    await Bun.write(
      join(workerDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
    )

    logger.success(`Worker built to ${workerDir}`)
  } else {
    logger.info('No worker entry found, skipping')
  }

  // Create deployment manifest
  const deploymentManifest = {
    name: appName,
    version: app.version ?? '1.0.0',
    architecture: {
      frontend: clientEntry
        ? {
            type: 'static',
            path: 'static',
            spa: true,
            fallback: 'index.html',
          }
        : null,
      worker: workerEntry
        ? {
            type: 'elysia',
            path: 'worker',
            entrypoint: 'worker.js',
            routes: ['/api/*', '/health', '/.well-known/*'],
          }
        : null,
    },
    buildTime: new Date().toISOString(),
  }
  await Bun.write(
    join(distDir, 'deployment.json'),
    JSON.stringify(deploymentManifest, null, 2),
  )

  logger.newline()
  logger.success('Build complete.')
  logger.keyValue('Output', distDir)
}

function createIndexHtml(title: string, mainScript: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: { extend: {} }
    }
  </script>
  <script>
    (function() {
      try {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
  </script>
  <link rel="stylesheet" href="/globals.css">
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/${mainScript}"></script>
</body>
</html>`
}

buildCommand
  .command('images')
  .description('Build Docker images for infrastructure (DWS storage)')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--push', 'Push images to DWS Storage (IPFS)')
  .action(async (options: { network: string; push?: boolean }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/build-images-dws.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Build images script not found')
      process.exit(1)
    }

    const args: string[] = []
    if (options.push) args.push('--push')

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    })
    process.exit(0)
  })

buildCommand
  .command('sqlit')
  .description('Build SQLit multi-arch Docker image')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--push', 'Push image to DWS Storage')
  .option('--arm-only', 'Build ARM64 only')
  .option('--x86-only', 'Build x86_64 only')
  .action(
    async (options: {
      network: string
      push?: boolean
      armOnly?: boolean
      x86Only?: boolean
    }) => {
      const rootDir = findMonorepoRoot()
      const scriptPath = join(
        rootDir,
        'packages/deployment/scripts/build-sqlit.ts',
      )

      if (!existsSync(scriptPath)) {
        logger.error('Build SQLit script not found')
        process.exit(1)
      }

      const args: string[] = []
      if (options.push) args.push('--push')
      if (options.armOnly) args.push('--arm-only')
      if (options.x86Only) args.push('--x86-only')

      await execa('bun', ['run', scriptPath, ...args], {
        cwd: rootDir,
        env: { ...process.env, NETWORK: options.network },
        stdio: 'inherit',
      })
      process.exit(0)
    },
  )

buildCommand
  .command('abis')
  .description('Sync contract ABIs from forge out/ to abis/')
  .action(async () => {
    const rootDir = findMonorepoRoot()
    const contractsDir = join(rootDir, 'packages/contracts')

    if (!existsSync(join(contractsDir, 'out'))) {
      logger.error('Forge out/ directory not found. Run forge build first.')
      process.exit(1)
    }

    logger.step('Syncing ABIs from forge out/ to abis/')
    const { synced, skipped } = await syncAbis(contractsDir)
    logger.success(`Done: ${synced} synced, ${skipped} skipped`)
    process.exit(0)
  })

buildCommand
  .command('all-apps')
  .description('Build all apps in the monorepo')
  .option('--parallel', 'Build apps in parallel')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()
    const apps = discoverApps(rootDir)

    logger.header('BUILD ALL APPS')
    logger.info(`Found ${apps.length} apps`)
    logger.newline()

    const buildableApps = apps.filter((app) => {
      const folderName = app._folderName ?? app.slug ?? app.name
      const appDir = existsSync(join(rootDir, 'apps', folderName))
        ? join(rootDir, 'apps', folderName)
        : join(rootDir, 'vendor', folderName)

      // Check if app has buildable entries
      return (
        existsSync(join(appDir, 'src/client.tsx')) ||
        existsSync(join(appDir, 'api/worker.ts')) ||
        existsSync(join(appDir, 'src/server.ts'))
      )
    })

    if (options.parallel) {
      await Promise.all(
        buildableApps.map((app) => {
          const name = app._folderName ?? app.slug ?? app.name
          return buildApp(rootDir, name).catch((e) => {
            logger.error(`Failed to build ${name}: ${e}`)
          })
        }),
      )
    } else {
      for (const app of buildableApps) {
        const name = app._folderName ?? app.slug ?? app.name
        await buildApp(rootDir, name).catch((e) => {
          logger.error(`Failed to build ${name}: ${e}`)
        })
      }
    }

    logger.newline()
    logger.success(`Built ${buildableApps.length} apps`)
    process.exit(0)
  })

buildCommand
  .command('frontend')
  .description('Build frontend only for an app')
  .argument('<app>', 'App name')
  .option('--minify', 'Minify output', true)
  .action(async (appName, options) => {
    const rootDir = findMonorepoRoot()

    const apps = discoverApps(rootDir)
    const app = apps.find(
      (a) =>
        (a._folderName ?? a.slug ?? a.name) === appName || a.name === appName,
    )

    if (!app) {
      logger.error(`App not found: ${appName}`)
      process.exit(1)
    }

    const folderName = app._folderName ?? app.slug ?? appName
    let appDir = join(rootDir, 'apps', folderName)
    if (!existsSync(appDir)) {
      appDir = join(rootDir, 'vendor', folderName)
    }

    const clientEntry = existsSync(join(appDir, 'src/client.tsx'))
      ? join(appDir, 'src/client.tsx')
      : existsSync(join(appDir, 'src/client/index.tsx'))
        ? join(appDir, 'src/client/index.tsx')
        : null

    if (!clientEntry) {
      logger.error(`No frontend entry found in ${appName}`)
      process.exit(1)
    }

    logger.header(`BUILD FRONTEND: ${appName.toUpperCase()}`)

    const outdir = join(appDir, 'dist/static')
    await execa('mkdir', ['-p', outdir])

    const result = await Bun.build({
      entrypoints: [clientEntry],
      outdir,
      target: 'browser',
      splitting: true,
      minify: options.minify,
      sourcemap: 'external',
      external: BROWSER_EXTERNALS,
    })

    if (!result.success) {
      logger.error('Build failed')
      process.exit(1)
    }

    logger.success(`Frontend built to ${outdir}`)
    process.exit(0)
  })

buildCommand
  .command('worker')
  .description('Build API worker only for an app')
  .argument('<app>', 'App name')
  .action(async (appName) => {
    const rootDir = findMonorepoRoot()

    const apps = discoverApps(rootDir)
    const app = apps.find(
      (a) =>
        (a._folderName ?? a.slug ?? a.name) === appName || a.name === appName,
    )

    if (!app) {
      logger.error(`App not found: ${appName}`)
      process.exit(1)
    }

    const folderName = app._folderName ?? app.slug ?? appName
    let appDir = join(rootDir, 'apps', folderName)
    if (!existsSync(appDir)) {
      appDir = join(rootDir, 'vendor', folderName)
    }

    const workerEntry = existsSync(join(appDir, 'api/worker.ts'))
      ? join(appDir, 'api/worker.ts')
      : existsSync(join(appDir, 'src/worker/index.ts'))
        ? join(appDir, 'src/worker/index.ts')
        : existsSync(join(appDir, 'src/server.ts'))
          ? join(appDir, 'src/server.ts')
          : null

    if (!workerEntry) {
      logger.error(`No worker entry found in ${appName}`)
      process.exit(1)
    }

    logger.header(`BUILD WORKER: ${appName.toUpperCase()}`)

    const outdir = join(appDir, 'dist/worker')
    await execa('mkdir', ['-p', outdir])

    const result = await Bun.build({
      entrypoints: [workerEntry],
      outdir,
      target: 'bun',
      minify: true,
      sourcemap: 'external',
      external: ['bun:sqlite', 'child_process'],
    })

    if (!result.success) {
      logger.error('Build failed')
      process.exit(1)
    }

    logger.success(`Worker built to ${outdir}`)
    process.exit(0)
  })

export { buildCommand }
