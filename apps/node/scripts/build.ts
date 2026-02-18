#!/usr/bin/env bun
/**
 * Production build script for Node App
 *
 * Builds:
 * 1. Static frontend (dist/static/) - for IPFS/CDN deployment
 * 2. CLI bundle (dist/cli/) - for command line usage
 * 3. Lander (dist/lander/) - landing page
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { reportBundleSizes } from '@jejunetwork/shared'

const APP_DIR = resolve(import.meta.dir, '..')
const DIST_DIR = resolve(APP_DIR, 'dist')
const STATIC_DIR = `${DIST_DIR}/static`
const CLI_DIR = `${DIST_DIR}/cli`
const LANDER_DIR = `${DIST_DIR}/lander`

async function buildFrontend(): Promise<void> {
  console.log('[Node] Building static frontend...')

  const result = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/main.tsx')],
    outdir: STATIC_DIR,
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    packages: 'bundle',
    splitting: false,
    naming: '[name].[hash].[ext]',
    external: ['bun:sqlite', 'node:*', 'pino', 'pino-*'],
    drop: ['debugger'],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': JSON.stringify(true),
    },
  })

  if (!result.success) {
    console.error('[Node] Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('Frontend build failed')
  }

  reportBundleSizes(result, 'Frontend')

  // Compile Tailwind CSS
  console.log('[Node] Compiling Tailwind CSS...')
  const tailwindProc = Bun.spawn([
    'bunx', 'tailwindcss',
    '-i', resolve(APP_DIR, 'web/globals.css'),
    '-o', `${STATIC_DIR}/tailwind.css`,
    '--minify'
  ], { cwd: APP_DIR, stdout: 'inherit', stderr: 'inherit' })
  await tailwindProc.exited
  if (tailwindProc.exitCode !== 0) {
    throw new Error('Tailwind CSS compilation failed')
  }

  // Find the main entry file
  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  // Find the CSS file
  const cssEntry = result.outputs.find(
    (o) => o.path.endsWith('.css'),
  )
  const cssFileName = cssEntry ? cssEntry.path.split('/').pop() : null

  // Create index.html (no CDN - use compiled Tailwind)
  const html = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/public/jeju-icon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jeju Node</title>
    <link rel="stylesheet" href="/tailwind.css" />
    ${cssFileName ? `<link rel="stylesheet" href="/${cssFileName}" />` : ''}
    <script>
      // Process shim for browser environment (required by some npm packages)
      window.process = {
        env: { NODE_ENV: 'production' },
        browser: true,
        version: '',
        versions: {},
        on: function() {},
        addListener: function() {},
        once: function() {},
        off: function() {},
        removeListener: function() {},
        removeAllListeners: function() {},
        emit: function() {},
        prependListener: function() {},
        prependOnceListener: function() {},
        listeners: function() { return []; },
        binding: function() { throw new Error('process.binding is not supported'); },
        cwd: function() { return '/'; },
        chdir: function() { throw new Error('process.chdir is not supported'); },
        umask: function() { return 0; },
        nextTick: function(fn) { setTimeout(fn, 0); }
      };
    </script>
  </head>
  <body class="bg-volcanic-950 text-volcanic-100">
    <div id="root"></div>
    <script type="module" src="/${mainFileName}"></script>
  </body>
</html>`

  await writeFile(`${STATIC_DIR}/index.html`, html)

  // Copy public assets
  if (existsSync(resolve(APP_DIR, 'public'))) {
    await cp(resolve(APP_DIR, 'public'), `${STATIC_DIR}/public`, {
      recursive: true,
    })
  }

  console.log(`[Node] Frontend built to ${STATIC_DIR}/`)
}

async function buildCLI(): Promise<void> {
  console.log('[Node] Building CLI...')

  const result = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/cli.ts')],
    outdir: CLI_DIR,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    drop: ['debugger'],
  })

  if (!result.success) {
    console.error('[Node] CLI build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('CLI build failed')
  }

  reportBundleSizes(result, 'CLI')
  console.log(`[Node] CLI built to ${CLI_DIR}/`)
}

async function buildLander(): Promise<void> {
  console.log('[Node] Building lander page...')

  const landerEntry = resolve(APP_DIR, 'lander/main.tsx')
  if (!existsSync(landerEntry)) {
    console.log('[Node] No lander found, skipping')
    return
  }

  const result = await Bun.build({
    entrypoints: [landerEntry],
    outdir: LANDER_DIR,
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    packages: 'bundle',
    splitting: false,
    naming: '[name].[hash].[ext]',
    drop: ['debugger'],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  })

  if (!result.success) {
    console.error('[Node] Lander build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('Lander build failed')
  }

  reportBundleSizes(result, 'Lander')

  // Find the main entry file
  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  // Copy and update index.html
  const landerHtml = await readFile(
    resolve(APP_DIR, 'lander/index.html'),
    'utf-8',
  )
  const updatedHtml = landerHtml.replace('/main.tsx', `/${mainFileName}`)
  await writeFile(`${LANDER_DIR}/index.html`, updatedHtml)

  console.log(`[Node] Lander built to ${LANDER_DIR}/`)
}

async function createDeploymentBundle(): Promise<void> {
  console.log('[Node] Creating deployment bundle...')

  // Create deployment manifest
  const deploymentManifest = {
    name: 'node',
    version: '1.0.0',
    architecture: {
      frontend: {
        type: 'static',
        path: 'static',
        spa: true,
        fallback: 'index.html',
      },
      lander: {
        type: 'static',
        path: 'lander',
        spa: false,
      },
      cli: {
        type: 'bun',
        path: 'cli',
        entrypoint: 'cli.js',
      },
    },
    dws: {
      regions: ['global'],
      tee: { preferred: true, required: false },
    },
  }

  await writeFile(
    `${DIST_DIR}/deployment.json`,
    JSON.stringify(deploymentManifest, null, 2),
  )

  console.log('[Node] Deployment bundle created')
}

async function build(): Promise<void> {
  console.log('[Node] Building for deployment...\n')
  const startTime = Date.now()

  // Clean dist directory
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  // Create directories
  await mkdir(STATIC_DIR, { recursive: true })
  await mkdir(CLI_DIR, { recursive: true })
  await mkdir(LANDER_DIR, { recursive: true })

  // Build frontend, CLI, and lander
  await buildFrontend()
  await buildCLI()
  await buildLander()

  // Create deployment bundle
  await createDeploymentBundle()

  // Copy frontend to app/dist for Tauri
  const TAURI_DIST = resolve(APP_DIR, 'app/dist')
  if (existsSync(TAURI_DIST)) {
    await rm(TAURI_DIST, { recursive: true })
  }
  await cp(STATIC_DIR, TAURI_DIST, { recursive: true })
  console.log(`[Node] Tauri frontend copied to ${TAURI_DIST}/`)

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Node] Build complete in ${duration}ms`)
  console.log('[Node] Output:')
  console.log('   Static frontend: ./dist/static/')
  console.log('   Tauri frontend: ./app/dist/')
  console.log('   CLI bundle: ./dist/cli/')
  console.log('   Lander: ./dist/lander/')
  console.log('   Deployment manifest: ./dist/deployment.json')
  process.exit(0)
}

build().catch((error) => {
  console.error('[Node] Build failed:', error)
  process.exit(1)
})
