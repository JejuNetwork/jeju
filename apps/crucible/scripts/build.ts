/**
 * Crucible Build Script
 *
 * Builds both the API server and frontend for production
 */

import { mkdir } from 'node:fs/promises'

const BROWSER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'http2',
  'tls',
  'dgram',
  'fs',
  'net',
  'dns',
  'stream',
  'crypto',
  'node:url',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:events',
]

async function buildApi(): Promise<void> {
  console.log('Building API...')
  const startTime = Date.now()

  const result = await Bun.build({
    entrypoints: ['./api/index.ts'],
    outdir: './dist/api',
    target: 'bun',
    minify: true,
    sourcemap: 'external',
  })

  if (!result.success) {
    console.error('API build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  console.log(`API built in ${Date.now() - startTime}ms`)
}

async function buildFrontend(): Promise<void> {
  console.log('Building frontend...')
  const startTime = Date.now()

  await mkdir('./dist/web', { recursive: true })

  const result = await Bun.build({
    entrypoints: ['./web/client.tsx'],
    outdir: './dist/web',
    target: 'browser',
    splitting: true,
    minify: true,
    sourcemap: 'external',
    external: BROWSER_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.PUBLIC_API_URL': JSON.stringify(''),
    },
  })

  if (!result.success) {
    console.error('Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Copy index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0A0E17" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#F8FAFC" media="(prefers-color-scheme: light)">
  <title>Crucible - Agent Orchestration Platform</title>
  <meta name="description" content="Decentralized agent orchestration platform for autonomous AI agents.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('crucible-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;
        if (shouldBeDark) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
  </script>
  <link rel="stylesheet" href="/globals.css">
  <script type="module" src="/client.js"></script>
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
</body>
</html>`

  await Bun.write('./dist/web/index.html', indexHtml)

  // Copy CSS
  const css = await Bun.file('./web/globals.css').text()
  await Bun.write('./dist/web/globals.css', css)

  console.log(`Frontend built in ${Date.now() - startTime}ms`)
}

async function main(): Promise<void> {
  console.log('Building Crucible...\n')

  await Promise.all([buildApi(), buildFrontend()])

  console.log('\nBuild complete.')
  console.log('   API: ./dist/api/index.js')
  console.log('   Frontend: ./dist/web/')
}

main()
