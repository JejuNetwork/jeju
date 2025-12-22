/**
 * Otto Trading Agent - ElizaOS Runtime Server
 * Provides HTTP API and integrates with ElizaOS plugins
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
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

// CORS Configuration
// In production, OTTO_ALLOWED_ORIGINS should be set to restrict cross-origin access
// e.g., OTTO_ALLOWED_ORIGINS=https://otto.jeju.network,https://app.jeju.network
const allowedOrigins = process.env.OTTO_ALLOWED_ORIGINS?.split(',') ?? []

const app = new Elysia()
  .use(
    cors({
      origin:
        allowedOrigins.length > 0
          ? (request) => {
              const origin = request.headers.get('origin') ?? ''
              return allowedOrigins.includes(origin)
            }
          : true, // Development: allow all origins
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Session-Id',
        'X-Wallet-Address',
      ],
    }),
  )

  // Health & Status
  .get('/health', () => ({
    status: 'healthy',
    agent: 'otto',
    version: '1.0.0',
    runtime: 'elizaos',
  }))

  .get('/status', () => ({
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
  }))

  // ============================================================================
  // Webhooks
  // ============================================================================

  // Discord webhook (for interactions API)
  .post('/webhooks/discord', ({ body }) => {
    const payload = expectValid(
      DiscordWebhookPayloadSchema,
      body,
      'Discord webhook',
    )

    // Discord requires immediate response for interaction verification
    if (payload.type === 1) {
      // PING - respond with PONG
      return { type: 1 }
    }

    // Acknowledge receipt
    return { type: 5 } // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  })

  // Telegram webhook
  .post('/webhooks/telegram', ({ body, request, set }) => {
    // Verify secret token if configured - use constant-time comparison to prevent timing attacks
    if (config.telegram.webhookSecret) {
      const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
      if (
        !secretToken ||
        !constantTimeCompare(secretToken, config.telegram.webhookSecret)
      ) {
        set.status = 403
        return { error: 'Invalid secret token' }
      }
    }

    expectValid(TelegramWebhookPayloadSchema, body, 'Telegram webhook')

    return { ok: true }
  })

  // WhatsApp webhook (Twilio)
  .post('/webhooks/whatsapp', async ({ request, set }) => {
    // Parse form data (Twilio sends as application/x-www-form-urlencoded)
    const formData = await request.formData()

    const rawPayload = {
      MessageSid: String(formData.get('MessageSid') ?? ''),
      From: String(formData.get('From') ?? ''),
      To: String(formData.get('To') ?? ''),
      Body: String(formData.get('Body') ?? ''),
      NumMedia: String(formData.get('NumMedia') ?? '0'),
      MediaUrl0: formData.get('MediaUrl0')
        ? String(formData.get('MediaUrl0'))
        : undefined,
    }

    expectValid(TwilioWebhookPayloadSchema, rawPayload, 'WhatsApp webhook')

    // Return empty TwiML response
    set.headers['Content-Type'] = 'text/xml'
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
  })

  // WhatsApp webhook verification (Twilio)
  .get('/webhooks/whatsapp', () => 'OK')

  // Farcaster Frame webhook
  .post('/webhooks/farcaster', ({ body }) => {
    expectValid(FarcasterFramePayloadSchema, body, 'Farcaster webhook')
    return { ok: true }
  })

  // Twitter webhook (Account Activity API)
  .post('/webhooks/twitter', ({ body }) => {
    expectValid(TwitterWebhookPayloadSchema, body, 'Twitter webhook')
    return { ok: true }
  })

  // Twitter webhook verification (CRC challenge)
  .get('/webhooks/twitter', async ({ query, set }) => {
    const crcTokenParam = query.crc_token
    if (!crcTokenParam) {
      set.status = 400
      return 'Missing crc_token'
    }

    const apiSecret = process.env.TWITTER_API_SECRET ?? ''
    if (!apiSecret) {
      throw new Error('TWITTER_API_SECRET is required for CRC verification')
    }

    // Conditional import: only loaded when Twitter webhook verification is needed
    const crypto = await import('node:crypto')
    const hmac = crypto.createHmac('sha256', apiSecret)
    hmac.update(crcTokenParam)
    const responseToken = `sha256=${hmac.digest('base64')}`

    return { response_token: responseToken }
  })

  // ============================================================================
  // API Routes
  // ============================================================================

  .get('/api/chains', () => ({
    chains: config.trading.supportedChains,
    defaultChainId: config.trading.defaultChainId,
  }))

  .get('/api/info', () => ({
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
  }))

  // Chat API (uses local message processor)
  .use(chatApi)

  // Farcaster Frame
  .use(frameApi)

  // Miniapps
  .use(miniappApi)
  .get('/miniapp/', ({ set }) => {
    set.redirect = '/miniapp'
  })
  .get('/', ({ set }) => {
    set.redirect = '/miniapp'
  })

  // Auth callback
  .get('/auth/callback', ({ query, set }) => {
    const { address, signature, platform, platformId, nonce } = query

    if (!address || !signature || !platform || !platformId || !nonce) {
      set.headers['Content-Type'] = 'text/html'
      return `<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Connection Failed</h1><p>Missing required parameters.</p></body></html>`
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

    set.headers['Content-Type'] = 'text/html'
    return `<!DOCTYPE html>
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
</html>`
  })

  // Wallet connect page
  .get('/auth/connect', ({ set }) => {
    set.headers['Content-Type'] = 'text/html'
    return `<!DOCTYPE html>
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
</html>`
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

  app.listen(port)
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
