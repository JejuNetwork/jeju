#!/usr/bin/env bun
/**
 * Browser Extension Build Script
 *
 * Builds the wallet extension for Chrome, Firefox, Safari, Edge, Brave
 * using Bun's native bundler - no Vite required.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import type { BunPlugin } from 'bun'

type ExtensionTarget = 'chrome' | 'firefox' | 'safari' | 'edge' | 'brave'

const validTargets: ExtensionTarget[] = [
  'chrome',
  'firefox',
  'safari',
  'edge',
  'brave',
]
const targetEnv = process.env.EXT_TARGET as ExtensionTarget | undefined
const target: ExtensionTarget =
  targetEnv && validTargets.includes(targetEnv) ? targetEnv : 'chrome'
const isProduction = process.env.NODE_ENV === 'production'

const ROOT = resolve(import.meta.dir, '..')
const DIST = resolve(ROOT, `dist-ext-${target}`)
const SRC = resolve(ROOT, 'src/extension')

// Manifest files per target
const manifestMap: Record<ExtensionTarget, string> = {
  chrome: 'manifest.chrome.json',
  firefox: 'manifest.firefox.json',
  safari: 'manifest.safari.json',
  edge: 'manifest.edge.json',
  brave: 'manifest.chrome.json', // Brave uses Chrome MV3
}

// Plugin to stub platform-specific modules
const stubPlugin: BunPlugin = {
  name: 'stub-modules',
  setup(build) {
    const stubbedModules = [
      '@tauri-apps/api',
      '@tauri-apps/plugin-fs',
      '@tauri-apps/plugin-os',
      '@tauri-apps/plugin-process',
      '@tauri-apps/plugin-shell',
      '@tauri-apps/plugin-store',
      'webtorrent',
      'porto',
      'native-dns',
      'native-dns-cache',
      'dgram',
    ]

    // Match stubbed modules and their subpaths
    const pattern = new RegExp(`^(${stubbedModules.join('|')})(/.*)?$`)

    build.onResolve({ filter: pattern }, (args) => {
      return { path: args.path, namespace: 'stub' }
    })

    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => {
      return {
        contents: `
          // Stubbed module for browser extension
          export default {};
          export const invoke = () => Promise.reject(new Error('Not available in extension'));
          export const listen = () => Promise.resolve(() => {});
          export const emit = () => {};
          export const createClient = () => ({});
          export const Porto = {};
          // Porto exports
          export const RpcSchema = {};
          export const z = { object: () => z, string: () => z, optional: () => z, array: () => z, union: () => z, literal: () => z, infer: () => ({}), parse: (v) => v };
        `,
        loader: 'js',
      }
    })
  },
}

import tw from 'bun-plugin-tailwind'

const tailwindPlugin: BunPlugin = tw

async function build() {
  console.log(`Building extension for ${target}...`)

  // Clean output directory
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true })
  }
  mkdirSync(DIST, { recursive: true })
  mkdirSync(resolve(DIST, 'icons'), { recursive: true })
  mkdirSync(resolve(DIST, '_locales/en'), { recursive: true })
  mkdirSync(resolve(DIST, 'assets'), { recursive: true })

  // Build popup HTML (with its referenced TSX)
  console.log('  Building popup...')
  const popupResult = await Bun.build({
    entrypoints: [resolve(SRC, 'popup/popup.html')],
    outdir: DIST,
    minify: isProduction,
    sourcemap: isProduction ? 'none' : 'linked',
    target: 'browser',
    define: {
      'process.env.EXT_TARGET': JSON.stringify(target),
      'process.env.IS_EXTENSION': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
    },
    plugins: [stubPlugin, tailwindPlugin],
    naming: {
      asset: 'assets/[name]-[hash].[ext]',
    },
  })

  if (!popupResult.success) {
    console.error('Popup build failed:')
    for (const log of popupResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Build background service worker
  console.log('  Building background script...')
  const backgroundResult = await Bun.build({
    entrypoints: [resolve(SRC, 'background/index.ts')],
    outdir: DIST,
    minify: isProduction,
    sourcemap: isProduction ? 'none' : 'linked',
    target: 'browser',
    define: {
      'process.env.EXT_TARGET': JSON.stringify(target),
      'process.env.IS_EXTENSION': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
    },
    plugins: [stubPlugin],
    naming: '[name].js',
  })

  if (!backgroundResult.success) {
    console.error('Background build failed:')
    for (const log of backgroundResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Rename background output to expected name
  const bgOutput = backgroundResult.outputs.find((o) => o.path.endsWith('.js'))
  if (bgOutput) {
    const bgPath = bgOutput.path
    const expectedPath = resolve(DIST, 'background.js')
    if (bgPath !== expectedPath) {
      copyFileSync(bgPath, expectedPath)
      rmSync(bgPath)
    }
  }

  // Build content script
  console.log('  Building content script...')
  const contentResult = await Bun.build({
    entrypoints: [resolve(SRC, 'content/index.ts')],
    outdir: DIST,
    minify: isProduction,
    sourcemap: isProduction ? 'none' : 'linked',
    target: 'browser',
    define: {
      'process.env.EXT_TARGET': JSON.stringify(target),
      'process.env.IS_EXTENSION': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
    },
    plugins: [stubPlugin],
    naming: 'content-script.js',
  })

  if (!contentResult.success) {
    console.error('Content script build failed:')
    for (const log of contentResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Build injected script
  console.log('  Building injected script...')
  const injectedResult = await Bun.build({
    entrypoints: [resolve(SRC, 'content/injected.ts')],
    outdir: DIST,
    minify: isProduction,
    sourcemap: isProduction ? 'none' : 'linked',
    target: 'browser',
    define: {
      'process.env.EXT_TARGET': JSON.stringify(target),
      'process.env.IS_EXTENSION': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
    },
    plugins: [stubPlugin],
    naming: 'injected.js',
  })

  if (!injectedResult.success) {
    console.error('Injected script build failed:')
    for (const log of injectedResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Copy manifest
  console.log('  Copying manifest...')
  const manifestSrc = resolve(SRC, manifestMap[target])
  copyFileSync(manifestSrc, resolve(DIST, 'manifest.json'))

  // Copy locales
  console.log('  Copying locales...')
  copyFileSync(
    resolve(SRC, '_locales/en/messages.json'),
    resolve(DIST, '_locales/en/messages.json'),
  )

  // Generate icons
  console.log('  Generating icons...')
  const iconSizes = [16, 32, 48, 128]
  for (const size of iconSizes) {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${size * 0.1875}" fill="#10B981"/>
      <text x="${size / 2}" y="${size * 0.625}" font-size="${size / 2}" text-anchor="middle" fill="white" font-family="system-ui" font-weight="bold">J</text>
    </svg>`
    writeFileSync(resolve(DIST, `icons/icon-${size}.svg`), svg)
  }

  // Copy real icons if they exist
  const realIconsDir = resolve(ROOT, 'public/icons')
  if (existsSync(realIconsDir)) {
    for (const size of iconSizes) {
      const pngPath = resolve(realIconsDir, `icon-${size}.png`)
      if (existsSync(pngPath)) {
        copyFileSync(pngPath, resolve(DIST, `icons/icon-${size}.png`))
      }
    }
  }

  console.log(`Extension built successfully: ${DIST}`)
  console.log(`  Target: ${target}`)
  console.log(`  Mode: ${isProduction ? 'production' : 'development'}`)
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
