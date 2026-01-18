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
const DIRECT_METAMASK = 'node_modules/@synthetixio/synpress-metamask'

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

function patchMetaMaskFixtures(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  let content = readFileSync(filePath, 'utf-8')
  const originalContent = content

  content = content.replace(
    'const browserArgs = [`--disable-extensions-except=${metamaskPath}`]',
    'const browserArgs = [`--disable-extensions-except=${metamaskPath}`, `--load-extension=${metamaskPath}`, \'--disable-features=ExtensionsManifestV2Disabled\']',
  )
  content = content.replace(
    'const browserArgs = [`--disable-extensions-except=${metamaskPath}`, `--load-extension=${metamaskPath}`]',
    'const browserArgs = [`--disable-extensions-except=${metamaskPath}`, `--load-extension=${metamaskPath}`, \'--disable-features=ExtensionsManifestV2Disabled\']',
  )
  content = content.replace(
    'await unlockForFixture(_metamaskPage, walletPassword)',
    'const passwordInputs = _metamaskPage.locator(\'input[type=\"password\"]\')\n      if ((await passwordInputs.count()) > 0) {\n        await unlockForFixture(_metamaskPage, walletPassword)\n      }',
  )

  if (content !== originalContent) {
    writeFileSync(filePath, content)
    return true
  }
  return false
}

function patchMetaMaskVersion(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  let content = readFileSync(filePath, 'utf-8')
  const originalContent = content

  content = content.replace(
    "export const DEFAULT_METAMASK_VERSION = '11.9.1'",
    "export const DEFAULT_METAMASK_VERSION = '13.13.2'",
  )

  if (content !== originalContent) {
    writeFileSync(filePath, content)
    return true
  }
  return false
}

function patchGetExtensionId(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  let content = readFileSync(filePath, 'utf-8')
  const originalContent = content

  if (!content.includes('findExtensionIdFromContext')) {
    content = content.replace(
      'const Extensions = z.array(Extension)\n',
      `const Extensions = z.array(Extension)\n\nfunction extractExtensionIdFromUrl(url: string): string | null {\n  const prefix = 'chrome-extension://'\n  if (!url.startsWith(prefix)) {\n    return null\n  }\n  const rest = url.slice(prefix.length)\n  const slashIndex = rest.indexOf('/')\n  if (slashIndex === -1) {\n    return rest.length > 0 ? rest : null\n  }\n  const extensionId = rest.slice(0, slashIndex)\n  return extensionId.length > 0 ? extensionId : null\n}\n\nfunction findExtensionIdFromContext(context: BrowserContext): string | null {\n  const pages = context.pages()\n  for (const page of pages) {\n    const url = page.url()\n    const extensionId = extractExtensionIdFromUrl(url)\n    if (extensionId) {\n      return extensionId\n    }\n  }\n\n  const backgroundPages = context.backgroundPages()\n  for (const page of backgroundPages) {\n    const url = page.url()\n    const extensionId = extractExtensionIdFromUrl(url)\n    if (extensionId) {\n      return extensionId\n    }\n  }\n\n  const workers = context.serviceWorkers()\n  for (const worker of workers) {\n    const url = worker.url()\n    const extensionId = extractExtensionIdFromUrl(url)\n    if (extensionId) {\n      return extensionId\n    }\n  }\n\n  return null\n}\n\n`,
    )
  }

  content = content.replace(
    '  if (!targetExtension) {\n    throw new Error(\n',
    `  if (!targetExtension) {\n    const envExtensionId = process.env.SYNPRESS_EXTENSION_ID\n    if (envExtensionId) {\n      await page.close()\n      return envExtensionId\n    }\n\n    const contextExtensionId = findExtensionIdFromContext(context)\n    if (contextExtensionId) {\n      await page.close()\n      return contextExtensionId\n    }\n\n    throw new Error(\n`,
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

  if (existsSync(DIRECT_METAMASK)) {
    const fixturesPath = join(
      DIRECT_METAMASK,
      'src',
      'playwright',
      'fixtures',
      'metaMaskFixtures.ts',
    )
    if (patchMetaMaskFixtures(fixturesPath)) patchedCount++

    const extensionIdPath = join(
      DIRECT_METAMASK,
      'src',
      'playwright',
      'fixture-actions',
      'getExtensionId.ts',
    )
    if (patchGetExtensionId(extensionIdPath)) patchedCount++

    const prepareExtensionPath = join(DIRECT_METAMASK, 'src', 'prepareExtension.ts')
    if (patchMetaMaskVersion(prepareExtensionPath)) patchedCount++
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

    const synpressMetaMaskDirs = entries.filter((e) =>
      e.startsWith('@synthetixio+synpress-metamask@'),
    )
    for (const dir of synpressMetaMaskDirs) {
      const fixturesPath = join(
        BUN_CACHE,
        dir,
        'node_modules/@synthetixio/synpress-metamask/src/playwright/fixtures/metaMaskFixtures.ts',
      )
      if (patchMetaMaskFixtures(fixturesPath)) patchedCount++

      const extensionIdPath = join(
        BUN_CACHE,
        dir,
        'node_modules/@synthetixio/synpress-metamask/src/playwright/fixture-actions/getExtensionId.ts',
      )
      if (patchGetExtensionId(extensionIdPath)) patchedCount++

      const prepareExtensionPath = join(
        BUN_CACHE,
        dir,
        'node_modules/@synthetixio/synpress-metamask/src/prepareExtension.ts',
      )
      if (patchMetaMaskVersion(prepareExtensionPath)) patchedCount++
    }
  }

  if (patchedCount > 0) {
    console.log(
      `Patched ${patchedCount} synpress-cache files for zod 4.x compatibility`,
    )
  } else {
    console.log(
      'No synpress-cache files needed patching (already patched or not found)',
    )
  }
}

patchSynpressCache().catch(console.error)
