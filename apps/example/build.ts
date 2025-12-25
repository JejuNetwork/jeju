import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const rootDir = import.meta.dir
const distDir = join(rootDir, 'dist')

console.log('Building example app...\n')

console.log('Cleaning dist directory...')
rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

console.log('Building server...')
const serverResult = await Bun.build({
  entrypoints: [join(rootDir, 'api/index.ts')],
  outdir: join(distDir, 'api'),
  target: 'bun',
  minify: true,
  external: ['@jejunetwork/*', 'viem', 'elysia', '@elysiajs/cors'],
})

if (!serverResult.success) {
  console.error('Server build failed:', serverResult.logs)
  process.exit(1)
}
console.log('   Server built successfully')

// Build frontend (web/)
console.log('Building frontend...')
const frontendResult = await Bun.build({
  entrypoints: [join(rootDir, 'web/app.ts')],
  outdir: join(distDir, 'web'),
  target: 'browser',
  minify: true,
  splitting: false,
  packages: 'bundle',
  naming: '[name].[hash].[ext]',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.browser': 'true',
    process: JSON.stringify({
      env: { NODE_ENV: 'production' },
      browser: true,
    }),
    'import.meta.env': JSON.stringify({
      VITE_NETWORK: 'localnet',
      MODE: 'production',
      DEV: false,
      PROD: true,
    }),
    'import.meta.env.VITE_NETWORK': JSON.stringify('localnet'),
  },
})

if (!frontendResult.success) {
  console.error('Frontend build failed:', frontendResult.logs)
  process.exit(1)
}
console.log('   Frontend built successfully')

// Find the main entry file with hash
const mainEntry = frontendResult.outputs.find(
  (o) => o.kind === 'entry-point' && o.path.includes('app'),
)
const mainFileName = mainEntry ? mainEntry.path.split('/').pop() : 'app.js'

// Copy and update index.html to reference compiled JS
console.log('Copying static files...')
const indexHtml = await Bun.file(join(rootDir, 'web/index.html')).text()
const updatedHtml = indexHtml.replace('./app.ts', `./${mainFileName}`)
await Bun.write(join(distDir, 'web/index.html'), updatedHtml)

// Copy manifest
cpSync(join(rootDir, 'jeju-manifest.json'), join(distDir, 'jeju-manifest.json'))

console.log('\nBuild complete.')
console.log(`   Output: ${distDir}`)
