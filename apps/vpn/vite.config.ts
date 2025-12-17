import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1421,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
});

