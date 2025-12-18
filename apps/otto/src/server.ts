/**
 * Otto Trading Agent Server
 * Main entry point for the Otto multi-platform trading agent
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { getConfig } from './config';
import { OttoAgent } from './agent';
import type { TelegramWebhookPayload, TwilioWebhookPayload, DiscordWebhookPayload } from './types';

const app = new Hono();
const config = getConfig();

// Initialize agent
const agent = new OttoAgent();

// Middleware
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Bot-Api-Secret-Token'],
}));

// ============================================================================
// Health & Status
// ============================================================================

app.get('/health', (c) => {
  const status = agent.getStatus();
  return c.json({
    status: 'healthy',
    agent: 'otto',
    version: '1.0.0',
    platforms: status,
  });
});

app.get('/status', (c) => {
  const status = agent.getStatus();
  return c.json({
    name: 'Otto Trading Agent',
    version: '1.0.0',
    platforms: {
      discord: {
        enabled: config.discord.enabled,
        ready: status.ready.includes('discord'),
      },
      telegram: {
        enabled: config.telegram.enabled,
        ready: status.ready.includes('telegram'),
      },
      whatsapp: {
        enabled: config.whatsapp.enabled,
        ready: status.ready.includes('whatsapp'),
      },
    },
    ai: {
      enabled: config.ai.enabled,
    },
    chains: config.trading.supportedChains,
  });
});

// ============================================================================
// Webhooks
// ============================================================================

// Discord webhook (for interactions API)
app.post('/webhooks/discord', async (c) => {
  const payload = await c.req.json() as DiscordWebhookPayload;
  
  // Discord requires immediate response for interaction verification
  if (payload.type === 1) {
    // PING - respond with PONG
    return c.json({ type: 1 });
  }
  
  // Handle interaction asynchronously
  agent.handleDiscordWebhook(payload).catch(err => {
    console.error('[Otto] Discord webhook error:', err);
  });
  
  // Acknowledge receipt
  return c.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
});

// Telegram webhook
app.post('/webhooks/telegram', async (c) => {
  // Verify secret token if configured
  if (config.telegram.webhookSecret) {
    const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (secretToken !== config.telegram.webhookSecret) {
      return c.json({ error: 'Invalid secret token' }, 403);
    }
  }
  
  const payload = await c.req.json() as TelegramWebhookPayload;
  
  // Handle update asynchronously
  agent.handleTelegramWebhook(payload).catch(err => {
    console.error('[Otto] Telegram webhook error:', err);
  });
  
  return c.json({ ok: true });
});

// WhatsApp webhook (Twilio)
app.post('/webhooks/whatsapp', async (c) => {
  // Parse form data (Twilio sends as application/x-www-form-urlencoded)
  const formData = await c.req.parseBody();
  
  const payload: TwilioWebhookPayload = {
    MessageSid: String(formData['MessageSid'] ?? ''),
    From: String(formData['From'] ?? ''),
    To: String(formData['To'] ?? ''),
    Body: String(formData['Body'] ?? ''),
    NumMedia: String(formData['NumMedia'] ?? '0'),
    MediaUrl0: formData['MediaUrl0'] ? String(formData['MediaUrl0']) : undefined,
  };
  
  // Handle message asynchronously
  agent.handleWhatsAppWebhook(payload).catch(err => {
    console.error('[Otto] WhatsApp webhook error:', err);
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

// ============================================================================
// API Endpoints
// ============================================================================

// Get supported chains
app.get('/api/chains', (c) => {
  return c.json({
    chains: config.trading.supportedChains,
    defaultChainId: config.trading.defaultChainId,
  });
});

// Get agent info
app.get('/api/info', (c) => {
  return c.json({
    name: 'Otto',
    description: 'Decentralized multi-platform AI trading agent',
    version: '1.0.0',
    platforms: ['discord', 'telegram', 'whatsapp'],
    features: [
      'swap',
      'bridge',
      'send',
      'launch',
      'portfolio',
      'limit-orders',
      'cross-chain',
    ],
    links: {
      discord: config.discord.applicationId 
        ? `https://discord.com/api/oauth2/authorize?client_id=${config.discord.applicationId}&permissions=2147485696&scope=bot%20applications.commands`
        : null,
      telegram: config.telegram.token
        ? `https://t.me/${config.telegram.token.split(':')[0]}`
        : null,
    },
  });
});

// ============================================================================
// OAuth3 Callback (for wallet connection)
// ============================================================================

app.get('/auth/callback', async (c) => {
  const { address, signature, platform, platformId, nonce } = c.req.query();
  
  if (!address || !signature || !platform || !platformId || !nonce) {
    return c.html(`
      <html>
        <body style="font-family: system-ui; padding: 2rem; text-align: center;">
          <h1>Connection Failed</h1>
          <p>Missing required parameters.</p>
        </body>
      </html>
    `);
  }
  
  // This would be handled by the wallet service
  // For now, just show success
  return c.html(`
    <html>
      <body style="font-family: system-ui; padding: 2rem; text-align: center;">
        <h1>✅ Wallet Connected</h1>
        <p>Your wallet has been connected to Otto.</p>
        <p>You can now close this window and return to ${platform}.</p>
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
  if (!config.discord.enabled && !config.telegram.enabled && !config.whatsapp.enabled) {
    console.log('⚠️  No platforms enabled. Set environment variables:');
    console.log('   - DISCORD_BOT_TOKEN + DISCORD_APPLICATION_ID for Discord');
    console.log('   - TELEGRAM_BOT_TOKEN for Telegram');
    console.log('   - TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_NUMBER for WhatsApp');
    console.log('');
    console.log('Running in API-only mode...');
    console.log('');
  }
  
  // Start agent (connects to enabled platforms)
  await agent.start();
  
  // Start HTTP server
  const port = config.port;
  console.log('');
  console.log(`🌐 HTTP server listening on port ${port}`);
  console.log(`   Health: http://localhost:${port}/health`);
  console.log(`   Status: http://localhost:${port}/status`);
  console.log('');
  console.log('📡 Webhook endpoints:');
  console.log(`   Discord:  http://localhost:${port}/webhooks/discord`);
  console.log(`   Telegram: http://localhost:${port}/webhooks/telegram`);
  console.log(`   WhatsApp: http://localhost:${port}/webhooks/whatsapp`);
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
  await agent.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Otto] Shutting down...');
  await agent.stop();
  process.exit(0);
});

// Run
main().catch(err => {
  console.error('[Otto] Fatal error:', err);
  process.exit(1);
});

