/**
 * Otto Trading Agent Server
 * Main entry point for the Otto multi-platform trading agent
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { getConfig } from './config';
import { getOttoAgent } from './agent';
import { chatApi } from './web/chat-api';
import { frameApi } from './web/frame';
import { miniappApi } from './web/miniapp';
import { startLimitOrderMonitor, stopLimitOrderMonitor } from './eliza/runtime';
import { z } from 'zod';
import {
  expectValid,
  DiscordWebhookPayloadSchema,
  TelegramWebhookPayloadSchema,
  TwilioWebhookPayloadSchema,
  FarcasterFramePayloadSchema,
  TwitterWebhookPayloadSchema,
} from './schemas';
import {
  createHealthResponse,
  createStatusResponse,
  createChainsResponse,
  createInfoResponse,
} from './utils/response';
import {
  handleDiscordWebhook,
  handleTelegramWebhook,
  handleWhatsAppWebhook,
  handleFarcasterWebhook,
  handleTwitterWebhook,
  generateTwitterCrcResponse,
} from './hooks/useWebhook';
import { validateCrcToken, validateAddress, validateHex, validatePlatform, validateNonce } from './utils/validation';
import { createErrorHtml, createWalletConnectedHtml } from './utils/html';

const app = new Hono();
const config = getConfig();

// Initialize agent
const agent = getOttoAgent();

// Middleware
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Bot-Api-Secret-Token', 'X-Session-Id', 'X-Wallet-Address'],
}));

// ============================================================================
// Health & Status
// ============================================================================

app.get('/health', (c) => {
  const status = agent.getStatus();
  const response = createHealthResponse(status);
  return c.json(response);
});

app.get('/status', (c) => {
  const status = agent.getStatus();
  const response = createStatusResponse(config, status);
  return c.json(response);
});

// ============================================================================
// Webhooks
// ============================================================================

// Discord webhook (for interactions API)
app.post('/webhooks/discord', async (c) => {
  const rawPayload = await c.req.json();
  const payload = expectValid(DiscordWebhookPayloadSchema, rawPayload, 'Discord webhook');
  
  // Discord requires immediate response for interaction verification
  if (payload.type === 1) {
    // PING - respond with PONG
    return c.json({ type: 1 });
  }
  
  // Handle interaction asynchronously
  handleDiscordWebhook(payload).catch((err: Error) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[Otto] Discord webhook error:', errorMessage);
  });
  
  // Acknowledge receipt
  return c.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
});

// Telegram webhook
app.post('/webhooks/telegram', async (c) => {
  // Verify secret token if configured
  if (config.telegram.webhookSecret) {
    const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (!secretToken || secretToken !== config.telegram.webhookSecret) {
      return c.json({ error: 'Invalid secret token' }, 403);
    }
  }
  
  const rawPayload = await c.req.json();
  const payload = expectValid(TelegramWebhookPayloadSchema, rawPayload, 'Telegram webhook');
  
  // Handle update asynchronously
  handleTelegramWebhook(payload).catch((err: Error) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[Otto] Telegram webhook error:', errorMessage);
  });
  
  return c.json({ ok: true });
});

// WhatsApp webhook (Twilio)
app.post('/webhooks/whatsapp', async (c) => {
  // Parse form data (Twilio sends as application/x-www-form-urlencoded)
  const formData = await c.req.parseBody();
  
  const rawPayload = {
    MessageSid: String(formData['MessageSid'] ?? ''),
    From: String(formData['From'] ?? ''),
    To: String(formData['To'] ?? ''),
    Body: String(formData['Body'] ?? ''),
    NumMedia: String(formData['NumMedia'] ?? '0'),
    MediaUrl0: formData['MediaUrl0'] ? String(formData['MediaUrl0']) : undefined,
  };
  
  const payload = expectValid(TwilioWebhookPayloadSchema, rawPayload, 'WhatsApp webhook');
  
  // Handle message asynchronously
  handleWhatsAppWebhook(payload).catch((err: Error) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[Otto] WhatsApp webhook error:', errorMessage);
  });
  
  // Return empty TwiML response
  c.header('Content-Type', 'text/xml');
  return c.body('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// WhatsApp webhook verification (Twilio)
app.get('/webhooks/whatsapp', (c) => {
  // Twilio may send GET for verification
  return c.text('OK');
});

// Farcaster Frame webhook
app.post('/webhooks/farcaster', async (c) => {
  const rawPayload = await c.req.json();
  const payload = expectValid(FarcasterFramePayloadSchema, rawPayload, 'Farcaster webhook');
  
  // Validate frame message
  const adapter = agent.getFarcasterAdapter();
  if (adapter) {
    const messageBytes = Buffer.from(payload.trustedData.messageBytes, 'hex');
    const validated = await adapter.validateFrame(messageBytes);
    
    if (!validated?.valid) {
      return c.json({ error: 'Invalid frame message' }, 400);
    }
  }
  
  // Handle frame interaction
  handleFarcasterWebhook(payload).catch((err: Error) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[Otto] Farcaster webhook error:', errorMessage);
  });
  
  return c.json({ ok: true });
});

// Twitter webhook (Account Activity API)
app.post('/webhooks/twitter', async (c) => {
  const rawPayload = await c.req.json();
  const payload = expectValid(TwitterWebhookPayloadSchema, rawPayload, 'Twitter webhook');
  
  // Handle webhook asynchronously
  handleTwitterWebhook(payload).catch((err: Error) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[Otto] Twitter webhook error:', errorMessage);
  });
  
  return c.json({ ok: true });
});

// Twitter webhook verification (CRC challenge)
app.get('/webhooks/twitter', async (c) => {
  const crcTokenParam = c.req.query('crc_token');
  if (!crcTokenParam) {
    return c.text('Missing crc_token', 400);
  }
  
  const crcToken = validateCrcToken(crcTokenParam);
  const apiSecret = process.env.TWITTER_API_SECRET ?? '';
  
  if (!apiSecret) {
    throw new Error('TWITTER_API_SECRET is required for CRC verification');
  }
  
  const responseToken = await generateTwitterCrcResponse(crcToken, apiSecret);
  
  return c.json({ response_token: responseToken });
});

// ============================================================================
// Chat API
// ============================================================================

app.route('/api/chat', chatApi);

// ============================================================================
// Farcaster Frame
// ============================================================================

app.route('/frame', frameApi);

// ============================================================================
// Miniapps (Telegram, Farcaster, Web)
// ============================================================================

app.route('/miniapp', miniappApi);

// Handle trailing slash
app.get('/miniapp/', (c) => c.redirect('/miniapp'));

// Redirect root to miniapp
app.get('/', (c) => c.redirect('/miniapp'));

// ============================================================================
// API Endpoints
// ============================================================================

// Get supported chains
app.get('/api/chains', (c) => {
  const response = createChainsResponse(config);
  return c.json(response);
});

// Get agent info
app.get('/api/info', (c) => {
  const response = createInfoResponse(config);
  return c.json(response);
});

// ============================================================================
// OAuth3 Callback (for wallet connection)
// ============================================================================

app.get('/auth/callback', async (c) => {
  const { address, signature, platform, platformId, nonce } = c.req.query();
  
  if (!address || !signature || !platform || !platformId || !nonce) {
    return c.html(createErrorHtml('Connection Failed', 'Missing required parameters.'));
  }
  
  // Validate parameters with fail-fast
  validateAddress(address);
  validateHex(signature);
  validatePlatform(platform);
  expectValid(z.string().min(1), platformId, 'auth callback platformId');
  validateNonce(nonce);
  
  // Note: Actual wallet connection happens in /api/chat/auth/verify
  // This route just shows the success page
  return c.html(createWalletConnectedHtml(address, platform));
});

// Wallet connect page
app.get('/auth/connect', (c) => {
  return c.html(`
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
          .container {
            text-align: center;
            padding: 2rem;
            max-width: 400px;
          }
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
            transition: transform 0.2s;
          }
          .btn:hover { transform: scale(1.02); }
          .btn-primary {
            background: linear-gradient(135deg, #00d4ff, #0099ff);
            color: #000;
          }
          .btn-secondary {
            background: rgba(255,255,255,0.1);
            color: #fff;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 Connect to Otto</h1>
          <p>Connect your wallet to start trading</p>
          <button class="btn btn-primary" onclick="connectMetaMask()">
            🦊 Connect MetaMask
          </button>
          <button class="btn btn-secondary" onclick="connectWalletConnect()">
            🔗 WalletConnect
          </button>
        </div>
        <script>
          async function connectMetaMask() {
            if (!window.ethereum) {
              alert('Please install MetaMask');
              return;
            }
            try {
              const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
              const address = accounts[0];
              
              // Get sign message
              const res = await fetch('/api/chat/auth/message?address=' + address);
              const { message, nonce } = await res.json();
              
              // Sign message
              const signature = await window.ethereum.request({
                method: 'personal_sign',
                params: [message, address],
              });
              
              // Verify and connect
              const verifyRes = await fetch('/api/chat/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, message, signature, sessionId: new URLSearchParams(location.search).get('session') }),
              });
              
              if (verifyRes.ok) {
                if (window.opener) {
                  window.opener.postMessage({ type: 'wallet_connected', address }, '*');
                }
                location.href = '/auth/callback?address=' + address + '&platform=web&platformId=' + address + '&nonce=' + nonce + '&signature=' + signature;
              }
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              console.error('Connection error:', errorMessage);
              alert('Connection failed');
            }
          }
          
          function connectWalletConnect() {
            alert('WalletConnect coming soon');
          }
        </script>
      </body>
    </html>
  `);
});

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('       🤖 Otto Trading Agent');
  console.log('========================================');
  console.log('');
  
  // Check enabled platforms
  const platformCount = [
    config.discord.enabled,
    config.telegram.enabled,
    config.whatsapp.enabled,
    config.farcaster.enabled,
  ].filter(Boolean).length;

  if (platformCount === 0) {
    console.log('⚠️  No platforms enabled. Set environment variables:');
    console.log('   - DISCORD_BOT_TOKEN + DISCORD_APPLICATION_ID for Discord');
    console.log('   - TELEGRAM_BOT_TOKEN for Telegram');
    console.log('   - TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_NUMBER for WhatsApp');
    console.log('   - NEYNAR_API_KEY + FARCASTER_BOT_FID for Farcaster');
    console.log('');
    console.log('Running in web-only mode...');
    console.log('');
  }
  
  // Start agent (connects to enabled platforms)
  await agent.start();

  // Start limit order monitor
  startLimitOrderMonitor();
  
  // Start HTTP server
  const port = config.port;
  console.log('');
  console.log(`🌐 HTTP server listening on port ${port}`);
  console.log(`   Health: http://localhost:${port}/health`);
  console.log(`   Status: http://localhost:${port}/status`);
  console.log('');
  console.log('📱 Miniapps:');
  console.log(`   Web:       http://localhost:${port}/miniapp/`);
  console.log(`   Telegram:  http://localhost:${port}/miniapp/telegram`);
  console.log(`   Farcaster: http://localhost:${port}/miniapp/farcaster`);
  console.log('');
  console.log(`🖼️  Farcaster Frame: http://localhost:${port}/frame`);
  console.log('');
  console.log('📡 Webhook endpoints:');
  console.log(`   Discord:   http://localhost:${port}/webhooks/discord`);
  console.log(`   Telegram:  http://localhost:${port}/webhooks/telegram`);
  console.log(`   WhatsApp:  http://localhost:${port}/webhooks/whatsapp`);
  console.log(`   Farcaster: http://localhost:${port}/webhooks/farcaster`);
  console.log(`   Twitter:   http://localhost:${port}/webhooks/twitter`);
  console.log('');
  console.log(`💬 Chat API: http://localhost:${port}/api/chat`);
  console.log('');
  console.log('========================================');
  
  serve({
    fetch: app.fetch,
    port,
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Otto] Shutting down...');
  stopLimitOrderMonitor();
  await agent.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Otto] Shutting down...');
  stopLimitOrderMonitor();
  await agent.stop();
  process.exit(0);
});

// Run
main().catch((err: Error) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error('[Otto] Fatal error:', errorMessage);
  process.exit(1);
});
