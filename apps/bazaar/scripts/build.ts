/**
 * Production build script
 */

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
  '@jejunetwork/config',
  '@jejunetwork/shared',
  '@jejunetwork/sdk',
  '@jejunetwork/oauth3',
  '@jejunetwork/deployment',
  '@jejunetwork/contracts',
]

async function build() {
  console.log('🔨 Building Bazaar for production...')

  const result = await Bun.build({
    entrypoints: ['./src/client.tsx'],
    outdir: './dist',
    target: 'browser',
    splitting: true,
    minify: true,
    sourcemap: 'external',
    external: BUILD_EXTERNALS,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.PUBLIC_API_URL': JSON.stringify(
        process.env.PUBLIC_API_URL || '',
      ),
    },
  })

  if (!result.success) {
    console.error('❌ Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Copy CSS
  const css = await Bun.file('./src/globals.css').text()
  await Bun.write('./dist/globals.css', css)

  // Create index.html
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="#0D0B14" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#FFFBF7" media="(prefers-color-scheme: light)">
  <title>Bazaar - Agent Marketplace on the network</title>
  <meta name="description" content="The fun, light-hearted marketplace for tokens, NFTs, prediction markets, and more.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            'bazaar-primary': '#FF6B35',
            'bazaar-accent': '#00D9C0',
            'bazaar-purple': '#7C3AED',
          }
        }
      }
    }
  </script>
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('bazaar-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark;
        if (shouldBeDark) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
  </script>
  <link rel="stylesheet" href="/globals.css">
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/client.js"></script>
</body>
</html>`

  await Bun.write('./dist/index.html', html)

  console.log('✅ Build complete')
  console.log('   Output: ./dist/')
}

build()
