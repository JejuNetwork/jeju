/**
 * Build script for the Factory client
 *
 * Handles browser bundling with proper externalization of Node.js builtins
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'

const outdir = 'dist/client'

// Clean output directory
if (existsSync(outdir)) {
  rmSync(outdir, { recursive: true })
}
mkdirSync(outdir, { recursive: true })

// Build the client
const result = await Bun.build({
  entrypoints: ['./src/client/index.html'],
  outdir,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: 'linked',
  target: 'browser',
  // Mark Node.js builtins as external - they won't be used in browser
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
    'process.env.PUBLIC_NETWORK': JSON.stringify(
      process.env.PUBLIC_NETWORK || 'localnet',
    ),
    'process.env.PUBLIC_WALLETCONNECT_ID': JSON.stringify(
      process.env.PUBLIC_WALLETCONNECT_ID || '',
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

console.log('✅ Client build complete')
console.log(`📦 Output: ${outdir}`)
console.log(`📄 Files:`)
for (const output of result.outputs) {
  console.log(`   ${output.path}`)
}
