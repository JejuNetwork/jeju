import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Plugin to stub platform-specific modules that use dynamic imports
function stubPlatformModules(): Plugin {
  const stubbedModules = [
    '@tauri-apps/api/fs',
    '@tauri-apps/api/tauri', 
    '@tauri-apps/api/path',
    '@tauri-apps/api/shell',
    '@tauri-apps/api/window',
    '@tauri-apps/api/event',
    '@tauri-apps/api/dialog',
    '@tauri-apps/api/notification',
    '@tauri-apps/api/updater',
    '@tauri-apps/api/http',
    '@tauri-apps/api/os',
    '@tauri-apps/api/process',
    '@tauri-apps/api/clipboard',
    '@tauri-apps/api/globalShortcut',
    '@tauri-apps/api',
    'webtorrent',
  ];
  
  return {
    name: 'stub-platform-modules',
    resolveId(id) {
      if (stubbedModules.some(m => id === m || id.startsWith(m + '/'))) {
        return `\0stub:${id}`;
      }
      return null;
    },
    load(id) {
      if (id.startsWith('\0stub:')) {
        // Return a stub module that exports empty objects/functions
        return `
          export default {};
          export const invoke = () => Promise.reject(new Error('Tauri not available'));
          export const listen = () => Promise.resolve(() => {});
          export const emit = () => {};
          export const writeBinaryFile = () => Promise.reject(new Error('Tauri not available'));
          export const readBinaryFile = () => Promise.reject(new Error('Tauri not available'));
          export const writeTextFile = () => Promise.reject(new Error('Tauri not available'));
          export const readTextFile = () => Promise.reject(new Error('Tauri not available'));
          export const exists = () => Promise.resolve(false);
          export const createDir = () => Promise.reject(new Error('Tauri not available'));
          export const removeDir = () => Promise.reject(new Error('Tauri not available'));
          export const removeFile = () => Promise.reject(new Error('Tauri not available'));
          export const renameFile = () => Promise.reject(new Error('Tauri not available'));
          export const copyFile = () => Promise.reject(new Error('Tauri not available'));
          export const BaseDirectory = { AppData: 0, AppConfig: 1, AppCache: 2, Temp: 3 };
        `;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), stubPlatformModules()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@sdk': resolve(__dirname, './src/sdk'),
      '@hooks': resolve(__dirname, './src/hooks'),
      '@components': resolve(__dirname, './src/components'),
      // Fix zod v4 compatibility issue from monorepo dependencies
      'zod/mini': 'zod',
    },
  },
  server: {
    port: 4015,
    host: true,
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-web3': ['viem', 'wagmi', '@tanstack/react-query'],
          'vendor-ui': ['framer-motion', 'lucide-react'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'viem', 'wagmi'],
    exclude: ['@tauri-apps/api', 'webtorrent'],
  },
});

