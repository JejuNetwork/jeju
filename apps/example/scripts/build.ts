#!/usr/bin/env bun

/**
 * Example Production Build Script
 *
 * Builds frontend and API for DWS deployment:
 * - Processes Tailwind CSS with CLI
 * - Bundles frontend TypeScript (React)
 * - Bundles API server
 * - Copies public assets
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { reportBundleSizes } from '@jejunetwork/shared'
import type { BunPlugin } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

// React paths for browser build
const reactPath = require.resolve('react')
const reactDomPath = require.resolve('react-dom')

// Plugin to resolve workspace packages for browser builds
const _browserPlugin: BunPlugin = {
  name: 'browser-resolve',
  setup(build) {
    // Resolve React properly
    build.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }))
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
      path: require.resolve('react/jsx-runtime'),
    }))
    build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
      path: require.resolve('react/jsx-dev-runtime'),
    }))
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: reactDomPath }))
    build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
      path: require.resolve('react-dom/client'),
    }))

    // Resolve workspace packages from source for proper tree-shaking
    build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/shared/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/types/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/sdk/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/config/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/react$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/auth/src/react/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth\/types$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/auth/src/types.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/auth/src/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/ui\/auth$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/ui/src/auth/index.ts'),
    }))
    build.onResolve({ filter: /^@jejunetwork\/ui$/ }, () => ({
      path: resolve(APP_DIR, '../../packages/ui/src/index.ts'),
    }))
  },
}

// Node.js built-ins that need to be external for browser builds
const _BROWSER_EXTERNALS = [
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
  'module',
  'worker_threads',
  'node:url',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:events',
  'node:module',
  'node:worker_threads',
  'elysia',
  '@elysiajs/*',
]

async function buildCSS(): Promise<string> {
  console.log('[Example] Building CSS with Tailwind...')

  const inputPath = resolve(APP_DIR, 'web/styles.css')
  if (!existsSync(inputPath)) {
    throw new Error(`CSS input file not found: ${inputPath}`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'example-css-'))
  const outputPath = join(tempDir, 'output.css')

  // Use bunx with explicit package version to avoid resolution issues
  const proc = Bun.spawn(
    [
      'bun',
      'x',
      'tailwindcss@3.4.17',
      '-i',
      inputPath,
      '-o',
      outputPath,
      '-c',
      resolve(APP_DIR, 'tailwind.config.ts'),
      '--content',
      resolve(APP_DIR, 'web/**/*.{ts,tsx,html}'),
      '--minify',
    ],
    { stdout: 'pipe', stderr: 'pipe', cwd: APP_DIR },
  )

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    await rm(tempDir, { recursive: true })
    throw new Error(`Tailwind CSS build failed: ${stderr}`)
  }

  const css = await readFile(outputPath, 'utf-8')
  await rm(tempDir, { recursive: true })

  console.log('[Example] CSS built successfully')
  return css
}

async function build() {
  console.log('[Example] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  await mkdir(join(outdir, 'api'), { recursive: true })
  await mkdir(join(outdir, 'web'), { recursive: true })

  // Build CSS first
  const cssContent = await buildCSS()
  await writeFile(join(outdir, 'web/styles.css'), cssContent)

  // Build API (full server for local dev)
  console.log('[Example] Building API...')
  const apiResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/index.ts')],
    outdir: join(outdir, 'api'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    drop: ['debugger'],
  })

  // Build minimal worker for DWS deployment (workaround for workerd compatibility)
  console.log('[Example] Building minimal worker for DWS...')
  const workerResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/minimal-worker.ts')],
    outdir: join(outdir, 'worker'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    naming: 'worker.js',
  })

  if (!workerResult.success) {
    console.error('[Example] Worker build failed:')
    for (const log of workerResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Example] Worker built successfully')

  if (!apiResult.success) {
    console.error('[Example] API build failed:')
    for (const log of apiResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  reportBundleSizes(apiResult, 'Example API')
  console.log('[Example] API built successfully')

  // Build frontend
  console.log('[Example] Building frontend...')

  // Browser plugin for shimming server-only packages
  const emptyStub = resolve(APP_DIR, 'web/stubs/empty.ts')
  const browserPlugin: BunPlugin = {
    name: 'browser-shim',
    setup(build) {
      // Shim pino and other server-only modules
      build.onResolve({ filter: /^pino(-pretty)?$/ }, () => ({
        path: emptyStub,
      }))
      build.onResolve({ filter: /^@jejunetwork\/contracts/ }, () => ({
        path: emptyStub,
      }))
      build.onResolve({ filter: /^@jejunetwork\/db/ }, () => ({
        path: emptyStub,
      }))
      build.onResolve({ filter: /^@jejunetwork\/kms/ }, () => ({
        path: emptyStub,
      }))
      build.onResolve({ filter: /^ioredis/ }, () => ({
        path: emptyStub,
      }))
      // Resolve workspace packages
      build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/shared/src/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/types/src/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/sdk/src/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/config/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/auth\/react$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/auth/src/react/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/auth\/types$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/auth/src/types.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/auth$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/auth/src/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/ui\/auth$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/ui/src/auth/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/ui$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/ui/src/index.ts'),
      }))
    },
  }

  const frontendResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/app.ts')],
    outdir: join(outdir, 'web'),
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    splitting: false,
    packages: 'bundle',
    naming: 'app.[hash].[ext]',
    drop: ['debugger'],
    external: [
      'bun:sqlite',
      'node:*',
      'elysia',
      '@elysiajs/*',
      'module',
      'worker_threads',
      'fs',
      'path',
      'crypto',
    ],
    plugins: [browserPlugin],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': 'true',
    },
  })

  if (!frontendResult.success) {
    console.error('[Example] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  reportBundleSizes(frontendResult, 'Example Frontend')
  console.log('[Example] Frontend built successfully')

  // Find the main entry file with hash
  const mainEntry = frontendResult.outputs.find((o) => o.kind === 'entry-point')
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'app.js'

  const indexHtml = await readFile(resolve(APP_DIR, 'web/index.html'), 'utf-8')
  const updatedHtml = indexHtml.replace('./app.ts', `/web/${mainFileName}`)

  await writeFile(join(outdir, 'index.html'), updatedHtml)

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Example] Build complete in ${duration}ms`)
  console.log('[Example] Output:')
  console.log('  dist/api/index.js    - API server')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/web/styles.css   - Compiled CSS')
  console.log('  dist/index.html       - Entry HTML')
  console.log('  dist/favicon.svg      - Favicon')
  process.exit(0)
}

build().catch((err) => {
  console.error('[Example] Build error:', err)
  process.exit(1)
})
