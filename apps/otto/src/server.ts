/**
 * Otto Trading Agent - ElizaOS Runtime Server
 * Provides HTTP API and integrates with ElizaOS plugins
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { getConfig } from './config'
import {
  DiscordWebhookPayloadSchema,
  expectValid,
  FarcasterFramePayloadSchema,
  TelegramWebhookPayloadSchema,
  TwilioWebhookPayloadSchema,
  TwitterWebhookPayloadSchema,
} from './schemas'
import { getStateManager } from './services/state'
import {
  validateAddress,
  validateHex,
  validateNonce,
  validatePlatform,
} from './utils/validation'
import { chatApi } from './web/chat-api'
import { frameApi } from './web/frame'
import { miniappApi } from './web/miniapp'

// Re-export for use by ElizaOS agents
export { ottoCharacter, ottoPlugin } from './eliza'

const config = getConfig()
const stateManager = getStateManager()

// ============================================================================
// HTTP Server
// ============================================================================

const app = new Hono()

// CORS Configuration
// In production, OTTO_ALLOWED_ORIGINS should be set to restrict cross-origin access
// e.g., OTTO_ALLOWED_ORIGINS=https://otto.jeju.network,https://app.jeju.network
const allowedOrigins = process.env.OTTO_ALLOWED_ORIGINS?.split(',') ?? []
const corsOrigin =
  allowedOrigins.length > 0
    ? (origin: string) =>
        allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
    : '*' // Development: allow all origins

app.use(
  '/*',
  cors({
    origin: corsOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Session-Id',
      'X-Wallet-Address',
    ],
  }),
)

// Health & Status
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    agent: 'otto',
    version: '1.0.0',
    runtime: 'elizaos',
  })
})

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
  })
})

// ============================================================================
// Webhooks
// ============================================================================

// Discord webhook (for interactions API)
app.post('/webhooks/discord', async (c) => {
  const rawPayload = await c.req.json()
  const payload = expectValid(
    DiscordWebhookPayloadSchema,
    rawPayload,
    'Discord webhook',
  )

  // Discord requires immediate response for interaction verification
  if (payload.type === 1) {
    // PING - respond with PONG
    return c.json({ type: 1 })
  }

  // Acknowledge receipt
  return c.json({ type: 5 }) // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
})

// Constant-time string comparison to prevent timing attacks
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// Telegram webhook
app.post('/webhooks/telegram', async (c) => {
  // Verify secret token if configured - use constant-time comparison to prevent timing attacks
  if (config.telegram.webhookSecret) {
    const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token')
    if (
      !secretToken ||
      !constantTimeCompare(secretToken, config.telegram.webhookSecret)
    ) {
      return c.json({ error: 'Invalid secret token' }, 403)
    }
  }

  const rawPayload = await c.req.json()
  expectValid(TelegramWebhookPayloadSchema, rawPayload, 'Telegram webhook')

  return c.json({ ok: true })
})

// WhatsApp webhook (Twilio)
app.post('/webhooks/whatsapp', async (c) => {
  // Parse form data (Twilio sends as application/x-www-form-urlencoded)
  const formData = await c.req.parseBody()

  const rawPayload = {
    MessageSid: String(formData.MessageSid ?? ''),
    From: String(formData.From ?? ''),
    To: String(formData.To ?? ''),
    Body: String(formData.Body ?? ''),
    NumMedia: String(formData.NumMedia ?? '0'),
    MediaUrl0: formData.MediaUrl0 ? String(formData.MediaUrl0) : undefined,
  }

  expectValid(TwilioWebhookPayloadSchema, rawPayload, 'WhatsApp webhook')

  // Return empty TwiML response
  c.header('Content-Type', 'text/xml')
  return c.body('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
})

// WhatsApp webhook verification (Twilio)
app.get('/webhooks/whatsapp', (c) => {
  // Twilio may send GET for verification
  return c.text('OK')
})

// Farcaster Frame webhook
app.post('/webhooks/farcaster', async (c) => {
  const rawPayload = await c.req.json()
  expectValid(FarcasterFramePayloadSchema, rawPayload, 'Farcaster webhook')

  return c.json({ ok: true })
})

// Twitter webhook (Account Activity API)
app.post('/webhooks/twitter', async (c) => {
  const rawPayload = await c.req.json()
  expectValid(TwitterWebhookPayloadSchema, rawPayload, 'Twitter webhook')

  return c.json({ ok: true })
})

// Twitter webhook verification (CRC challenge)
app.get('/webhooks/twitter', async (c) => {
  const crcTokenParam = c.req.query('crc_token')
  if (!crcTokenParam) {
    return c.text('Missing crc_token', 400)
  }

  const apiSecret = process.env.TWITTER_API_SECRET ?? ''
  if (!apiSecret) {
    throw new Error('TWITTER_API_SECRET is required for CRC verification')
  }

  // Generate CRC response
  const crypto = await import('node:crypto')
  const hmac = crypto.createHmac('sha256', apiSecret)
  hmac.update(crcTokenParam)
  const responseToken = `sha256=${hmac.digest('base64')}`

  return c.json({ response_token: responseToken })
})

// ============================================================================
// API Routes
// ============================================================================

app.get('/api/chains', (c) => {
  return c.json({
    chains: config.trading.supportedChains,
    defaultChainId: config.trading.defaultChainId,
  })
})

app.get('/api/info', (c) => {
  return c.json({
    name: 'Otto',
    description: 'ElizaOS-powered trading agent for Jeju Network',
    version: '1.0.0',
    runtime: 'elizaos',
    platforms: ['discord', 'telegram', 'twitter', 'farcaster', 'web'],
    features: [
      'swap',
      'bridge',
      'send',
      'launch',
      'portfolio',
      'limit-orders',
      'cross-chain',
    ],
    miniapps: {
      telegram: `${config.baseUrl}/miniapp/telegram`,
      farcaster: `${config.baseUrl}/miniapp/farcaster`,
      web: `${config.baseUrl}/miniapp/`,
    },
    frame: `${config.baseUrl}/frame`,
  })
})

// Chat API (uses local message processor)
app.route('/api/chat', chatApi)

// Farcaster Frame
app.route('/frame', frameApi)

// Miniapps
app.route('/miniapp', miniappApi)
app.get('/miniapp/', (c) => c.redirect('/miniapp'))
app.get('/', (c) => c.redirect('/miniapp'))

// Auth callback
app.get('/auth/callback', async (c) => {
  const { address, signature, platform, platformId, nonce } = c.req.query()

  if (!address || !signature || !platform || !platformId || !nonce) {
    return c.html(
      `<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Connection Failed</h1><p>Missing required parameters.</p></body></html>`,
    )
  }

  // Validate parameters with fail-fast - this ensures address is a valid 0x hex address
  validateAddress(address)
  validateHex(signature)
  validatePlatform(platform)
  expectValid(z.string().min(1), platformId, 'auth callback platformId')
  validateNonce(nonce)

  // After validation, address is guaranteed to be 0x + 40 hex chars (safe for display)
  // Extract only the validated hex characters for display
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`

  return c.html(`<!DOCTYPE html>
<html>
<head>
  <title>Connected</title>
  <style>
    body { font-family: system-ui; background: #1a1a2e; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #00d4ff; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Wallet Connected</h1>
    <p>Address: ${shortAddress}</p>
    <p>You can close this window.</p>
  </div>
</body>
</html>`)
})

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
    function isValidAddress(addr) {
      return /^0x[a-fA-F0-9]{40}$/.test(addr);
    }
    
    async function connectWallet() {
      if (!window.ethereum) { alert('Install MetaMask'); return; }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      
      // Validate address format before using
      if (!isValidAddress(address)) {
        alert('Invalid address format');
        return;
      }
      
      const res = await fetch('/api/chat/auth/message?address=' + encodeURIComponent(address));
      const { message } = await res.json();
      const sig = await window.ethereum.request({ method: 'personal_sign', params: [message, address] });
      const session = new URLSearchParams(location.search).get('session');
      await fetch('/api/chat/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, message, signature: sig, sessionId: session }),
      });
      if (window.opener) {
        // Only post validated address
        window.opener.postMessage({ type: 'wallet_connected', address }, window.location.origin);
      }
      window.close();
    }
  </script>
</body>
</html>`)
})

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('========================================')
  console.log('       Otto Trading Agent')
  console.log('         ElizaOS Runtime')
  console.log('========================================')
  console.log('')

  // Limit order monitor will be started when trading service is ready

  // Start HTTP server
  const port = config.port

  console.log(`HTTP server: http://localhost:${port}`)
  console.log(`   Health: http://localhost:${port}/health`)
  console.log(`   Status: http://localhost:${port}/status`)
  console.log('')
  console.log('Miniapps:')
  console.log(`   Web:       http://localhost:${port}/miniapp/`)
  console.log(`   Telegram:  http://localhost:${port}/miniapp/telegram`)
  console.log(`   Farcaster: http://localhost:${port}/miniapp/farcaster`)
  console.log('')
  console.log(`Frame: http://localhost:${port}/frame`)
  console.log(`API:   http://localhost:${port}/api/chat`)
  console.log('')
  console.log('ElizaOS Plugin: ottoPlugin')
  console.log('ElizaOS Character: ottoCharacter')
  console.log('')
  console.log('To use with ElizaOS:')
  console.log('  import { ottoPlugin, ottoCharacter } from "@jejunetwork/otto"')
  console.log('')
  console.log('========================================')

  serve({ fetch: app.fetch, port })
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Otto] Shutting down...')
  stateManager.stopLimitOrderMonitor()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n[Otto] Shutting down...')
  stateManager.stopLimitOrderMonitor()
  process.exit(0)
})

main().catch((err: Error) => {
  const errorMessage = err instanceof Error ? err.message : String(err)
  console.error('[Otto] Fatal error:', errorMessage)
  process.exit(1)
})

export { app }
