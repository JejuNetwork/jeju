/**
 * Otto Trading Agent - ElizaOS Runtime Server
 * Provides HTTP API and integrates with ElizaOS plugins
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { getConfig } from './config';
import { getStateManager } from './services/state';
import { chatApi } from './web/chat-api';
import { frameApi } from './web/frame';
import { miniappApi } from './web/miniapp';

// Re-export for use by ElizaOS agents
export { ottoPlugin, ottoCharacter } from './eliza';

const config = getConfig();
const stateManager = getStateManager();

// ============================================================================
// HTTP Server
// ============================================================================

const app = new Hono();

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'X-Wallet-Address'],
}));

// Health & Status
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    agent: 'otto',
    version: '1.0.0',
    runtime: 'elizaos',
  });
});

app.get('/status', (c) => {
  return c.json({
    name: 'Otto Trading Agent',
    version: '1.0.0',
    runtime: 'elizaos',
    platforms: {
      discord: { enabled: config.discord.enabled },
      telegram: { enabled: config.telegram.enabled },
      twitter: { enabled: config.twitter.enabled },
      farcaster: { enabled: config.farcaster.enabled },
    },
    chains: config.trading.supportedChains,
  });
});

// API Routes
app.get('/api/chains', (c) => {
  return c.json({
    chains: config.trading.supportedChains,
    defaultChainId: config.trading.defaultChainId,
  });
});

app.get('/api/info', (c) => {
  return c.json({
    name: 'Otto',
    description: 'ElizaOS-powered trading agent for Jeju Network',
    version: '1.0.0',
    runtime: 'elizaos',
    platforms: ['discord', 'telegram', 'twitter', 'farcaster', 'web'],
    features: ['swap', 'bridge', 'send', 'launch', 'portfolio', 'limit-orders', 'cross-chain'],
    miniapps: {
      telegram: `${config.baseUrl}/miniapp/telegram`,
      farcaster: `${config.baseUrl}/miniapp/farcaster`,
      web: `${config.baseUrl}/miniapp/`,
    },
    frame: `${config.baseUrl}/frame`,
  });
});

// Chat API (uses local message processor)
app.route('/api/chat', chatApi);

// Farcaster Frame
app.route('/frame', frameApi);

// Miniapps
app.route('/miniapp', miniappApi);
app.get('/miniapp/', (c) => c.redirect('/miniapp'));
app.get('/', (c) => c.redirect('/miniapp'));

// Wallet connect page
app.get('/auth/connect', (c) => {
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <title>Connect to Otto</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: system-ui;
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
    }
    .container { text-align: center; padding: 2rem; max-width: 400px; }
    h1 { margin-bottom: 0.5rem; }
    p { color: #888; margin-bottom: 2rem; }
    .btn {
      display: block;
      width: 100%;
      padding: 16px;
      margin: 8px 0;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary {
      background: linear-gradient(135deg, #00d4ff, #0099ff);
      color: #000;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Otto</h1>
    <p>ElizaOS Trading Agent</p>
    <button class="btn btn-primary" onclick="connectWallet()">Connect Wallet</button>
  </div>
  <script>
    async function connectWallet() {
      if (!window.ethereum) { alert('Install MetaMask'); return; }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      const res = await fetch('/api/chat/auth/message?address=' + address);
      const { message } = await res.json();
      const sig = await window.ethereum.request({ method: 'personal_sign', params: [message, address] });
      const session = new URLSearchParams(location.search).get('session');
      await fetch('/api/chat/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, message, signature: sig, sessionId: session }),
      });
      if (window.opener) window.opener.postMessage({ type: 'wallet_connected', address }, '*');
      window.close();
    }
  </script>
</body>
</html>`);
});

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('       Otto Trading Agent');
  console.log('         ElizaOS Runtime');
  console.log('========================================');
  console.log('');
  
  // Start limit order monitor
  stateManager.startLimitOrderMonitor();
  
  // Start HTTP server
  const port = config.port;
  
  console.log(`HTTP server: http://localhost:${port}`);
  console.log(`   Health: http://localhost:${port}/health`);
  console.log(`   Status: http://localhost:${port}/status`);
  console.log('');
  console.log('Miniapps:');
  console.log(`   Web:       http://localhost:${port}/miniapp/`);
  console.log(`   Telegram:  http://localhost:${port}/miniapp/telegram`);
  console.log(`   Farcaster: http://localhost:${port}/miniapp/farcaster`);
  console.log('');
  console.log(`Frame: http://localhost:${port}/frame`);
  console.log(`API:   http://localhost:${port}/api/chat`);
  console.log('');
  console.log('ElizaOS Plugin: ottoPlugin');
  console.log('ElizaOS Character: ottoCharacter');
  console.log('');
  console.log('To use with ElizaOS:');
  console.log('  import { ottoPlugin, ottoCharacter } from "@jejunetwork/otto"');
  console.log('');
  console.log('========================================');
  
  serve({ fetch: app.fetch, port });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Otto] Shutting down...');
  stateManager.stopLimitOrderMonitor();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Otto] Shutting down...');
  stateManager.stopLimitOrderMonitor();
  process.exit(0);
});

main().catch(err => {
  console.error('[Otto] Fatal error:', err);
  process.exit(1);
});

export { app };
