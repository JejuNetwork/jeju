#!/usr/bin/env bun
/**
 * Gateway Production Build Script
 *
 * Builds frontend for production deployment with hashed filenames.
 */

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import type { BunPlugin } from 'bun'

const APP_DIR = resolve(import.meta.dir, '..')
const outdir = resolve(APP_DIR, 'dist')

async function build() {
  console.log('[Gateway] Building for production...')
  const startTime = Date.now()

  // Clean dist directory
  await rm(outdir, { recursive: true, force: true })
  mkdirSync(join(outdir, 'web'), { recursive: true })
  mkdirSync(join(outdir, 'api'), { recursive: true })

  const network = getCurrentNetwork()

  // Browser plugin for shimming and deduping
  const browserPlugin: BunPlugin = {
    name: 'browser-plugin',
    setup(build) {
      build.onResolve({ filter: /^node:crypto$/ }, () => ({
        path: resolve(APP_DIR, 'web/shims/node-crypto.ts'),
      }))
      build.onResolve({ filter: /^pino(-pretty)?$/ }, () => ({
        path: resolve(APP_DIR, 'web/shims/pino.ts'),
      }))
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
      build.onResolve({ filter: /^@jejunetwork\/shared$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/shared/src/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/types$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/types/src/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/sdk$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/sdk/src/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/ui$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/ui/src/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/config$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/config/index.ts'),
      }))
      build.onResolve({ filter: /^@jejunetwork\/token$/ }, () => ({
        path: resolve(APP_DIR, '../../packages/token/src/index.ts'),
      }))
    },
  }

  // Build frontend
  console.log('[Gateway] Building frontend...')
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
        env: { NODE_ENV: 'production', JEJU_NETWORK: network },
        browser: true,
      }),
      process: JSON.stringify({
        env: { NODE_ENV: 'production', JEJU_NETWORK: network },
        browser: true,
      }),
      'import.meta.env.VITE_NETWORK': JSON.stringify(network),
      'import.meta.env': JSON.stringify({
        VITE_NETWORK: network,
        PUBLIC_NETWORK: network,
        MODE: 'production',
        DEV: false,
        PROD: true,
      }),
      'import.meta.env.PUBLIC_NETWORK': JSON.stringify(network),
    },
  })

  if (!frontendResult.success) {
    console.error('[Gateway] Frontend build failed:')
    for (const log of frontendResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }
  console.log('[Gateway] Frontend built successfully')

  // Build API servers
  console.log('[Gateway] Building API servers...')
  const apiFiles = [
    'server.ts',
    'rpc-server.ts',
    'x402-server.ts',
    'a2a-server.ts',
  ]
  for (const apiFile of apiFiles) {
    const result = await Bun.build({
      entrypoints: [resolve(APP_DIR, `api/${apiFile}`)],
      outdir: join(outdir, 'api'),
      target: 'bun',
      minify: true,
      sourcemap: 'external',
    })
    if (!result.success) {
      console.warn(`[Gateway] Warning: ${apiFile} build failed`)
    }
  }
  console.log('[Gateway] API servers built')

  // Find the main entry file with hash
  const mainEntry = frontendResult.outputs.find(
    (o) => o.kind === 'entry-point' && o.path.includes('main'),
  )
  const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'main.js'

  const cssEntry = frontendResult.outputs.find((o) => o.path.endsWith('.css'))
  const cssFileName = cssEntry ? cssEntry.path.split('/').pop() : null

  const indexHtml = readFileSync(resolve(APP_DIR, 'index.html'), 'utf-8')
  let updatedHtml = indexHtml.replace('/web/main.tsx', `/web/${mainFileName}`)

  if (cssFileName) {
    updatedHtml = updatedHtml.replace(
      '</head>',
      `  <link rel="stylesheet" href="/web/${cssFileName}">\n  </head>`,
    )
  }

  writeFileSync(join(outdir, 'index.html'), updatedHtml)

  cpSync(resolve(APP_DIR, 'public'), outdir, { recursive: true })

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Gateway] Build complete in ${duration}ms`)
  console.log('[Gateway] Output:')
  console.log(`  dist/web/${mainFileName} - Frontend bundle`)
  console.log('  dist/api/                - API servers')
  console.log('  dist/index.html          - Entry HTML')
}

build().catch((err) => {
  console.error('[Gateway] Build error:', err)
  process.exit(1)
})
