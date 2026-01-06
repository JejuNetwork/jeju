#!/usr/bin/env bun
/**
 * Wallet Production Build Script
 *
 * Builds the web lander for deployment.
 * The full app is built separately via Tauri/Capacitor.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  BROWSER_EXTERNALS,
  createBrowserPlugin,
  reportBundleSizes,
} from '@jejunetwork/shared'

const APP_DIR = resolve(import.meta.dir, '..')
const LANDER_DIR = resolve(APP_DIR, 'lander')
const DIST_DIR = resolve(APP_DIR, 'dist')
const MINIAPP_DIR = resolve(DIST_DIR, 'miniapp')

/**
 * Build Tailwind CSS with tree shaking - only includes used classes
 */
async function buildCSS(contentGlobs: string[]): Promise<string> {
  const inputPath = resolve(APP_DIR, 'web/globals.css')
  if (!existsSync(inputPath)) {
    throw new Error(`CSS input file not found: ${inputPath}`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'wallet-css-'))
  const outputPath = join(tempDir, 'output.css')

  const proc = Bun.spawn(
    [
      'bunx',
      'tailwindcss',
      '-i',
      inputPath,
      '-o',
      outputPath,
      '-c',
      resolve(APP_DIR, 'tailwind.config.ts'),
      '--content',
      contentGlobs.join(','),
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
  return css
}

async function build() {
  console.log('[Wallet] Building web lander for production...')
  const startTime = Date.now()

  // Clean dist
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }
  await mkdir(DIST_DIR, { recursive: true })

  // Build CSS for lander (tree-shaken to only lander classes)
  console.log('[Wallet] Building lander CSS...')
  const landerCss = await buildCSS([resolve(LANDER_DIR, '**/*.{ts,tsx}')])
  await writeFile(resolve(DIST_DIR, 'styles.css'), landerCss)

  // Build the lander with Bun - optimized for smallest bundle
  console.log('[Wallet] Building lander bundle...')
  const result = await Bun.build({
    entrypoints: [resolve(LANDER_DIR, 'main.tsx')],
    outdir: DIST_DIR,
    target: 'browser',
    minify: true,
    splitting: false,
    sourcemap: 'external',
    packages: 'bundle',
    external: [...BROWSER_EXTERNALS],
    plugins: [createBrowserPlugin({ appDir: APP_DIR })],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': 'true',
    },
    naming: {
      entry: 'main-[hash].js',
    },
    drop: ['debugger'],
  })

  if (!result.success) {
    console.error('[Wallet] Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  reportBundleSizes(result, 'Lander')

  // Get the output filename
  const mainOutput = result.outputs.find((o) => o.kind === 'entry-point')
  const mainFileName = mainOutput ? mainOutput.path.split('/').pop() : 'main.js'

  // Create HTML with compiled CSS (no Tailwind CDN)
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
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bg-surface text-white antialiased min-h-screen">
    <div id="root"></div>
    <script type="module" src="/${mainFileName}"></script>
  </body>
</html>`

  await writeFile(resolve(DIST_DIR, 'index.html'), html)

  // Build miniapp CSS (separate tree-shaking for miniapp)
  console.log('[Wallet] Building miniapp CSS...')
  const miniappCss = await buildCSS([resolve(LANDER_DIR, 'miniapp.tsx')])
  await writeFile(resolve(MINIAPP_DIR, 'styles.css'), miniappCss)

  // Build miniapp
  console.log('[Wallet] Building miniapp bundle...')
  const miniappResult = await Bun.build({
    entrypoints: [resolve(LANDER_DIR, 'miniapp.tsx')],
    outdir: MINIAPP_DIR,
    target: 'browser',
    minify: true,
    splitting: false,
    sourcemap: 'external',
    packages: 'bundle',
    external: [...BROWSER_EXTERNALS],
    plugins: [createBrowserPlugin({ appDir: APP_DIR })],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': 'true',
    },
    naming: {
      entry: 'miniapp-[hash].js',
    },
    drop: ['debugger'],
  })

  if (!miniappResult.success) {
    console.error('[Wallet] Miniapp build failed:')
    for (const log of miniappResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  reportBundleSizes(miniappResult, 'Miniapp')

  const miniappOutput = miniappResult.outputs.find(
    (o) => o.kind === 'entry-point',
  )
  const miniappFileName = miniappOutput
    ? miniappOutput.path.split('/').pop()
    : 'miniapp.js'

  // Create miniapp HTML with compiled CSS
  const miniappHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <meta name="description" content="Network Wallet - Cross-chain wallet miniapp" />
    <title>Network Wallet</title>
    
    <!-- Telegram WebApp SDK -->
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    
    <!-- Farcaster Frame Meta -->
    <meta property="fc:frame" content="vNext">
    <meta property="fc:frame:image" content="https://wallet.jejunetwork.org/frame-image.png">
    <meta property="fc:frame:button:1" content="Open Wallet">
    <meta property="fc:frame:button:1:action" content="link">
    <meta property="fc:frame:button:1:target" content="https://wallet.jejunetwork.org/miniapp">
    
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI2IiBmaWxsPSIjMTBCOTgxIi8+PHRleHQgeD0iMTYiIHk9IjIwIiBmb250LXNpemU9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9InN5c3RlbS11aSIgZm9udC13ZWlnaHQ9ImJvbGQiPko8L3RleHQ+PC9zdmc+" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bg-surface text-white antialiased min-h-screen">
    <div id="root"></div>
    <script type="module" src="/${miniappFileName}"></script>
  </body>
</html>`

  await writeFile(resolve(MINIAPP_DIR, 'index.html'), miniappHtml)

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Wallet] Build complete in ${duration}ms`)
  console.log('[Wallet] Output:')
  console.log(`  dist/index.html           - Landing page`)
  console.log(`  dist/styles.css           - Compiled CSS (tree-shaken)`)
  console.log(`  dist/${mainFileName}      - Lander bundle`)
  console.log(`  dist/miniapp/index.html   - Miniapp page`)
  console.log(`  dist/miniapp/styles.css   - Miniapp CSS (tree-shaken)`)
  console.log(`  dist/miniapp/${miniappFileName} - Miniapp bundle`)
  process.exit(0)
}

build().catch((err) => {
  console.error('[Wallet] Build error:', err)
  process.exit(1)
})
