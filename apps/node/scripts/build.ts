/**
 * Production build script for Node App
 *
 * Builds:
 * 1. Static frontend (dist/static/) - for IPFS/CDN deployment
 * 2. CLI bundle (dist/cli/) - for command line usage
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'

const DIST_DIR = './dist'
const STATIC_DIR = `${DIST_DIR}/static`
const CLI_DIR = `${DIST_DIR}/cli`

// External packages that should not be bundled for browser
// These packages have server-side code that will break browser builds
const BROWSER_EXTERNALS = [
  // Node.js builtins
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
  'node:os',
  'node:child_process',
  'node:readline',
  'node:util',
  // Tauri API - replaced by mock in browser
  '@tauri-apps/api/core',
  '@tauri-apps/plugin-fs',
  '@tauri-apps/plugin-os',
  '@tauri-apps/plugin-process',
  '@tauri-apps/plugin-shell',
  '@tauri-apps/plugin-store',
  // Server-only packages
  'webtorrent',
  'ws',
  'prom-client',
  'pino',
  'pino-pretty',
]

async function buildFrontend(): Promise<void> {
  console.log('📦 Building static frontend...')

  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
    outdir: STATIC_DIR,
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    external: BROWSER_EXTERNALS,
    plugins: [
      {
        name: 'browser-shims',
        setup(build) {
          // Mock Tauri invoke for browser builds (won't be used in production Tauri app)
          build.onResolve({ filter: /@tauri-apps\/api\/core/ }, () => ({
            path: 'tauri-mock',
            namespace: 'tauri-mock',
          }))
          build.onLoad({ filter: /.*/, namespace: 'tauri-mock' }, () => ({
            contents: `
              export async function invoke(cmd) {
                console.warn('Tauri invoke called in browser context:', cmd);
                throw new Error('Tauri commands not available in browser');
              }
            `,
            loader: 'js',
          }))
          // Mock pino for browser builds
          build.onResolve({ filter: /^pino$/ }, () => ({
            path: 'pino-mock',
            namespace: 'pino-mock',
          }))
          build.onResolve({ filter: /^pino-pretty$/ }, () => ({
            path: 'pino-mock',
            namespace: 'pino-mock',
          }))
          build.onLoad({ filter: /.*/, namespace: 'pino-mock' }, () => ({
            contents: `
              const noop = () => {};
              const noopLogger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => noopLogger };
              export default () => noopLogger;
              export const levels = { values: { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } };
            `,
            loader: 'js',
          }))
        },
      },
    ],
    packages: 'bundle',
    splitting: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': JSON.stringify(true),
      'process.env': JSON.stringify({ NODE_ENV: 'production' }),
      process: JSON.stringify({
        env: { NODE_ENV: 'production' },
        browser: true,
      }),
    },
    naming: {
      entry: '[name]-[hash].js',
      chunk: 'chunks/[name]-[hash].js',
      asset: 'assets/[name]-[hash].[ext]',
    },
  })

  if (!result.success) {
    console.error('❌ Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('Frontend build failed')
  }

  // Find the main entry file
  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  // Copy CSS
  const css = await Bun.file('./web/globals.css').text()
  await Bun.write(`${STATIC_DIR}/globals.css`, css)

  // Create index.html
  const html = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI2IiBmaWxsPSIjMTBCOTgxIi8+PHRleHQgeD0iMTYiIHk9IjIwIiBmb250LXNpemU9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9InN5c3RlbS11aSIgZm9udC13ZWlnaHQ9ImJvbGQiPko8L3RleHQ+PC9zdmc+" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Network Node</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              'volcanic': {
                50: '#f6f6f7',
                100: '#e2e2e5',
                200: '#c5c5cb',
                300: '#a0a0aa',
                400: '#7c7c88',
                500: '#61616d',
                600: '#4d4d57',
                700: '#3f3f47',
                800: '#35353b',
                900: '#2e2e33',
                950: '#1a1a1e',
              },
              'jeju': {
                50: '#ecfdf5',
                100: '#d1fae5',
                200: '#a7f3d0',
                300: '#6ee7b7',
                400: '#34d399',
                500: '#10b981',
                600: '#059669',
                700: '#047857',
                800: '#065f46',
                900: '#064e3b',
                950: '#022c22',
              },
            },
          },
        },
      };
    </script>
    <link rel="stylesheet" href="/globals.css" />
  </head>
  <body class="bg-volcanic-950 text-volcanic-100">
    <div id="root"></div>
    <script type="module" src="/${mainFileName}"></script>
  </body>
</html>`

  await Bun.write(`${STATIC_DIR}/index.html`, html)

  // Copy public assets
  if (existsSync('./public')) {
    await cp('./public', `${STATIC_DIR}/public`, { recursive: true })
  }

  console.log(`✅ Frontend built to ${STATIC_DIR}/`)
}

async function buildCLI(): Promise<void> {
  console.log('📦 Building CLI...')

  const result = await Bun.build({
    entrypoints: ['./api/cli.ts'],
    outdir: CLI_DIR,
    target: 'bun',
    minify: true,
    sourcemap: 'external',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  })

  if (!result.success) {
    console.error('❌ CLI build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('CLI build failed')
  }

  console.log(`✅ CLI built to ${CLI_DIR}/`)
}

async function createDeploymentBundle(): Promise<void> {
  console.log('📦 Creating deployment bundle...')

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

  await Bun.write(
    `${DIST_DIR}/deployment.json`,
    JSON.stringify(deploymentManifest, null, 2),
  )

  console.log('✅ Deployment bundle created')
}

async function build(): Promise<void> {
  console.log('🔨 Building Network Node for deployment...\n')

  // Clean dist directory
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  // Create directories
  await mkdir(STATIC_DIR, { recursive: true })
  await mkdir(CLI_DIR, { recursive: true })

  // Build frontend and CLI
  await buildFrontend()
  await buildCLI()

  // Create deployment bundle
  await createDeploymentBundle()

  console.log('\n✅ Build complete.')
  console.log('   📁 Static frontend: ./dist/static/')
  console.log('   📁 CLI bundle: ./dist/cli/')
  console.log('   📄 Deployment manifest: ./dist/deployment.json')
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
