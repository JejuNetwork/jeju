/** Build commands for Docker images, apps, and artifacts */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { discoverApps } from '../lib/testing'

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
  '@jejunetwork/oauth3',
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
      return
    }

    if (options.contractsOnly) {
      logger.step('Building contracts...')
      await execa('forge', ['build'], {
        cwd: join(rootDir, 'packages/contracts'),
        stdio: 'inherit',
      })
      logger.success('Contracts built')
      return
    }

    if (options.typesOnly) {
      logger.step('Building types...')
      await execa('bun', ['run', 'build'], {
        cwd: join(rootDir, 'packages/types'),
        stdio: 'inherit',
      })
      logger.success('Types built')
      return
    }

    // Build types first
    logger.step('Building types...')
    await execa('bun', ['run', 'build'], {
      cwd: join(rootDir, 'packages/types'),
      stdio: 'inherit',
    })

    // Build contracts
    logger.step('Building contracts...')
    await execa('forge', ['build'], {
      cwd: join(rootDir, 'packages/contracts'),
      stdio: 'inherit',
    })

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
          process.env.PUBLIC_API_URL || '',
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
    const mainFileName = mainEntry
      ? (mainEntry.path.split('/').pop() ?? 'client.js')
      : 'client.js'

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
    : existsSync(join(appDir, 'api/server/index.ts'))
      ? join(appDir, 'api/server/index.ts')
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
      version: app.version || '1.0.0',
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
    version: app.version || '1.0.0',
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
  .description('Build Docker images for apps')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--push', 'Push images to ECR after building')
  .action(async (options: { network: string; push?: boolean }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/build-images.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Build images script not found')
      return
    }

    const args: string[] = []
    if (options.push) args.push('--push')

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    })
  })

buildCommand
  .command('covenantsql')
  .description('Build CovenantSQL multi-arch Docker image')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--push', 'Push image to ECR after building')
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
        'packages/deployment/scripts/build-covenantsql.ts',
      )

      if (!existsSync(scriptPath)) {
        logger.error('Build CovenantSQL script not found')
        return
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
    },
  )

buildCommand
  .command('abis')
  .description('Export contract ABIs from forge build artifacts')
  .action(async () => {
    logger.error('ABI export functionality has been removed.')
    logger.info('ABIs are automatically exported during forge build.')
    logger.info('Check packages/contracts/abis/ for exported ABIs.')
    process.exit(1)
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
        existsSync(join(appDir, 'api/server/index.ts')) ||
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
      : existsSync(join(appDir, 'api/server/index.ts'))
        ? join(appDir, 'api/server/index.ts')
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
  })

export { buildCommand }
