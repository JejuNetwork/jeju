import { $ } from 'bun'

await $`rm -rf dist`

// Generate TypeScript declarations
await $`tsc --skipLibCheck || true`

// Bundle JavaScript with Bun
await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',
  format: 'esm',
  splitting: false,
  external: [
    'viem',
    'permissionless',
    '@noble/curves',
    '@noble/hashes',
    'zod',
    '@jejunetwork/types',
    '@jejunetwork/shared',
    '@jejunetwork/config',
    '@jejunetwork/token',
  ],
})

console.log('Build complete')
