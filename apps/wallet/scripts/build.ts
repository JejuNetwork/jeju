#!/usr/bin/env bun
/**
 * Wallet Production Build Script
 *
 * Builds the web lander for deployment.
 * The full app is built separately via Tauri/Capacitor.
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')
const LANDER_DIR = resolve(APP_DIR, 'lander')
const DIST_DIR = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[Wallet] Building web lander for production...')
  const startTime = Date.now()

  // Clean dist
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }
  await mkdir(DIST_DIR, { recursive: true })

  // Build the lander with Bun
  const result = await Bun.build({
    entrypoints: [resolve(LANDER_DIR, 'main.tsx')],
    outdir: DIST_DIR,
    target: 'browser',
    minify: true,
    splitting: false,
    sourcemap: 'external',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    external: [],
    naming: {
      entry: 'main.[hash].js',
    },
  })

  if (!result.success) {
    console.error('[Wallet] Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Get the output filename
  const mainOutput = result.outputs.find((o) => o.kind === 'entry-point')
  const mainFileName = mainOutput ? mainOutput.path.split('/').pop() : 'main.js'

  // Create HTML with the correct script reference
  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI2IiBmaWxsPSIjMTBCOTgxIi8+PHRleHQgeD0iMTYiIHk9IjIwIiBmb250LXNpemU9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9InN5c3RlbS11aSIgZm9udC13ZWlnaHQ9ImJvbGQiPko8L3RleHQ+PC9zdmc+" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Network Wallet - Seamless cross-chain wallet with no bridging, no chain switching" />
    <title>Network Wallet</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              surface: { DEFAULT: '#0f0f0f', elevated: '#1a1a1a', hover: '#242424', border: '#2e2e2e' },
              jeju: { 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d' },
            },
            fontFamily: { sans: ['Space Grotesk', 'system-ui', 'sans-serif'] },
          },
        },
      }
    </script>
  </head>
  <body class="bg-surface text-white antialiased min-h-screen">
    <div id="root"></div>
    <script type="module" src="/${mainFileName}"></script>
  </body>
</html>`

  await Bun.write(resolve(DIST_DIR, 'index.html'), html)

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Wallet] Build complete in ${duration}ms`)
  console.log('[Wallet] Output:')
  console.log(`  dist/index.html    - Landing page`)
  console.log(`  dist/${mainFileName} - JavaScript bundle`)
}

build().catch((err) => {
  console.error('[Wallet] Build error:', err)
  process.exit(1)
})
