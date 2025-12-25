#!/usr/bin/env bun
/**
 * Web Build Script
 *
 * Builds the wallet web app for production deployment.
 */

import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const DIST_DIR = resolve(ROOT, 'dist')
const isProduction = process.env.NODE_ENV === 'production'

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
  'node:os',
  'node:child_process',
  'node:readline',
  'node:util',
]

// Browser plugin to shim server-only packages and dedupe crypto libraries
const browserPlugin = {
  name: 'browser-shims',
  setup(
    build: Parameters<
      Parameters<typeof Bun.build>[0]['plugins'][0]['setup']
    >[0],
  ) {
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

    // Dedupe @noble/curves to prevent duplicate exports
    build.onResolve({ filter: /^@noble\/curves\/secp256k1$/ }, () => ({
      path: require.resolve('@noble/curves/secp256k1'),
    }))
    build.onResolve({ filter: /^@noble\/curves\/p256$/ }, () => ({
      path: require.resolve('@noble/curves/p256'),
    }))
    build.onResolve({ filter: /^@noble\/curves$/ }, () => ({
      path: require.resolve('@noble/curves'),
    }))
    build.onResolve({ filter: /^@noble\/hashes/ }, (args) => ({
      path: require.resolve(args.path),
    }))
  },
}

async function build(): Promise<void> {
  console.log('Building wallet web app...')

  // Clean dist directory
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true })
  }
  await mkdir(DIST_DIR, { recursive: true })

  // Build the main app bundle
  const result = await Bun.build({
    entrypoints: [resolve(ROOT, 'web/main.tsx')],
    outdir: DIST_DIR,
    minify: isProduction,
    sourcemap: isProduction ? 'external' : 'linked',
    target: 'browser',
    splitting: false,
    packages: 'bundle',
    external: BROWSER_EXTERNALS,
    plugins: [browserPlugin],
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
      'process.browser': JSON.stringify(true),
      'process.env': JSON.stringify({
        NODE_ENV: isProduction ? 'production' : 'development',
      }),
      process: JSON.stringify({
        env: { NODE_ENV: isProduction ? 'production' : 'development' },
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
    console.error('Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Find the main entry file
  const mainEntry = result.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  // Read and copy CSS
  const cssPath = resolve(ROOT, 'web/globals.css')
  if (existsSync(cssPath)) {
    const css = await Bun.file(cssPath).text()
    await Bun.write(resolve(DIST_DIR, 'globals.css'), css)
  }

  // Read tailwind config for inline styles
  const tailwindConfig = (await import(resolve(ROOT, 'tailwind.config.ts')))
    .default

  // Create index.html with Tailwind CDN and inline config
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
    tailwind.config = ${JSON.stringify({
      darkMode: tailwindConfig.darkMode,
      theme: {
        extend: tailwindConfig.theme?.extend,
      },
    })}
  </script>
  <link rel="stylesheet" href="/globals.css">
</head>
<body class="bg-surface text-white antialiased">
  <div id="root"></div>
  <script type="module" src="/${mainFileName}"></script>
</body>
</html>`

  await Bun.write(resolve(DIST_DIR, 'index.html'), html)

  console.log('Build succeeded:')
  for (const output of result.outputs) {
    const size =
      output.size > 1024 * 1024
        ? `${(output.size / (1024 * 1024)).toFixed(2)} MB`
        : `${(output.size / 1024).toFixed(2)} KB`
    console.log(`  ${output.path.replace(`${ROOT}/`, '')} - ${size}`)
  }
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
