import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const rootDir = import.meta.dir
const distDir = join(rootDir, 'dist')

console.log('🏗️  Building Experimental Decentralized Todo App...\n')

// Clean dist
console.log('Cleaning dist directory...')
rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

// Build server
console.log('Building server...')
const serverResult = await Bun.build({
  entrypoints: [join(rootDir, 'src/server/index.ts')],
  outdir: join(distDir, 'server'),
  target: 'bun',
  minify: true,
  external: ['@jejunetwork/*', 'viem', 'elysia', '@elysiajs/cors'],
})

if (!serverResult.success) {
  console.error('Server build failed:', serverResult.logs)
  process.exit(1)
}
console.log('   Server built successfully')

// Build frontend
console.log('Building frontend...')
const frontendResult = await Bun.build({
  entrypoints: [join(rootDir, 'src/frontend/app.ts')],
  outdir: join(distDir, 'frontend'),
  target: 'browser',
  minify: true,
})

if (!frontendResult.success) {
  console.error('Frontend build failed:', frontendResult.logs)
  process.exit(1)
}
console.log('   Frontend built successfully')

// Copy static files
console.log('Copying static files...')
cpSync(
  join(rootDir, 'src/frontend/index.html'),
  join(distDir, 'frontend/index.html'),
)

// Copy manifest
cpSync(join(rootDir, 'jeju-manifest.json'), join(distDir, 'jeju-manifest.json'))

console.log('\n✅ Build complete!')
console.log(`   Output: ${distDir}`)
