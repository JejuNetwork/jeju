/**
 * VPN Web Routes
 *
 * Serves lander pages, Telegram miniapp, and Farcaster frames.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Elysia } from 'elysia'
import { config } from './config'

const APP_DIR = resolve(import.meta.dir, '..')

function getBaseUrl(): string {
  return config.publicUrl || 'https://vpn.jejunetwork.org'
}

function getLanderHtml(): string {
  const landerPath = join(APP_DIR, 'dist/lander/index.html')
  if (existsSync(landerPath)) {
    return readFileSync(landerPath, 'utf-8')
  }

  const devLanderPath = join(APP_DIR, 'lander/index.html')
  if (existsSync(devLanderPath)) {
    return readFileSync(devLanderPath, 'utf-8')
  }

  return generateLanderHtml()
}

function generateLanderHtml(): string {
  const baseUrl = getBaseUrl()

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jeju VPN — Free Decentralized VPN</title>
  <meta name="description" content="Free, decentralized VPN powered by the community. Unlimited VPN access in exchange for contributing bandwidth.">
  
  <!-- OpenGraph -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${baseUrl}">
  <meta property="og:title" content="Jeju VPN — Free Decentralized VPN">
  <meta property="og:description" content="Unlimited VPN access powered by the community. No subscriptions, no hidden fees.">
  <meta property="og:image" content="${baseUrl}/og-image.png">
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Jeju VPN — Free Decentralized VPN">
  <meta name="twitter:description" content="Unlimited VPN access powered by the community.">
  
  <!-- Farcaster Frame -->
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="${baseUrl}/frame/image">
  <meta property="fc:frame:button:1" content="Get VPN">
  <meta property="fc:frame:post_url" content="${baseUrl}/frame">
  
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI4IiBmaWxsPSIjMDBmZjg4Ii8+PHBhdGggZD0iTTE2IDdhOCA4IDAgMCAxIDggOHY0YTggOCAwIDEgMS0xNiAwdi00YTggOCAwIDAgMSA4LTh6IiBmaWxsPSIjMGEwYTBmIi8+PC9zdmc+">
  
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            vpn: { green: '#00ff88', 'green-dark': '#00cc6a', cyan: '#00d4ff', dark: '#0a0a0f', darker: '#050508' },
            surface: { DEFAULT: '#0a0a0f', elevated: 'rgba(20, 20, 30, 0.7)', border: 'rgba(255, 255, 255, 0.08)' }
          },
          fontFamily: { sans: ['system-ui', '-apple-system', 'sans-serif'] }
        }
      }
    }
  </script>
  <style>
    .gradient-text {
      background: linear-gradient(135deg, #00ff88 0%, #00d4ff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .glow-green { box-shadow: 0 0 60px rgba(0, 255, 136, 0.3); }
  </style>
</head>
<body class="bg-vpn-darker text-white antialiased min-h-screen flex flex-col items-center justify-center p-6">
  <div class="text-center max-w-2xl">
    <div class="w-20 h-20 bg-vpn-green rounded-2xl flex items-center justify-center mx-auto mb-8 glow-green">
      <svg class="w-10 h-10 text-vpn-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    </div>
    
    <h1 class="text-5xl font-bold mb-4">
      <span class="gradient-text">Jeju VPN</span>
    </h1>
    
    <p class="text-xl text-white/60 mb-8">
      Free, decentralized VPN powered by the community.<br>
      Unlimited access in exchange for contributing bandwidth.
    </p>
    
    <div class="flex flex-col sm:flex-row gap-4 justify-center">
      <a href="/api/releases/download/chrome" class="bg-vpn-green text-vpn-dark px-8 py-4 rounded-xl font-semibold hover:bg-vpn-green-dark transition-colors inline-flex items-center gap-2">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0z"/></svg>
        Install for Chrome
      </a>
      <a href="/miniapp" class="border-2 border-white/20 text-white px-8 py-4 rounded-xl font-semibold hover:border-vpn-green hover:text-vpn-green transition-colors">
        Open Web App
      </a>
    </div>
    
    <p class="mt-8 text-sm text-white/40">
      Also available for <a href="/api/releases/download/firefox" class="text-vpn-green hover:underline">Firefox</a> and <a href="/api/releases/download/edge" class="text-vpn-green hover:underline">Edge</a>
    </p>
  </div>
</body>
</html>`
}

function generateMiniappHtml(platform: 'web' | 'telegram' | 'farcaster'): string {
  const baseUrl = getBaseUrl()

  const telegramScript =
    platform === 'telegram'
      ? '<script src="https://telegram.org/js/telegram-web-app.js"></script>'
      : ''

  const telegramInit =
    platform === 'telegram'
      ? `if(window.Telegram?.WebApp){Telegram.WebApp.ready();Telegram.WebApp.expand();}`
      : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Jeju VPN</title>
  ${telegramScript}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #0a0a0f 0%, #050508 100%);
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header-icon {
      width: 36px;
      height: 36px;
      background: #00ff88;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .header-icon svg { width: 20px; height: 20px; color: #0a0a0f; }
    .header h1 { font-size: 18px; font-weight: 600; }
    .content { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .status-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 24px;
      text-align: center;
    }
    .status-indicator {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      margin: 0 auto 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s;
    }
    .status-indicator.disconnected { background: rgba(255,255,255,0.1); }
    .status-indicator.connected { background: rgba(0,255,136,0.2); box-shadow: 0 0 40px rgba(0,255,136,0.3); }
    .status-indicator.connecting { background: rgba(255,191,36,0.2); animation: pulse 1.5s infinite; }
    .status-indicator svg { width: 40px; height: 40px; }
    .status-text { font-size: 14px; color: rgba(255,255,255,0.6); margin-bottom: 4px; }
    .status-value { font-size: 20px; font-weight: 600; }
    .status-value.connected { color: #00ff88; }
    .status-value.connecting { color: #fbbf24; }
    .connect-btn {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .connect-btn.connect { background: #00ff88; color: #0a0a0f; }
    .connect-btn.connect:hover { background: #00cc6a; }
    .connect-btn.disconnect { background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
    .connect-btn.disconnect:hover { background: rgba(239,68,68,0.3); }
    .connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .nodes-section { margin-top: 8px; }
    .nodes-title { font-size: 14px; color: rgba(255,255,255,0.6); margin-bottom: 12px; }
    .nodes-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .node-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 12px 8px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .node-btn:hover { border-color: rgba(0,255,136,0.3); }
    .node-btn.selected { border-color: #00ff88; background: rgba(0,255,136,0.1); }
    .node-flag { font-size: 24px; margin-bottom: 4px; }
    .node-code { font-size: 12px; color: rgba(255,255,255,0.6); }
    .stats-row { display: flex; gap: 12px; }
    .stat-card {
      flex: 1;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 16px;
    }
    .stat-label { font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 4px; }
    .stat-value { font-size: 18px; font-weight: 600; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    </div>
    <h1>Jeju VPN</h1>
  </div>

  <div class="content">
    <div class="status-card">
      <div class="status-indicator disconnected" id="status-indicator">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <p class="status-text">Status</p>
      <p class="status-value" id="status-text">Disconnected</p>
    </div>

    <button class="connect-btn connect" id="connect-btn">Connect</button>

    <div class="nodes-section">
      <p class="nodes-title">Select Region</p>
      <div class="nodes-grid" id="nodes-grid">
        <div class="node-btn selected" data-country="auto">
          <div class="node-flag">🌐</div>
          <div class="node-code">Auto</div>
        </div>
        <div class="node-btn" data-country="US">
          <div class="node-flag">🇺🇸</div>
          <div class="node-code">US</div>
        </div>
        <div class="node-btn" data-country="NL">
          <div class="node-flag">🇳🇱</div>
          <div class="node-code">NL</div>
        </div>
        <div class="node-btn" data-country="DE">
          <div class="node-flag">🇩🇪</div>
          <div class="node-code">DE</div>
        </div>
        <div class="node-btn" data-country="JP">
          <div class="node-flag">🇯🇵</div>
          <div class="node-code">JP</div>
        </div>
        <div class="node-btn" data-country="SG">
          <div class="node-flag">🇸🇬</div>
          <div class="node-code">SG</div>
        </div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <p class="stat-label">Downloaded</p>
        <p class="stat-value" id="stat-down">0 MB</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Uploaded</p>
        <p class="stat-value" id="stat-up">0 MB</p>
      </div>
    </div>
  </div>

  <script>
    const API = '${baseUrl}/api/v1';
    let connected = false;
    let sessionId = null;
    let selectedCountry = 'auto';

    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const connectBtn = document.getElementById('connect-btn');
    const nodesGrid = document.getElementById('nodes-grid');

    ${telegramInit}

    // Node selection
    nodesGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.node-btn');
      if (!btn || connected) return;
      
      nodesGrid.querySelectorAll('.node-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCountry = btn.dataset.country;
    });

    async function connect() {
      if (connected) {
        await disconnect();
        return;
      }

      indicator.className = 'status-indicator connecting';
      statusText.textContent = 'Connecting...';
      statusText.className = 'status-value connecting';
      connectBtn.disabled = true;

      const body = selectedCountry === 'auto' 
        ? {} 
        : { countryCode: selectedCountry };

      const res = await fetch(API + '/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const data = await res.json();
        sessionId = data.sessionId;
        connected = true;
        
        indicator.className = 'status-indicator connected';
        statusText.textContent = 'Connected';
        statusText.className = 'status-value connected';
        connectBtn.textContent = 'Disconnect';
        connectBtn.className = 'connect-btn disconnect';
      } else {
        indicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Connection Failed';
        statusText.className = 'status-value';
      }

      connectBtn.disabled = false;
    }

    async function disconnect() {
      if (!sessionId) return;

      connectBtn.disabled = true;
      
      await fetch(API + '/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });

      connected = false;
      sessionId = null;
      
      indicator.className = 'status-indicator disconnected';
      statusText.textContent = 'Disconnected';
      statusText.className = 'status-value';
      connectBtn.textContent = 'Connect';
      connectBtn.className = 'connect-btn connect';
      connectBtn.disabled = false;
    }

    connectBtn.addEventListener('click', connect);

    // Stats polling
    setInterval(async () => {
      if (!connected || !sessionId) return;
      
      const res = await fetch(API + '/session/' + sessionId + '/stats');
      if (res.ok) {
        const stats = await res.json();
        document.getElementById('stat-down').textContent = formatBytes(stats.bytesReceived || 0);
        document.getElementById('stat-up').textContent = formatBytes(stats.bytesSent || 0);
      }
    }, 2000);

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
  </script>
</body>
</html>`
}

function generateFrameImageSvg(): string {
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a0f"/>
      <stop offset="100%" style="stop-color:#050508"/>
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#00ff88"/>
      <stop offset="100%" style="stop-color:#00d4ff"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="600" cy="250" r="80" fill="none" stroke="url(#glow)" stroke-width="4"/>
  <path d="M600 190 L600 310" stroke="url(#glow)" stroke-width="4" stroke-linecap="round"/>
  <circle cx="600" cy="190" r="8" fill="#00ff88"/>
  <text x="600" y="400" font-family="system-ui" font-size="48" font-weight="bold" fill="white" text-anchor="middle">Jeju VPN</text>
  <text x="600" y="460" font-family="system-ui" font-size="24" fill="rgba(255,255,255,0.6)" text-anchor="middle">Free Decentralized VPN</text>
  <text x="600" y="520" font-family="system-ui" font-size="20" fill="#00ff88" text-anchor="middle">Tap to Get Started</text>
</svg>`
}

export function createWebRouter() {
  return new Elysia()
    .get('/lander', ({ set }) => {
      set.headers['Content-Type'] = 'text/html'
      return getLanderHtml()
    })
    .get('/miniapp', ({ set }) => {
      set.headers['Content-Type'] = 'text/html'
      return generateMiniappHtml('web')
    })
    .get('/miniapp/', ({ set }) => {
      set.headers['Content-Type'] = 'text/html'
      return generateMiniappHtml('web')
    })
    .get('/miniapp/telegram', ({ set }) => {
      set.headers['Content-Type'] = 'text/html'
      return generateMiniappHtml('telegram')
    })
    .get('/miniapp/farcaster', ({ set }) => {
      set.headers['Content-Type'] = 'text/html'
      return generateMiniappHtml('farcaster')
    })
    .get('/frame/image', ({ set }) => {
      set.headers['Content-Type'] = 'image/svg+xml'
      set.headers['Cache-Control'] = 'public, max-age=3600'
      return generateFrameImageSvg()
    })
    .post('/frame', ({ set }) => {
      const baseUrl = getBaseUrl()
      set.headers['Content-Type'] = 'text/html'

      return `<!DOCTYPE html>
<html>
<head>
  <meta property="fc:frame" content="vNext">
  <meta property="fc:frame:image" content="${baseUrl}/frame/image">
  <meta property="fc:frame:button:1" content="Install Extension">
  <meta property="fc:frame:button:1:action" content="link">
  <meta property="fc:frame:button:1:target" content="${baseUrl}/lander">
  <meta property="fc:frame:button:2" content="Open Miniapp">
  <meta property="fc:frame:button:2:action" content="link">
  <meta property="fc:frame:button:2:target" content="${baseUrl}/miniapp/farcaster">
</head>
<body></body>
</html>`
    })
}
