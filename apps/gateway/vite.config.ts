import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(
      process.env.GATEWAY_PORT || 
      process.env.VITE_PORT || 
      process.env.PORT || 
      '4001'
    ),
    host: '0.0.0.0'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
});

