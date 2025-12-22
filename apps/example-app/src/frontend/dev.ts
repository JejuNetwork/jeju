/**
 * Frontend Development Server
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '4501', 10);
const frontendDir = join(import.meta.dir);

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

Bun.serve({
  port: FRONTEND_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // Serve index.html for root
    if (pathname === '/') {
      pathname = '/index.html';
    }

    // Handle TypeScript -> JavaScript transpilation
    if (pathname.endsWith('.ts')) {
      const filePath = join(frontendDir, pathname);
      if (existsSync(filePath)) {
        const transpiled = await Bun.build({
          entrypoints: [filePath],
          target: 'browser',
        });
        
        if (transpiled.success) {
          const output = await transpiled.outputs[0].text();
          return new Response(output, {
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
      }
    }

    // Serve static files
    const filePath = join(frontendDir, pathname);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath);
      const ext = pathname.split('.').pop() || '';
      const contentType = mimeTypes[`.${ext}`] || 'application/octet-stream';
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      });
    }

    // 404
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Frontend dev server running at http://localhost:${FRONTEND_PORT}`);
