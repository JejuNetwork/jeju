/**
 * Otto Agent - Main Entry Point
 * Uses unified ElizaOS-style runtime for all message processing
 */

import type { PlatformMessage, CommandResult, Platform } from '../types';
import type { PlatformAdapter } from '../platforms/types';
import { PlatformManager } from '../platforms';
import { processMessage } from '../eliza/runtime';

export class OttoAgent {
  private platformManager: PlatformManager;

  constructor() {
    this.platformManager = new PlatformManager();
  }

  async start(): Promise<void> {
    console.log('[Otto] Starting agent...');

    // Initialize all platforms
    await this.platformManager.initialize();

    // Set up message handlers for each platform
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
    console.log(`[Otto] Received message from ${message.platform}:${message.userId}: ${message.content.slice(0, 50)}...`);

    // Process through unified runtime (handles both commands and AI)
    const result = await processMessage(message);

    // Send response
    await this.sendResponse(adapter, message, result);
  }

  private async sendResponse(
    adapter: PlatformAdapter,
    message: PlatformMessage,
    result: CommandResult
  ): Promise<void> {
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
  // Webhook Handlers
  // ============================================================================

  async handleDiscordWebhook(payload: unknown): Promise<void> {
    const adapter = this.platformManager.getAdapter('discord');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  async handleTelegramWebhook(payload: unknown): Promise<void> {
    const adapter = this.platformManager.getAdapter('telegram');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  async handleWhatsAppWebhook(payload: unknown): Promise<void> {
    const adapter = this.platformManager.getAdapter('whatsapp');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  async handleFarcasterWebhook(payload: unknown): Promise<void> {
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
    return processMessage(message);
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

