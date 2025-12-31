#!/usr/bin/env bun
/**
 * Deploy OAuth3 to Kubernetes
 * 
 * Updates the oauth3-config ConfigMap with the built frontend files
 * and restarts the deployment.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APP_DIR = resolve(import.meta.dir, '..')
const NAMESPACE = 'oauth3'

async function deploy() {
  console.log('OAuth3 Kubernetes Deployment')
  console.log('============================\n')

  // Build first
  console.log('[1/4] Building...')
  execSync('bun run build', { cwd: APP_DIR, stdio: 'inherit' })

  // Read built files
  console.log('\n[2/4] Reading built files...')
  const indexHtml = readFileSync(join(APP_DIR, 'dist/web/index.html'), 'utf-8')
  const appJs = readFileSync(join(APP_DIR, 'dist/web/app.js'), 'utf-8')
  
  console.log(`  index.html: ${indexHtml.length} bytes`)
  console.log(`  app.js: ${appJs.length} bytes`)

  // Create server.js with embedded frontend
  const serverJs = `const http = require('http');

const sessions = new Map();
const clients = new Map();

// Pre-register test clients
clients.set('babylon', { 
  clientId: 'babylon',
  name: 'Babylon Game',
  redirectUris: ['http://localhost:5007/callback', 'https://babylon.game/callback'],
  active: true
});

clients.set('jeju-default', {
  clientId: 'jeju-default',
  name: 'Jeju Default Client',
  redirectUris: ['http://localhost:4200/callback', 'http://localhost:4201/callback'],
  active: true
});

// Embedded frontend files
const INDEX_HTML = ${JSON.stringify(indexHtml)};

const APP_JS = ${JSON.stringify(appJs)};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, \`http://\${req.headers.host}\`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'oauth3' }));
    return;
  }

  // Session endpoints
  if (url.pathname === '/session') {
    if (req.method === 'GET') {
      // Check session from cookie
      const cookies = parseCookies(req.headers.cookie || '');
      const sessionId = cookies['oauth3_session'];
      const session = sessions.get(sessionId);
      
      if (session) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: true, session }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: false }));
      }
      return;
    }
    
    if (req.method === 'DELETE') {
      const cookies = parseCookies(req.headers.cookie || '');
      const sessionId = cookies['oauth3_session'];
      sessions.delete(sessionId);
      res.setHeader('Set-Cookie', 'oauth3_session=; Path=/; HttpOnly; Max-Age=0');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }
  }

  // OAuth authorize
  if (url.pathname === '/oauth/authorize') {
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    
    // Generate auth code
    const code = 'demo_' + Math.random().toString(36).substring(2);
    
    // Store code -> session mapping
    sessions.set(code, {
      clientId,
      redirectUri,
      createdAt: Date.now()
    });
    
    // Redirect back with code
    const redirect = new URL(redirectUri);
    redirect.searchParams.set('code', code);
    res.writeHead(302, { Location: redirect.toString() });
    res.end();
    return;
  }

  // OAuth token exchange
  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const code = data.code;
        const codeData = sessions.get(code);
        
        if (!codeData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        
        // Create session
        const sessionId = 'sess_' + Math.random().toString(36).substring(2);
        const session = {
          sessionId,
          userId: 'demo:user',
          provider: 'wallet',
          address: '0xdemo...demo',
          createdAt: Date.now(),
          expiresAt: Date.now() + 86400000 // 24h
        };
        
        sessions.set(sessionId, session);
        sessions.delete(code);
        
        // Set session cookie
        res.setHeader('Set-Cookie', \`oauth3_session=\${sessionId}; Path=/; HttpOnly; Max-Age=86400\`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'demo_token_' + Math.random().toString(36),
          token_type: 'Bearer',
          expires_in: 86400
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request' }));
      }
    });
    return;
  }

  // Serve app.js
  if (url.pathname === '/app.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(APP_JS);
    return;
  }

  // Serve index.html for all other routes (SPA)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(INDEX_HTML);
});

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name) cookies[name] = value;
  });
  return cookies;
}

const PORT = process.env.PORT || 4200;
server.listen(PORT, () => {
  console.log(\`OAuth3 server running on port \${PORT}\`);
});
`

  // Create ConfigMap
  console.log('\n[3/4] Creating ConfigMap...')
  
  // Write server.js to temp file
  const tempFile = '/tmp/oauth3-server.js'
  Bun.write(tempFile, serverJs)
  
  // Create ConfigMap from file
  try {
    execSync(`kubectl create configmap oauth3-config -n ${NAMESPACE} --from-file=server.js=${tempFile} --dry-run=client -o yaml | kubectl apply -f -`, {
      stdio: 'inherit'
    })
  } catch (e) {
    console.error('Failed to create ConfigMap:', e)
    process.exit(1)
  }

  // Restart deployment
  console.log('\n[4/4] Restarting deployment...')
  execSync(`kubectl rollout restart deployment/oauth3 -n ${NAMESPACE}`, { stdio: 'inherit' })
  execSync(`kubectl rollout status deployment/oauth3 -n ${NAMESPACE} --timeout=60s`, { stdio: 'inherit' })

  console.log('\n============================')
  console.log('Deployment complete!')
  console.log('OAuth3: https://oauth3.testnet.jejunetwork.org')
}

deploy().catch(e => {
  console.error('Deployment failed:', e)
  process.exit(1)
})
