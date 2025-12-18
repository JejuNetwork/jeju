import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
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
      // Externalize platform-specific and node-only imports for web builds
      external: (id) => {
        // Tauri APIs (only available in desktop)
        if (id.startsWith('@tauri-apps/')) return true;
        // Node-only modules
        if (['webtorrent', 'fs', 'path', 'crypto', 'os', 'child_process', 'net', 'http', 'https', 'stream', 'buffer', 'util', 'events'].includes(id)) return true;
        return false;
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'viem', 'wagmi'],
  },
});

