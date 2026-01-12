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
  const indexHtml = readFileSync(
    resolve(APP_DIR, 'dist/web/index.html'),
    'utf-8',
  )
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
${serverCode
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
`

  // Write temp file and apply
  const tmpPath = '/tmp/oauth3-configmap.yaml'
  await Bun.write(tmpPath, configMapYaml)

  console.log('  Applying ConfigMap...')
  execSync(`kubectl apply -f ${tmpPath}`, { stdio: 'inherit' })

  // Restart deployment
  console.log('\n[4/4] Restarting deployment...')
  execSync('kubectl rollout restart deployment/oauth3 -n oauth3', {
    stdio: 'inherit',
  })
  execSync('kubectl rollout status deployment/oauth3 -n oauth3 --timeout=60s', {
    stdio: 'inherit',
  })

  console.log(`\n${'='.repeat(50)}`)
  console.log('Deployment complete.')
  console.log(
    'OAuth3 should now be available at: https://oauth3.testnet.jejunetwork.org',
  )
}

function createServerCode(indexHtml: string, appJs: string): string {
  // Escape the strings for embedding in JavaScript
  const escapeForJs = (str: string) => {
    return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
  }

  return `const http = require('http');
const crypto = require('crypto');

// In-memory stores
const sessions = new Map();
const clients = new Map();
const authCodes = new Map();
const walletChallenges = new Map();

// Pre-register default client for demo login
clients.set('jeju-default', { 
  clientId: 'jeju-default',
  name: 'Jeju Network Apps',
  redirectUris: [
    'https://*.jejunetwork.org/*',
    'http://localhost:*/*',
    'http://127.0.0.1:*/*'
  ],
  active: true
});

// Pre-register babylon client
clients.set('babylon', { 
  clientId: 'babylon',
  name: 'Babylon Game',
  redirectUris: ['http://localhost:5007/callback', 'https://babylon.game/callback'],
  active: true
});

// Pre-register eliza-cloud client
clients.set('eliza-cloud', {
  clientId: 'eliza-cloud',
  name: 'Eliza Cloud',
  redirectUris: [
    'https://cloud.elizaos.com/*',
    'https://eliza.cloud/*',
    'https://*.elizaos.ai/*',
    'http://localhost:3000/*',
    'http://localhost:3001/*'
  ],
  active: true
});

// Embedded HTML content
const INDEX_HTML = \`${escapeForJs(indexHtml)}\`;

// Embedded JS content
const APP_JS = \`${escapeForJs(appJs)}\`;

// Generate authorize page HTML
function generateAuthorizePage(clientName, clientId, redirectUri, state) {
  const encodedRedirectUri = encodeURIComponent(redirectUri);
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In - OAuth3</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0a0f;
      --card: #12121a;
      --border: rgba(99, 102, 241, 0.2);
      --primary: #6366f1;
      --primary-hover: #5558e3;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
    }
    .logo {
      font-size: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, #6366f1, #06b6d4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-align: center;
      margin-bottom: 24px;
    }
    .client-name {
      text-align: center;
      margin-bottom: 32px;
      color: var(--text-muted);
    }
    .providers {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .provider-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 20px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: var(--text);
      text-decoration: none;
      font-size: 16px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .provider-btn:hover {
      background: rgba(99, 102, 241, 0.15);
      border-color: var(--primary);
      transform: translateY(-2px);
    }
    .provider-btn.primary {
      background: var(--primary);
      border-color: var(--primary);
    }
    .provider-btn.primary:hover {
      background: var(--primary-hover);
    }
    .icon { font-size: 20px; }
    .divider {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 20px 0;
      color: var(--text-muted);
      font-size: 14px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }
    .footer {
      text-align: center;
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
    }
    .footer a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 14px;
    }
    .footer a:hover { color: var(--primary); }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo">JEJU</div>
    <div class="client-name">
      <strong>\${clientName}</strong> wants to sign you in
    </div>
    
    <nav class="providers">
      <a href="/wallet/challenge?client_id=\${clientId}&redirect_uri=\${encodedRedirectUri}&state=\${state}" class="provider-btn primary">
        <span class="icon">🔐</span>
        Connect Wallet
      </a>
      
      <a href="/farcaster/init?client_id=\${clientId}&redirect_uri=\${encodedRedirectUri}&state=\${state}" class="provider-btn">
        <span class="icon">🟣</span>
        Sign in with Farcaster
      </a>
      
      <div class="divider"><span>or continue with</span></div>
      
      <a href="/oauth/social/github?client_id=\${clientId}&redirect_uri=\${encodedRedirectUri}&state=\${state}" class="provider-btn">
        <span class="icon">🐙</span>
        GitHub
      </a>
      
      <a href="/oauth/social/google?client_id=\${clientId}&redirect_uri=\${encodedRedirectUri}&state=\${state}" class="provider-btn">
        <span class="icon">🔵</span>
        Google
      </a>
    </nav>
    
    <footer class="footer">
      <a href="https://jejunetwork.org">Jeju Network</a>
    </footer>
  </main>
</body>
</html>\`;
}

// Generate wallet connect page HTML
function generateWalletConnectPage(challengeId, message) {
  const escapedMessage = message.replace(/'/g, "\\\\'").replace(/\\n/g, '\\\\n');
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Wallet - OAuth3</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0a0f;
      --card: #12121a;
      --border: rgba(99, 102, 241, 0.2);
      --primary: #6366f1;
      --primary-hover: #5558e3;
      --success: #10b981;
      --error: #ef4444;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 100%;
    }
    .logo {
      font-size: 28px;
      font-weight: 700;
      text-align: center;
      margin-bottom: 24px;
    }
    .message-box {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-muted);
      white-space: pre-wrap;
      margin-bottom: 24px;
    }
    .btn {
      width: 100%;
      padding: 16px;
      border-radius: 12px;
      background: var(--primary);
      border: none;
      color: white;
      font-size: 16px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:hover:not(:disabled) {
      background: var(--primary-hover);
      transform: translateY(-2px);
    }
    .btn:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .status {
      margin-top: 16px;
      text-align: center;
      font-size: 14px;
      min-height: 20px;
    }
    .status.error { color: var(--error); }
    .status.success { color: var(--success); }
    .address-badge {
      font-family: 'JetBrains Mono', monospace;
      background: rgba(99, 102, 241, 0.2);
      padding: 2px 8px;
      border-radius: 4px;
    }
    .footer {
      text-align: center;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
    }
    .footer a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo">🔐 Wallet</div>
    
    <div class="message-box">\${message.replace(/\\n/g, '<br>')}</div>
    
    <button id="connectBtn" class="btn">Connect Wallet</button>
    
    <div id="status" class="status"></div>
    
    <footer class="footer">
      <a href="https://jejunetwork.org">Jeju Network</a>
    </footer>
  </main>
  <script>
    const challengeId = '\${challengeId}';
    const message = '\${escapedMessage}';
    
    async function connect() {
      const status = document.getElementById('status');
      const btn = document.getElementById('connectBtn');
      
      if (!window.ethereum) {
        status.textContent = 'No wallet found. Install MetaMask.';
        status.className = 'status error';
        return;
      }
      
      try {
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        status.textContent = '';
        status.className = 'status';
        
        const accounts = await window.ethereum.request({ 
          method: 'eth_requestAccounts' 
        });
        const address = accounts[0];
        
        btn.textContent = 'Sign Message...';
        status.innerHTML = 'Connected: <span class="address-badge">' + 
          address.slice(0, 6) + '...' + address.slice(-4) + '</span>';
        
        const signature = await window.ethereum.request({
          method: 'personal_sign',
          params: [message, address]
        });
        
        btn.textContent = 'Verifying...';
        
        const response = await fetch('/wallet/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeId, address, signature })
        });
        
        const result = await response.json();
        
        if (result.redirectUrl) {
          status.textContent = 'Success. Redirecting...';
          status.className = 'status success';
          window.location.href = result.redirectUrl;
        } else {
          throw new Error(result.error || 'Verification failed');
        }
        
      } catch (err) {
        console.error(err);
        status.textContent = err.message || 'Connection failed';
        status.className = 'status error';
        btn.disabled = false;
        btn.textContent = 'Try Again';
      }
    }
    
    document.getElementById('connectBtn').addEventListener('click', connect);
  </script>
</body>
</html>\`;
}

// Validate redirect URI against patterns (simple wildcard matching)
function validateRedirectUri(redirectUri, patterns) {
  for (const pattern of patterns) {
    // Exact match
    if (pattern === redirectUri) return true;
    // Wildcard match - split by * and check parts
    if (pattern === '*') return true;
    if (pattern.includes('*')) {
      const parts = pattern.split('*');
      let remaining = redirectUri;
      let match = true;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '') continue;
        const idx = remaining.indexOf(part);
        if (idx === -1) { match = false; break; }
        if (i === 0 && idx !== 0) { match = false; break; } // First part must be at start
        remaining = remaining.slice(idx + part.length);
      }
      if (match) return true;
    }
  }
  return false;
}

// Clean up expired items periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, challenge] of walletChallenges) {
    if (challenge.expiresAt < now) {
      walletChallenges.delete(key);
    }
  }
  for (const [key, code] of authCodes) {
    if (code.expiresAt < now) {
      authCodes.delete(key);
    }
  }
  for (const [key, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(key);
    }
  }
}, 60000);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
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
  
  // OAuth authorize endpoint - show provider selection
  if (url.pathname === '/oauth/authorize') {
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state') || crypto.randomUUID();
    
    if (!clientId || !redirectUri) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Missing client_id or redirect_uri' }));
      return;
    }
    
    const client = clients.get(clientId);
    if (!client || !client.active) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Unknown client' }));
      return;
    }
    
    if (!validateRedirectUri(redirectUri, client.redirectUris)) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Invalid redirect_uri' }));
      return;
    }
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(generateAuthorizePage(client.name, clientId, redirectUri, state));
    return;
  }
  
  // Wallet challenge endpoint
  if (url.pathname === '/wallet/challenge') {
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    
    if (!clientId || !redirectUri) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid_request' }));
      return;
    }
    
    const client = clients.get(clientId);
    if (!client || !client.active) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid_client' }));
      return;
    }
    
    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    const message = 'Jeju Network sign-in request.\\n\\n' +
      'Domain: oauth3.testnet.jejunetwork.org\\n' +
      'Nonce: ' + nonce + '\\n' +
      'Issued At: ' + timestamp + '\\n' +
      'URI: ' + redirectUri + '\\n\\n' +
      'No transaction will be sent. No gas fees.';
    
    walletChallenges.set(challengeId, {
      challengeId,
      message,
      clientId,
      redirectUri: decodeURIComponent(redirectUri),
      state,
      expiresAt: Date.now() + 5 * 60 * 1000
    });
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(generateWalletConnectPage(challengeId, message));
    return;
  }
  
  // Wallet verify endpoint
  if (url.pathname === '/wallet/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { challengeId, address, signature } = data;
        
        const challenge = walletChallenges.get(challengeId);
        if (!challenge) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid_challenge' }));
          return;
        }
        
        if (challenge.expiresAt < Date.now()) {
          walletChallenges.delete(challengeId);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'expired_challenge' }));
          return;
        }
        
        // In production, verify signature with eth_ecrecover
        // For testnet demo, we accept any valid-looking signature
        if (!signature || !signature.startsWith('0x') || signature.length < 130) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid_signature' }));
          return;
        }
        
        const userId = 'wallet:' + address.toLowerCase();
        const code = crypto.randomUUID();
        
        authCodes.set(code, {
          clientId: challenge.clientId,
          redirectUri: challenge.redirectUri,
          userId,
          scope: ['openid', 'profile'],
          expiresAt: Date.now() + 5 * 60 * 1000
        });
        
        // Create session
        const sessionId = crypto.randomUUID();
        sessions.set(sessionId, {
          sessionId,
          userId,
          provider: 'wallet',
          address: address.toLowerCase(),
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000
        });
        
        walletChallenges.delete(challengeId);
        
        const redirectUrl = new URL(challenge.redirectUri);
        redirectUrl.searchParams.set('code', code);
        if (challenge.state) {
          redirectUrl.searchParams.set('state', challenge.state);
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, redirectUrl: redirectUrl.toString() }));
      } catch (err) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'server_error' }));
      }
    });
    return;
  }
  
  // OAuth token endpoint
  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        if (data.grant_type === 'authorization_code') {
          const authCode = authCodes.get(data.code);
          
          if (!authCode) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Authorization code not found or expired' }));
            return;
          }
          
          if (authCode.clientId !== data.client_id) {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Client ID mismatch' }));
            return;
          }
          
          authCodes.delete(data.code);
          
          // Create new session with token
          const sessionId = crypto.randomUUID();
          const accessToken = 'at_' + crypto.randomBytes(32).toString('hex');
          const refreshToken = 'rt_' + crypto.randomBytes(32).toString('hex');
          
          sessions.set(sessionId, {
            sessionId,
            userId: authCode.userId,
            provider: 'wallet',
            address: authCode.userId.replace('wallet:', ''),
            createdAt: Date.now(),
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            accessToken
          });
          
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Set-Cookie', 'jeju_session=' + sessionId + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400');
          res.writeHead(200);
          res.end(JSON.stringify({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: refreshToken,
            scope: authCode.scope.join(' ')
          }));
          return;
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
      } catch (err) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'server_error' }));
      }
    });
    return;
  }
  
  // API info
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
  
  // Session check - supports cookie or query
  if (url.pathname === '/session') {
    if (req.method === 'DELETE') {
      // Logout - clear session
      const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
        const [key, val] = c.trim().split('=');
        acc[key] = val;
        return acc;
      }, {});
      
      if (cookies.jeju_session) {
        sessions.delete(cookies.jeju_session);
      }
      
      res.setHeader('Set-Cookie', 'jeju_session=; Path=/; HttpOnly; Max-Age=0');
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }
    
    // GET session
    const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
      const [key, val] = c.trim().split('=');
      acc[key] = val;
      return acc;
    }, {});
    
    const sessionId = cookies.jeju_session;
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (session && session.expiresAt > Date.now()) {
        res.writeHead(200);
        res.end(JSON.stringify({ 
          authenticated: true, 
          session: {
            sessionId: session.sessionId,
            userId: session.userId,
            provider: session.provider,
            address: session.address,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt
          }
        }));
        return;
      }
    }
    
    res.writeHead(200);
    res.end(JSON.stringify({ authenticated: false }));
    return;
  }
  
  if (url.pathname === '/api') {
    res.writeHead(200);
    res.end(JSON.stringify({
      name: 'Jeju OAuth3 Gateway (Testnet)',
      version: '1.0.0-testnet',
      endpoints: {
        authorize: '/oauth/authorize',
        token: '/oauth/token',
        session: '/session',
        wallet: '/wallet/challenge'
      }
    }));
    return;
  }
  
  // Direct wallet auth endpoint - used by OAuth3 SDK
  if (url.pathname === '/auth/wallet' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { address, signature, message, appId = 'jeju-default' } = data;
        
        // Validate address format
        if (!address || !address.startsWith('0x') || address.length !== 42) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid_address' }));
          return;
        }
        
        // Validate signature format
        if (!signature || !signature.startsWith('0x') || signature.length < 130) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid_signature' }));
          return;
        }
        
        // Validate message contains sign-in request (SIWE-style)
        const validDomains = ['oauth3.testnet.jejunetwork.org', 'oauth3.jejunetwork.org', 'crucible', 'localhost', 'wants you to sign in'];
        const hasValidDomain = validDomains.some(d => message && message.includes(d));
        if (!hasValidDomain) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid_message', message: 'Message must be a valid sign-in request' }));
          return;
        }
        
        // In production, verify signature with eth_ecrecover
        // For testnet, we accept any valid-looking signature
        
        // Create session
        const sessionId = '0x' + crypto.randomBytes(16).toString('hex');
        const userId = 'wallet:' + address.toLowerCase();
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
        
        sessions.set(sessionId, {
          sessionId,
          userId,
          provider: 'wallet',
          address: address.toLowerCase(),
          createdAt: Date.now(),
          expiresAt,
          metadata: { appId }
        });
        
        console.log('[OAuth3] Direct wallet auth session created:', sessionId.substring(0, 10) + '...', address.substring(0, 6) + '...');
        
        // Return session in OAuth3Session format expected by the SDK
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({
          sessionId,
          identityId: sessionId,
          smartAccount: address,
          expiresAt,
          capabilities: ['sign_message', 'sign_transaction'],
          signingPublicKey: '0x', // Simulated for testnet
          attestation: {
            quote: '0x',
            measurement: '0x',
            reportData: '0x',
            timestamp: Date.now(),
            platform: 'simulated',
            verified: false
          }
        }));
      } catch (err) {
        console.error('[OAuth3] Direct wallet auth error:', err);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'server_error' }));
      }
    });
    return;
  }
  
  // Social OAuth providers - redirect with "not configured" message for testnet
  if (url.pathname.startsWith('/oauth/social/') || url.pathname.startsWith('/farcaster/')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(\`<!DOCTYPE html>
<html><head><title>Provider Not Available</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0f;color:#e2e8f0;}
.card{background:#12121a;border:1px solid rgba(99,102,241,0.2);border-radius:16px;padding:32px;text-align:center;max-width:400px;}
h1{font-size:24px;margin-bottom:16px;}
p{color:#94a3b8;margin-bottom:24px;}
a{color:#6366f1;}</style></head>
<body><div class="card"><h1>Provider Not Available</h1>
<p>This authentication provider is not configured on testnet. Please use Wallet sign-in for the demo.</p>
<a href="javascript:history.back()">Go Back</a></div></body></html>\`);
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 4200;
server.listen(PORT, '0.0.0.0', () => {
  console.log('OAuth3 testnet service running on port ' + PORT);
  console.log('Registered clients: ' + Array.from(clients.keys()).join(', '));
});`
}

deploy().catch((err) => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
