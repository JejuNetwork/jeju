/** Factory Client Build */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import { buildCSS } from './build-css'

const outdir = 'dist/client'

if (existsSync(outdir)) {
  rmSync(outdir, { recursive: true })
}
mkdirSync(outdir, { recursive: true })

// Get network from config
const network = getCurrentNetwork()

console.log('Building Tailwind CSS...')
const css = await buildCSS()
const cssFileName = 'styles.css'
writeFileSync(join(outdir, cssFileName), css)
console.log(`✅ CSS built: ${(css.length / 1024).toFixed(2)} KB`)

// Build JS bundle
console.log('Building JavaScript bundle...')
const result = await Bun.build({
  entrypoints: ['./web/main.tsx'],
  outdir,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: 'linked',
  target: 'browser',
  naming: '[name].[hash].[ext]',
  external: [
    'node:*',
    'fs',
    'path',
    'os',
    'crypto',
    'stream',
    'http',
    'https',
    'zlib',
    'url',
    'util',
    'buffer',
    'events',
    'string_decoder',
    'querystring',
    'module',
    'perf_hooks',
    'vm',
    'v8',
    'child_process',
    'net',
    'tls',
    'dns',
    'async_hooks',
    'worker_threads',
    'diagnostics_channel',
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'production',
    ),
    'process.env.PUBLIC_NETWORK': JSON.stringify(network),
    'import.meta.env': JSON.stringify({
      VITE_NETWORK: network,
      VITE_WALLETCONNECT_PROJECT_ID:
        process.env.VITE_WALLETCONNECT_PROJECT_ID || '',
      MODE: process.env.NODE_ENV || 'production',
      DEV: process.env.NODE_ENV !== 'production',
      PROD: process.env.NODE_ENV === 'production',
    }),
    'import.meta.env.VITE_WALLETCONNECT_PROJECT_ID': JSON.stringify(
      process.env.VITE_WALLETCONNECT_PROJECT_ID || '',
    ),
  },
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Find the main entry file with hash
const mainEntry = result.outputs.find(
  (o) => o.kind === 'entry-point' && o.path.includes('main'),
)
const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

// Find any extracted CSS from the bundle (e.g., from RainbowKit)
const bundleCssEntry = result.outputs.find(
  (o) => o.path.endsWith('.css') && o.path.includes('main'),
)
const bundleCssFileName = bundleCssEntry
  ? bundleCssEntry.path.split('/').pop()
  : null

// Build CSS links - Tailwind first, then any bundle-extracted CSS
const cssLinks = [`<link rel="stylesheet" href="/${cssFileName}" />`]
if (bundleCssFileName) {
  cssLinks.push(`<link rel="stylesheet" href="/${bundleCssFileName}" />`)
}

// Generate production HTML without Tailwind CDN
const productionHtml = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Factory | Jeju Developer Hub</title>
    <meta name="description" content="Bounties, jobs, git, packages, containers, models - developer coordination powered by Jeju" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
    ${cssLinks.join('\n    ')}
  </head>
  <body class="min-h-screen bg-factory-950 text-factory-100 antialiased">
    <div id="root"></div>
    <script type="module" src="/${mainFileName}"></script>
  </body>
</html>`

writeFileSync(join(outdir, 'index.html'), productionHtml)

console.log('✅ Client build complete')
console.log(`📦 Output: ${outdir}`)
console.log(`📄 Files:`)
console.log(`   ${join(outdir, 'index.html')}`)
console.log(`   ${join(outdir, cssFileName)}`)
for (const output of result.outputs) {
  console.log(`   ${output.path}`)
}
