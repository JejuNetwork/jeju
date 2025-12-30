#!/usr/bin/env bun
/**
 * Autocrat Production Build Script
 *
 * Builds both API and frontend for production deployment:
 * - API: Bundled for Bun runtime
 * - Frontend: Minified browser bundle with hashed filenames
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import type { BunPlugin } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[Autocrat] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  mkdirSync(join(outdir, 'api'), { recursive: true })
  mkdirSync(join(outdir, 'web'), { recursive: true })

  const network = getCurrentNetwork()

  // Browser plugin for React deduplication
  const browserPlugin: BunPlugin = {
    name: 'browser-plugin',
    setup(build) {
      const reactPath = require.resolve('react')
      const reactDomPath = require.resolve('react-dom')
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

  // Build API
  console.log('[Autocrat] Building API...')
  const apiResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'api/server.ts')],
    outdir: join(outdir, 'api'),
    target: 'bun',
    minify: true,
    sourcemap: 'external',
  })

  if (!apiResult.success) {
    console.error('[Autocrat] API build failed:')
    for (const log of apiResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Autocrat] API built successfully')

  // Build frontend
  console.log('[Autocrat] Building frontend...')
  const frontendResult = await Bun.build({
    entrypoints: [resolve(APP_DIR, 'web/main.tsx')],
    outdir: join(outdir, 'web'),
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    splitting: false,
    packages: 'bundle',
    plugins: [browserPlugin],
    naming: '[name].[hash].[ext]',
    external: [
      '@google-cloud/*',
      '@grpc/*',
      'google-gax',
      'google-auth-library',
      'native-dns',
      'native-dns-cache',
      '@farcaster/hub-nodejs',
      '@opentelemetry/*',
      'bun:sqlite',
      'node:*',
      'typeorm',
      '@jejunetwork/db',
      '@jejunetwork/dws',
      '@jejunetwork/kms',
      '@jejunetwork/deployment',
      '@jejunetwork/training',
      'elysia',
      '@elysiajs/*',
      'ioredis',
      'croner',
      'opossum',
      'ws',
      'generic-pool',
      'c-kzg',
      'kzg-wasm',
      '@aws-sdk/*',
      '@huggingface/*',
      '@solana/*',
      'borsh',
      'tweetnacl',
      'p-retry',
      'yaml',
      'prom-client',
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.browser': 'true',
      'globalThis.process': JSON.stringify({
        env: { NODE_ENV: 'production' },
        browser: true,
      }),
      process: JSON.stringify({
        env: { NODE_ENV: 'production' },
        browser: true,
      }),
      'import.meta.env': JSON.stringify({
        PUBLIC_NETWORK: network,
        MODE: 'production',
        DEV: false,
        PROD: true,
      }),
      'import.meta.env.PUBLIC_NETWORK': JSON.stringify(network),
    },
  })

  if (!frontendResult.success) {
    console.error('[Autocrat] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Autocrat] Frontend built successfully')

  // Find the main entry file with hash
  const mainEntry = frontendResult.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  // Find the CSS file
  const cssEntry = frontendResult.outputs.find((o) => o.path.endsWith('.css'))
  const cssFileName = cssEntry ? cssEntry.path.split('/').pop() : null

  // Update index.html
  const indexHtml = readFileSync(resolve(APP_DIR, 'index.html'), 'utf-8')
  let updatedHtml = indexHtml.replace('./web/main.tsx', `/web/${mainFileName}`)

  if (cssFileName) {
    updatedHtml = updatedHtml.replace(
      '</head>',
      `  <link rel="stylesheet" href="/web/${cssFileName}">\n  </head>`,
    )
  }

  writeFileSync(join(outdir, 'index.html'), updatedHtml)

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Autocrat] Build complete in ${duration}ms`)
  console.log('[Autocrat] Output:')
  console.log('  dist/api/server.js   - API server')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/index.html      - Entry HTML')
}

build().catch((err) => {
  console.error('[Autocrat] Build error:', err)
  process.exit(1)
})
