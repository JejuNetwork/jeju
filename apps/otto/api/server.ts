/**
 * Otto HTTP Server
 */

import { createHmac } from 'node:crypto'
import { cors } from '@elysiajs/cors'
import { getLocalhostHost } from '@jejunetwork/config'
import { expectAddress, expectHex, expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DiscordWebhookPayloadSchema,
  FarcasterFramePayloadSchema,
  TelegramWebhookPayloadSchema,
  TwilioWebhookPayloadSchema,
  TwitterWebhookPayloadSchema,
} from '../lib'
import { getConfig } from './config'
import { getStateManager } from './services/state'
import { validateNonce, validatePlatform } from './utils/validation'
import { chatApi, frameApi, landingApi, launchApi, miniappApi } from './web'

const config = getConfig()
const stateManager = getStateManager()
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
          : true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Session-Id',
        'X-Wallet-Address',
      ],
    }),
  )

  .use(landingApi)
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
      whatsapp: { enabled: config.whatsapp.enabled },
      farcaster: { enabled: config.farcaster.enabled },
      twitter: { enabled: config.twitter.enabled },
    },
    chains: config.trading.supportedChains,
    features: ['swap', 'bridge', 'launch', 'portfolio', 'limit-orders'],
  }))

  .post('/webhooks/discord', ({ body }) => {
    const payload = expectValid(
      DiscordWebhookPayloadSchema,
      body,
      'Discord webhook',
    )

    if (payload.type === 1) return { type: 1 } // PING
    return { type: 5 } // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  })

  .post('/webhooks/telegram', ({ body, request, set }) => {
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

  .post('/webhooks/whatsapp', async ({ request, set }) => {
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

    set.headers['Content-Type'] = 'text/xml'
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
  })

  .get('/webhooks/whatsapp', () => 'OK')

  .post('/webhooks/farcaster', ({ body }) => {
    expectValid(FarcasterFramePayloadSchema, body, 'Farcaster webhook')
    return { ok: true }
  })

  .post('/webhooks/twitter', ({ body }) => {
    expectValid(TwitterWebhookPayloadSchema, body, 'Twitter webhook')
    return { ok: true }
  })

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

    const hmac = createHmac('sha256', apiSecret)
    hmac.update(crcTokenParam)
    const responseToken = `sha256=${hmac.digest('base64')}`

    return { response_token: responseToken }
  })

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

  .use(chatApi)
  .use(frameApi)
  .use(launchApi)
  .use(miniappApi)

  .get('/auth/callback', ({ query, set }) => {
    const { address, signature, platform, platformId, nonce } = query

    if (!address || !signature || !platform || !platformId || !nonce) {
      set.headers['Content-Type'] = 'text/html'
      return `<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Connection Failed</h1><p>Missing required parameters.</p></body></html>`
    }

    expectAddress(address, 'auth callback address')
    expectHex(signature, 'auth callback signature')
    validatePlatform(platform)
    expectValid(z.string().min(1), platformId, 'auth callback platformId')
    validateNonce(nonce)

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
        window.opener.postMessage({ type: 'wallet_connected', address }, window.location.origin);
      }
      window.close();
    }
  </script>
</body>
</html>`
  })

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

async function main() {
  const port = config.port
  const host = getLocalhostHost()

  // Start autonomous limit order monitoring
  console.log('[Otto] Starting autonomous limit order monitor...')
  const { startLimitOrderMonitor } = await import('./eliza/runtime')
  startLimitOrderMonitor()

  console.log(`[Otto] http://${host}:${port}`)
  app.listen(port)
}

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

if (!process.env.WORKER_MODE) {
  main().catch((err: Error) => {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[Otto] Fatal error:', errorMessage)
    process.exit(1)
  })
}

export { app }
