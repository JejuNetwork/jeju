/**
 * Webhook Handling Hooks
 * Shared webhook business logic
 * Note: Payloads are validated by server.ts before calling these functions
 */

import { getOttoAgent } from '../agent';
import type {
  DiscordWebhookPayload,
  TelegramWebhookPayload,
  TwilioWebhookPayload,
  FarcasterFramePayload,
  TwitterWebhookPayload,
} from '../types';

const agent = getOttoAgent();

/**
 * Handle Discord webhook (payload already validated by server.ts)
 */
export async function handleDiscordWebhook(payload: DiscordWebhookPayload): Promise<void> {
  await agent.handleDiscordWebhook(payload);
}

/**
 * Handle Telegram webhook (payload already validated by server.ts)
 */
export async function handleTelegramWebhook(payload: TelegramWebhookPayload): Promise<void> {
  await agent.handleTelegramWebhook(payload);
}

/**
 * Handle WhatsApp webhook (payload already validated by server.ts)
 */
export async function handleWhatsAppWebhook(payload: TwilioWebhookPayload): Promise<void> {
  await agent.handleWhatsAppWebhook(payload);
}

/**
 * Handle Farcaster webhook (payload already validated by server.ts)
 */
export async function handleFarcasterWebhook(payload: FarcasterFramePayload): Promise<void> {
  await agent.handleFarcasterWebhook(payload);
}

/**
 * Handle Twitter webhook (payload already validated by server.ts)
 */
export async function handleTwitterWebhook(payload: TwitterWebhookPayload): Promise<void> {
  const adapter = agent.platformManager.getAdapter('twitter');
  if (adapter?.handleWebhook) {
    await adapter.handleWebhook(payload);
  }
}

/**
 * Generate Twitter CRC challenge response
 */
export async function generateTwitterCrcResponse(crcToken: string, apiSecret: string): Promise<string> {
  if (!crcToken || !apiSecret) {
    throw new Error('CRC token and API secret are required');
  }
  
  const crypto = await import('crypto');
  const hmac = crypto.createHmac('sha256', apiSecret);
  hmac.update(crcToken);
  return 'sha256=' + hmac.digest('base64');
}
