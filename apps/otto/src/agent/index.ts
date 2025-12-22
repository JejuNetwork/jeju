/**
 * Otto Agent - Main Entry Point
 * Uses unified ElizaOS-style runtime for all message processing
 */

import type {
  PlatformMessage,
  CommandResult,
  Platform,
  DiscordWebhookPayload,
  TelegramWebhookPayload,
  TwilioWebhookPayload,
  FarcasterFramePayload,
} from '../types';
import type { PlatformAdapter } from '../platforms/types';
import { PlatformManager } from '../platforms';
import { processMessage } from '../eliza/runtime';
import {
  expectValid,
  PlatformMessageSchema,
  CommandResultSchema,
} from '../schemas';

export class OttoAgent {
  readonly platformManager: PlatformManager;

  constructor() {
    this.platformManager = new PlatformManager();
  }

  async start(): Promise<void> {
    console.log('[Otto] Starting agent...');

    await this.platformManager.initialize();

    for (const [platform, adapter] of this.platformManager.getAdapters()) {
      adapter.onMessage(async (message: PlatformMessage) => {
        await this.handleMessage(message, adapter);
      });
      console.log(`[Otto] Listening on ${platform}`);
    }

    const enabledPlatforms = this.platformManager.getEnabledPlatforms();
    console.log(`[Otto] Agent started on ${enabledPlatforms.length} platform(s): ${enabledPlatforms.join(', ')}`);
  }

  async stop(): Promise<void> {
    console.log('[Otto] Stopping agent...');
    await this.platformManager.shutdown();
    console.log('[Otto] Agent stopped');
  }

  private async handleMessage(message: PlatformMessage, adapter: PlatformAdapter): Promise<void> {
    const validatedMessage = expectValid(PlatformMessageSchema, message, 'agent handleMessage');
    console.log(`[Otto] Received message from ${validatedMessage.platform}:${validatedMessage.userId}: ${validatedMessage.content.slice(0, 50)}...`);

    const result = await processMessage(validatedMessage);
    const validatedResult = expectValid(CommandResultSchema, result, 'command result');

    await this.sendResponse(adapter, validatedMessage, validatedResult);
  }

  private async sendResponse(
    adapter: PlatformAdapter,
    message: PlatformMessage,
    result: CommandResult
  ): Promise<void> {
    if (!message.channelId || !result.message) {
      throw new Error('Channel ID and result message are required');
    }
    
    if (result.embed) {
      await adapter.sendEmbed(message.channelId, result.embed, result.buttons);
    } else {
      await adapter.sendMessage(message.channelId, result.message, {
        buttons: result.buttons,
        replyToMessageId: message.messageId,
      });
    }
  }

  // ============================================================================
  // Webhook Handlers (payloads already validated by server.ts)
  // ============================================================================

  async handleDiscordWebhook(payload: DiscordWebhookPayload): Promise<void> {
    const adapter = this.platformManager.getAdapter('discord');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  async handleTelegramWebhook(payload: TelegramWebhookPayload): Promise<void> {
    const adapter = this.platformManager.getAdapter('telegram');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  async handleWhatsAppWebhook(payload: TwilioWebhookPayload): Promise<void> {
    const adapter = this.platformManager.getAdapter('whatsapp');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  async handleFarcasterWebhook(payload: FarcasterFramePayload): Promise<void> {
    const adapter = this.platformManager.getAdapter('farcaster');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  // ============================================================================
  // Adapter Access
  // ============================================================================

  getFarcasterAdapter() {
    return this.platformManager.getAdapter('farcaster') as import('../platforms/farcaster').FarcasterAdapter | null;
  }

  // ============================================================================
  // Direct Chat (for web/API)
  // ============================================================================

  async chat(message: PlatformMessage): Promise<CommandResult> {
    const validatedMessage = expectValid(PlatformMessageSchema, message, 'chat message');
    const result = await processMessage(validatedMessage);
    return expectValid(CommandResultSchema, result, 'chat result');
  }

  // ============================================================================
  // Status
  // ============================================================================

  getStatus(): {
    enabled: Platform[];
    ready: Platform[];
  } {
    const enabled = this.platformManager.getEnabledPlatforms();
    const ready = enabled.filter(p => this.platformManager.getAdapter(p)?.isReady());
    return { enabled, ready };
  }
}

// Singleton instance for hooks
let ottoAgentInstance: OttoAgent | null = null;

export function getOttoAgent(): OttoAgent {
  if (!ottoAgentInstance) {
    ottoAgentInstance = new OttoAgent();
  }
  return ottoAgentInstance;
}
