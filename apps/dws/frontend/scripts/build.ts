/**
 * Production build script for DWS Console
 */

import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')

const BUILD_EXTERNALS = [
  // Node.js builtins
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
  // Packages with Node.js-specific code
  '@jejunetwork/oauth3',
]

async function build() {
  console.log('🔨 Building DWS Console for production...')

  const result = await Bun.build({
    entrypoints: [resolve(ROOT, 'src/main.tsx')],
    outdir: resolve(ROOT, 'dist'),
    target: 'browser',
    splitting: true,
    minify: true,
    sourcemap: 'external',
    external: BUILD_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  })

  if (!result.success) {
    console.error('❌ Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Create index.html
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="description" content="DWS Console - Decentralized Web Services">
  <meta name="theme-color" content="#0a0f1a">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI2IiBmaWxsPSIjMTBCOTgxIi8+PHRleHQgeD0iMTYiIHk9IjIwIiBmb250LXNpemU9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9InN5c3RlbS11aSIgZm9udC13ZWlnaHQ9ImJvbGQiPko8L3RleHQ+PC9zdmc+">
  <title>DWS Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            primary: '#10B981',
          }
        }
      }
    }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/main.js"></script>
</body>
</html>`

  await Bun.write(resolve(ROOT, 'dist/index.html'), html)

  console.log('✅ Build complete')
  console.log('   Output: ./dist/')
}

build()
