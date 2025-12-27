#!/usr/bin/env bun
/**
 * Patches synpress-cache for zod 4.x compatibility
 *
 * The synpress-cache package uses zod 3.x syntax (z.function().returns())
 * which doesn't work with zod 4.x. This script patches the compiled JS files.
 *
 * Run after bun install: bun scripts/patch-synpress.ts
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUN_CACHE = 'node_modules/.bun'
const DIRECT_SYNPRESS = 'node_modules/@synthetixio/synpress-cache'

function patchFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  let content = readFileSync(filePath, 'utf-8')
  const originalContent = content

  // Replace zod 3.x function syntax with zod 4.x compatible version
  content = content.replace(
    /z\.function\(\)\.returns\(z\.promise\(z\.void\(\)\)\)/g,
    'z.function()',
  )

  if (content !== originalContent) {
    writeFileSync(filePath, content)
    return true
  }
  return false
}

async function patchSynpressCache() {
  let patchedCount = 0

  // First try direct node_modules path
  if (existsSync(DIRECT_SYNPRESS)) {
    const distPath = join(DIRECT_SYNPRESS, 'dist')

    if (patchFile(join(distPath, 'index.js'))) patchedCount++
    if (patchFile(join(distPath, 'cli/index.js'))) patchedCount++

    const srcPath = join(DIRECT_SYNPRESS, 'src/utils/importWalletSetupFile.ts')
    if (existsSync(srcPath)) {
      let content = readFileSync(srcPath, 'utf-8')
      const originalContent = content
      content = content.replace(
        /z\.function\(\)\.returns\(z\.promise\(z\.void\(\)\)\)/g,
        'z.function() as z.ZodType<() => Promise<void>>',
      )
      if (content !== originalContent) {
        writeFileSync(srcPath, content)
        patchedCount++
      }
    }
  }

  // Also check bun cache
  if (existsSync(BUN_CACHE)) {
    const entries = readdirSync(BUN_CACHE)
    const synpressCacheDirs = entries.filter((e) =>
      e.startsWith('@synthetixio+synpress-cache@'),
    )

    for (const dir of synpressCacheDirs) {
      const distPath = join(
        BUN_CACHE,
        dir,
        'node_modules/@synthetixio/synpress-cache/dist',
      )

      if (patchFile(join(distPath, 'index.js'))) patchedCount++
      if (patchFile(join(distPath, 'cli/index.js'))) patchedCount++

      const srcPath = join(
        BUN_CACHE,
        dir,
        'node_modules/@synthetixio/synpress-cache/src/utils/importWalletSetupFile.ts',
      )
      if (existsSync(srcPath)) {
        let content = readFileSync(srcPath, 'utf-8')
        const originalContent = content
        content = content.replace(
          /z\.function\(\)\.returns\(z\.promise\(z\.void\(\)\)\)/g,
          'z.function() as z.ZodType<() => Promise<void>>',
        )
        if (content !== originalContent) {
          writeFileSync(srcPath, content)
          patchedCount++
        }
      }
    }
  }

  if (patchedCount > 0) {
    console.log(
      `Patched ${patchedCount} synpress-cache files for zod 4.x compatibility`,
    )
  } else {
    console.log('No synpress-cache files needed patching (already patched or not found)')
  }
}

patchSynpressCache().catch(console.error)
