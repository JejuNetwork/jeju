import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getCurrentNetwork } from '@jejunetwork/config'
import type { BunPlugin } from 'bun'

const outdir = './dist'
mkdirSync(outdir, { recursive: true })

const network = getCurrentNetwork()

// Plugin to shim server-only modules and dedupe React + @noble/curves
const browserPlugin: BunPlugin = {
  name: 'browser-plugin',
  setup(build) {
    // Shim pino
    build.onResolve({ filter: /^pino(-pretty)?$/ }, () => ({
      path: resolve('./web/shims/pino.ts'),
    }))

    // Dedupe React
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

const result = await Bun.build({
  entrypoints: ['./web/main.tsx'],
  outdir: join(outdir, 'web'),
  target: 'browser',
  minify: process.env.NODE_ENV === 'production',
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
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'development',
    ),
    'process.browser': 'true',
    'globalThis.process': JSON.stringify({
      env: { NODE_ENV: process.env.NODE_ENV || 'development' },
      browser: true,
    }),
    process: JSON.stringify({
      env: { NODE_ENV: process.env.NODE_ENV || 'development' },
      browser: true,
    }),
    // Public environment variables (using PUBLIC_ prefix)
    'import.meta.env': JSON.stringify({
      PUBLIC_NETWORK: network,
      MODE: process.env.NODE_ENV || 'development',
      DEV: process.env.NODE_ENV !== 'production',
      PROD: process.env.NODE_ENV === 'production',
    }),
    'import.meta.env.PUBLIC_NETWORK': JSON.stringify(network),
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

// Find the CSS file
const cssEntry = result.outputs.find((o) => o.path.endsWith('.css'))
const cssFileName = cssEntry ? cssEntry.path.split('/').pop() : null

const indexHtml = readFileSync('./index.html', 'utf-8')
let updatedHtml = indexHtml.replace('/web/main.tsx', `/web/${mainFileName}`)

// Add CSS link if generated
if (cssFileName) {
  updatedHtml = updatedHtml.replace(
    '</head>',
    `  <link rel="stylesheet" href="/web/${cssFileName}">\n  </head>`,
  )
}

writeFileSync(join(outdir, 'index.html'), updatedHtml)

cpSync('./public', join(outdir), { recursive: true })

console.log('Build succeeded.')
console.log(`  Entry: ${mainFileName}`)
for (const output of result.outputs) {
  console.log(`  ${output.path}`)
}
