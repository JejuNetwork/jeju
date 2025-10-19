import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/elizagotchi/' : '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      external: [], // Don't externalize anything
    },
  },
  esbuild: {
    target: 'esnext',
  },
});
