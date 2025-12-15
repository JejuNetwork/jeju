import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    // Serve static callback page for OAuth
    {
      name: 'oauth-callback',
      configureServer(server) {
        server.middlewares.use('/auth/callback', (req, res, next) => {
          // Only handle GET requests with query params (OAuth callback)
          if (req.method === 'GET' && req.url?.includes('?')) {
            const callbackHtml = readFileSync(
              resolve(__dirname, 'public/auth/callback/index.html'),
              'utf-8'
            );
            res.setHeader('Content-Type', 'text/html');
            res.end(callbackHtml);
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: parseInt(process.env.OAUTH3_DEMO_PORT || '4100'),
    strictPort: true,
    host: '0.0.0.0'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
});
