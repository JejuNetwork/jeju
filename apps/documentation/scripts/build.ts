#!/usr/bin/env bun
/**
 * Documentation Production Build Script
 *
 * Builds the documentation site using Vocs.
 */

import { resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')

async function build() {
  console.log('[Documentation] Building for production...')
  const startTime = Date.now()

  const proc = Bun.spawn(['bunx', 'vocs', 'build'], {
    cwd: APP_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited

  if (proc.exitCode !== 0) {
    console.error('[Documentation] Build failed')
    process.exit(1)
  }

  const duration = Date.now() - startTime
  console.log('')
  console.log(`[Documentation] Build complete in ${duration}ms`)
  console.log('[Documentation] Output: dist/')
}

build().catch((err) => {
  console.error('[Documentation] Build error:', err)
  process.exit(1)
})
