import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';

type ExtensionTarget = 'chrome' | 'firefox' | 'safari' | 'edge' | 'brave';

const targetEnv = process.env.EXT_TARGET as ExtensionTarget | undefined;
const validTargets: ExtensionTarget[] = ['chrome', 'firefox', 'safari', 'edge', 'brave'];
const target: ExtensionTarget = targetEnv && validTargets.includes(targetEnv) ? targetEnv : 'chrome';

// Map targets to manifest files
const manifestMap: Record<ExtensionTarget, string> = {
  chrome: 'src/extension/manifest.chrome.json',
  firefox: 'src/extension/manifest.firefox.json',
  safari: 'src/extension/manifest.safari.json',
  edge: 'src/extension/manifest.edge.json',
  brave: 'src/extension/manifest.chrome.json', // Brave uses Chrome MV3
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'extension-build',
      writeBundle() {
        const distDir = `dist-ext-${target}`;
        
        // Ensure directories exist
        if (!existsSync(`${distDir}/icons`)) {
          mkdirSync(`${distDir}/icons`, { recursive: true });
        }
        if (!existsSync(`${distDir}/_locales/en`)) {
          mkdirSync(`${distDir}/_locales/en`, { recursive: true });
        }

        // Copy manifest
        const manifestSrc = manifestMap[target];
        copyFileSync(manifestSrc, `${distDir}/manifest.json`);

        // Copy locales
        copyFileSync(
          'src/extension/_locales/en/messages.json',
          `${distDir}/_locales/en/messages.json`
        );

        // Generate placeholder icons (in production, use real icons)
        const iconSizes = [16, 32, 48, 128];
        for (const size of iconSizes) {
          const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${size}" height="${size}" rx="${size * 0.1875}" fill="#10B981"/>
            <text x="${size / 2}" y="${size * 0.625}" font-size="${size / 2}" text-anchor="middle" fill="white" font-family="system-ui" font-weight="bold">J</text>
          </svg>`;
          writeFileSync(`${distDir}/icons/icon-${size}.png`, svg);
        }

        console.log(`Extension built for ${target}`);
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@sdk': resolve(__dirname, './src/sdk'),
      '@hooks': resolve(__dirname, './src/hooks'),
      '@components': resolve(__dirname, './src/components'),
      '@platform': resolve(__dirname, './src/platform'),
      // Fix zod v4 compatibility issue from monorepo dependencies
      'zod/mini': 'zod',
    },
  },
  define: {
    'process.env.EXT_TARGET': JSON.stringify(target),
    'process.env.IS_EXTENSION': JSON.stringify(true),
  },
  build: {
    outDir: `dist-ext-${target}`,
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/extension/popup/popup.html'),
        background: resolve(__dirname, 'src/extension/background/index.ts'),
        'content-script': resolve(__dirname, 'src/extension/content/index.ts'),
        injected: resolve(__dirname, 'src/extension/content/injected.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
      // Externalize platform-specific and node-only imports for extension builds
      external: (id) => {
        // Tauri APIs
        if (id.startsWith('@tauri-apps/')) return true;
        // Capacitor APIs
        if (id.startsWith('@capacitor/')) return true;
        // Node-only modules
        if (['webtorrent', 'fs', 'path', 'crypto', 'os', 'child_process', 'net', 'http', 'https', 'stream', 'buffer', 'util', 'events'].includes(id)) return true;
        // Hardware wallet modules (use web versions in extension)
        if (id.includes('@ledgerhq/hw-transport-node')) return true;
        if (id.includes('@trezor/connect')) return true;
        return false;
      },
    },
    minify: process.env.NODE_ENV === 'production',
  },
});

