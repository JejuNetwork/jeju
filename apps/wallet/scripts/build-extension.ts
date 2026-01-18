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
  readFileSync,
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
const SRC = resolve(ROOT, 'extension')

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

// Plugin to handle CSS imports by inlining them
const cssPlugin: BunPlugin = {
  name: 'css-inline',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = readFileSync(args.path, 'utf8')
      return {
        contents: `
          // Inject CSS into document
          if (typeof document !== 'undefined') {
            const style = document.createElement('style');
            style.textContent = ${JSON.stringify(css)};
            document.head.appendChild(style);
          }
          export default ${JSON.stringify(css)};
        `,
        loader: 'js',
      }
    })
  },
}

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

  // Build popup entry point (TSX file that popup.html references)
  console.log('  Building popup...')
  const popupResult = await Bun.build({
    entrypoints: [resolve(SRC, 'popup/index.tsx')],
    outdir: DIST,
    minify: isProduction,
    sourcemap: isProduction ? 'none' : 'linked',
    target: 'browser',
    splitting: false,
    packages: 'bundle',
    define: {
      'process.env.EXT_TARGET': JSON.stringify(target),
      'process.env.IS_EXTENSION': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
    },
    plugins: [stubPlugin, cssPlugin],
    naming: {
      entry: '[name].js',
      chunk: '[name]-[hash].js',
      asset: 'assets/[name]-[hash].[ext]',
    },
    drop: isProduction ? ['debugger'] : [],
  })

  if (!popupResult.success) {
    console.error('Popup build failed:')
    for (const log of popupResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Create popup.html that loads the built JS with Tailwind CDN
  const popupHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Network Wallet</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              background: '#0f0f0f',
              foreground: '#fafafa',
              card: '#1a1a1a',
              'card-foreground': '#fafafa',
              primary: '#22c55e',
              'primary-foreground': '#ffffff',
              secondary: '#27272a',
              'secondary-foreground': '#fafafa',
              muted: '#27272a',
              'muted-foreground': '#a1a1aa',
              accent: '#27272a',
              'accent-foreground': '#fafafa',
              destructive: '#ef4444',
              'destructive-foreground': '#fafafa',
              border: '#2e2e2e',
              input: '#27272a',
              ring: '#22c55e',
              surface: {
                DEFAULT: '#0f0f0f',
                elevated: '#1a1a1a',
                hover: '#242424',
                border: '#2e2e2e',
              },
            },
            fontFamily: {
              sans: ['system-ui', 'sans-serif'],
              mono: ['monospace'],
            },
          },
        },
      }
    </script>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 380px;
        height: 600px;
        overflow: hidden;
        background: #0f0f0f;
        color: #fafafa;
      }
      #root {
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body class="bg-surface text-white antialiased">
    <div id="root"></div>
    <script type="module" src="./index.js"></script>
  </body>
</html>`
  writeFileSync(resolve(DIST, 'popup.html'), popupHtml)

  // Build background service worker
  console.log('  Building background script...')
  const backgroundResult = await Bun.build({
    entrypoints: [resolve(SRC, 'background/index.ts')],
    outdir: DIST,
    minify: isProduction,
    sourcemap: isProduction ? 'none' : 'linked',
    target: 'browser',
    packages: 'bundle',
    define: {
      'process.env.EXT_TARGET': JSON.stringify(target),
      'process.env.IS_EXTENSION': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
    },
    plugins: [stubPlugin],
    naming: '[name].js',
    drop: isProduction ? ['debugger'] : [],
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
    packages: 'bundle',
    define: {
      'process.env.EXT_TARGET': JSON.stringify(target),
      'process.env.IS_EXTENSION': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
    },
    plugins: [stubPlugin],
    naming: 'content-script.js',
    drop: isProduction ? ['debugger'] : [],
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
    packages: 'bundle',
    define: {
      'process.env.EXT_TARGET': JSON.stringify(target),
      'process.env.IS_EXTENSION': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(
        isProduction ? 'production' : 'development',
      ),
    },
    plugins: [stubPlugin],
    naming: 'injected.js',
    drop: isProduction ? ['debugger'] : [],
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
  process.exit(0)
}

build().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
