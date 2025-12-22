/**
 * Production build script for Bazaar
 *
 * Builds:
 * 1. Static frontend (dist/static/) - for IPFS/CDN deployment
 * 2. Worker bundle (dist/worker/) - for DWS serverless deployment
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'

const DIST_DIR = './dist'
const STATIC_DIR = `${DIST_DIR}/static`
const WORKER_DIR = `${DIST_DIR}/worker`

// External packages that should not be bundled for browser
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
  // Packages with Node.js-specific code
  '@jejunetwork/config',
  '@jejunetwork/shared',
  '@jejunetwork/sdk',
  '@jejunetwork/oauth3',
  '@jejunetwork/deployment',
  '@jejunetwork/contracts',
]

// External packages for worker build
const WORKER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'node:child_process',
  'node:fs',
  'node:path',
  'node:crypto',
]

async function buildFrontend(): Promise<void> {
  console.log('📦 Building static frontend...')

  const result = await Bun.build({
    entrypoints: ['./src/client.tsx'],
    outdir: STATIC_DIR,
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
    console.error('❌ Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('Frontend build failed')
  }

  // Find the main entry file
  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('client'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'client.js'

  // Copy CSS
  const css = await Bun.file('./src/globals.css').text()
  await Bun.write(`${STATIC_DIR}/globals.css`, css)

  // Create index.html
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>Bazaar - Agent Marketplace on the network</title>
  <meta name="description" content="The fun, light-hearted marketplace for tokens, NFTs, prediction markets, and more.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            'bazaar-primary': '#FF6B35',
            'bazaar-accent': '#00D9C0',
            'bazaar-purple': '#7C3AED',
          }
        }
      }
    }
  </script>
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('bazaar-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;
        if (shouldBeDark) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
  </script>
  <link rel="stylesheet" href="/globals.css">
</head>
<body class="font-sans antialiased">
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

async function buildWorker(): Promise<void> {
  console.log('📦 Building API worker...')

  const result = await Bun.build({
    entrypoints: ['./api/worker.ts'],
    outdir: WORKER_DIR,
    target: 'bun', // Use Bun target for workerd compatibility
    minify: true,
    sourcemap: 'external',
    external: WORKER_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  })

  if (!result.success) {
    console.error('❌ Worker build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error('Worker build failed')
  }

  // Create worker metadata
  const metadata = {
    name: 'bazaar-api',
    version: '2.0.0',
    entrypoint: 'worker.js',
    compatibilityDate: '2024-01-01',
    buildTime: new Date().toISOString(),
  }

  await Bun.write(
    `${WORKER_DIR}/metadata.json`,
    JSON.stringify(metadata, null, 2),
  )

  console.log(`✅ Worker built to ${WORKER_DIR}/`)
}

async function createDeploymentBundle(): Promise<void> {
  console.log('📦 Creating deployment bundle...')

  // Create deployment manifest
  const deploymentManifest = {
    name: 'bazaar',
    version: '2.0.0',
    architecture: {
      frontend: {
        type: 'static',
        path: 'static',
        spa: true,
        fallback: 'index.html',
      },
      worker: {
        type: 'elysia',
        path: 'worker',
        entrypoint: 'worker.js',
        routes: ['/api/*', '/health', '/.well-known/*'],
      },
    },
    dws: {
      regions: ['global'],
      tee: { preferred: true, required: false },
      database: {
        type: 'covenantsql',
        migrations: 'migrations/',
      },
    },
  }

  await Bun.write(
    `${DIST_DIR}/deployment.json`,
    JSON.stringify(deploymentManifest, null, 2),
  )

  console.log('✅ Deployment bundle created')
}

async function build(): Promise<void> {
  console.log('🔨 Building Bazaar for decentralized deployment...\n')

  // Clean dist directory
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }

  // Create directories
  await mkdir(STATIC_DIR, { recursive: true })
  await mkdir(WORKER_DIR, { recursive: true })

  // Build frontend and worker in parallel
  await Promise.all([buildFrontend(), buildWorker()])

  // Create deployment bundle
  await createDeploymentBundle()

  console.log('\n✅ Build complete!')
  console.log('   📁 Static frontend: ./dist/static/')
  console.log('   📁 API worker: ./dist/worker/')
  console.log('   📄 Deployment manifest: ./dist/deployment.json')
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
