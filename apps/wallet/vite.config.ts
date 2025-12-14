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
  },
});

