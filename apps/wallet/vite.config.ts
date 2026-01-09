import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      // Exclude backend/api code from the frontend bundle
      external: [
        // Node built-ins
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:crypto',
        'node:process',
        'node:util/types',
        'node:child_process',
        'node:module',
        'node:url',
        'node:events',
        'node:stream',
        'node:http',
        'node:https',
        'node:net',
        'node:tls',
        'node:dns',
        // Server-only packages
        'elysia',
        '@elysiajs/cors',
        '@elysiajs/swagger',
        'pino',
        'pino-pretty',
        'ioredis',
        'bun:sqlite',
        // Native mobile plugins (only available in Capacitor/Tauri)
        'capacitor-secure-storage-plugin',
        '@capacitor/preferences',
        '@tauri-apps/api/core',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'web'),
      '@lib': resolve(__dirname, 'lib'),
      // Stub native mobile plugins for web builds
      'capacitor-secure-storage-plugin': resolve(
        __dirname,
        'web/platform/stubs/capacitor-secure-storage-plugin.ts',
      ),
      '@capacitor/preferences': resolve(
        __dirname,
        'web/platform/stubs/capacitor-preferences.ts',
      ),
      '@tauri-apps/api/core': resolve(
        __dirname,
        'web/platform/stubs/tauri-api-core.ts',
      ),
    },
  },
  // Don't process api/ folder at all
  optimizeDeps: {
    exclude: ['@jejunetwork/db', '@jejunetwork/kms', '@jejunetwork/messaging'],
  },
})
