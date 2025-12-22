import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(
      process.env.GATEWAY_PORT ||
        process.env.VITE_PORT ||
        process.env.PORT ||
        '4001',
      10,
    ),
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Work around zod/mini import issue in wagmi
      'zod/mini': 'zod',
    },
  },
  optimizeDeps: {
    include: ['zod'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
})
