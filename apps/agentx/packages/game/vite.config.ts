import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Support environment-configurable frontend port
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '5173', 10);

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/elizagotchi/' : '/',
  server: {
    port: FRONTEND_PORT,
    host: true,
    strictPort: false, // Allow Vite to try alternative ports if specified port is busy
  },
  preview: {
    port: FRONTEND_PORT + 1000, // Use different port for preview to avoid conflicts
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  // Ensure we can import from other packages
  resolve: {
    alias: {
      '@': './src',
    },
  },
});
