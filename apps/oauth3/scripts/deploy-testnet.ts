#!/usr/bin/env bun
/**
 * Deploy OAuth3 to testnet
 * 
 * This script:
 * 1. Builds the frontend
 * 2. Creates a ConfigMap with the embedded frontend
 * 3. Updates the Kubernetes deployment
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')

async function deploy() {
  console.log('OAuth3 Testnet Deployment')
  console.log('='.repeat(50))

  // Build
  console.log('\n[1/4] Building frontend...')
  execSync('bun run scripts/build.ts', { cwd: APP_DIR, stdio: 'inherit' })

  // Read built files
  console.log('\n[2/4] Reading built files...')
  const indexHtml = readFileSync(resolve(APP_DIR, 'dist/web/index.html'), 'utf-8')
  const appJs = readFileSync(resolve(APP_DIR, 'dist/web/app.js'), 'utf-8')

  console.log(`  index.html: ${indexHtml.length} bytes`)
  console.log(`  app.js: ${appJs.length} bytes`)

  // Create server code with embedded files
  const serverCode = createServerCode(indexHtml, appJs)

  // Create ConfigMap YAML
  console.log('\n[3/4] Creating ConfigMap...')
  const configMapYaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: oauth3-config
  namespace: oauth3
data:
  server.js: |
${serverCode.split('\n').map(line => '    ' + line).join('\n')}
`

  // Write temp file and apply
  const tmpPath = '/tmp/oauth3-configmap.yaml'
  await Bun.write(tmpPath, configMapYaml)
  
  console.log('  Applying ConfigMap...')
  execSync(`kubectl apply -f ${tmpPath}`, { stdio: 'inherit' })

  // Restart deployment
  console.log('\n[4/4] Restarting deployment...')
  execSync('kubectl rollout restart deployment/oauth3 -n oauth3', { stdio: 'inherit' })
  execSync('kubectl rollout status deployment/oauth3 -n oauth3 --timeout=60s', { stdio: 'inherit' })

  console.log('\n' + '='.repeat(50))
  console.log('Deployment complete.')
  console.log('OAuth3 should now be available at: https://oauth3.testnet.jejunetwork.org')
}

function createServerCode(indexHtml: string, appJs: string): string {
  // Escape the strings for embedding in JavaScript
  const escapeForJs = (str: string) => {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
  }

  return `const http = require('http');

const sessions = new Map();
const clients = new Map();

// Pre-register test clients
clients.set('babylon', { 
  clientId: 'babylon',
  name: 'Babylon Game',
  redirectUris: ['http://localhost:5007/callback', 'https://babylon.game/callback'],
  active: true
});

// Embedded HTML content
const INDEX_HTML = \`${escapeForJs(indexHtml)}\`;

// Embedded JS content
const APP_JS = \`${escapeForJs(appJs)}\`;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  const url = new URL(req.url, 'http://localhost');
  
  // Serve frontend
  if (url.pathname === '/' || url.pathname === '/callback') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(INDEX_HTML);
    return;
  }
  
  if (url.pathname === '/app.js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.writeHead(200);
    res.end(APP_JS);
    return;
  }
  
  // API endpoints
  res.setHeader('Content-Type', 'application/json');
  
  if (url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ 
      status: 'healthy', 
      service: 'oauth3',
      mode: 'testnet',
      timestamp: Date.now() 
    }));
    return;
  }
  
  if (url.pathname === '/session') {
    res.writeHead(200);
    res.end(JSON.stringify({ authenticated: false }));
    return;
  }
  
  if (url.pathname === '/api') {
    res.writeHead(200);
    res.end(JSON.stringify({
      name: 'Jeju OAuth3 Gateway (Testnet)',
      version: '1.0.0-testnet',
      endpoints: { auth: '/auth', session: '/session', wallet: '/wallet' }
    }));
    return;
  }
  
  if (url.pathname === '/auth/wallet' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      const sessionId = 'sess_' + Math.random().toString(36).slice(2);
      const session = {
        sessionId,
        userId: data.address || '0x0',
        provider: 'wallet',
        address: data.address,
        expiresAt: Date.now() + 86400000
      };
      sessions.set(sessionId, session);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, session }));
    });
    return;
  }
  
  if (url.pathname.startsWith('/session/') && req.method === 'GET') {
    const sessionId = url.pathname.split('/')[2];
    const session = sessions.get(sessionId);
    if (session) {
      res.writeHead(200);
      res.end(JSON.stringify(session));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 4200;
server.listen(PORT, '0.0.0.0', () => {
  console.log('OAuth3 testnet service running on port ' + PORT);
});`
}

deploy().catch(err => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
