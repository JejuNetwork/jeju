import { $ } from 'bun'

await $`rm -rf dist`

// Generate TypeScript declarations
await $`tsc`

// Bundle JavaScript with Bun
await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',
  format: 'esm',
  splitting: false,
  external: [
    'react',
    'react/jsx-runtime',
    'wagmi',
    'viem',
    'zod',
    '@jejunetwork/sdk',
    '@jejunetwork/types',
  ],
})

console.log('Build complete')
