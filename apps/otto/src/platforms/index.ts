/**
 * Platform Adapters Index
 */

export * from './types';
export { DiscordAdapter } from './discord';
export { TelegramAdapter } from './telegram';
export { WhatsAppAdapter } from './whatsapp';
export { FarcasterAdapter } from './farcaster';
export { TwitterAdapter } from './twitter';

import type { Platform } from '../types';
import type { PlatformAdapter } from './types';
import { DiscordAdapter } from './discord';
import { TelegramAdapter } from './telegram';
import { WhatsAppAdapter } from './whatsapp';
import { FarcasterAdapter } from './farcaster';
import { TwitterAdapter } from './twitter';
import { getConfig } from '../config';

export class PlatformManager {
  private adapters = new Map<Platform, PlatformAdapter>();

  async initialize(): Promise<void> {
    const config = getConfig();

    // Initialize Discord
    if (config.discord.enabled && config.discord.token && config.discord.applicationId) {
      console.log('[PlatformManager] Initializing Discord adapter...');
      const discord = new DiscordAdapter(
        config.discord.token,
        config.discord.applicationId,
        config.discord.publicKey
      );
      await discord.initialize();
      this.adapters.set('discord', discord);
    }

    // Initialize Telegram
    if (config.telegram.enabled && config.telegram.token) {
      console.log('[PlatformManager] Initializing Telegram adapter...');
      const telegram = new TelegramAdapter(
        config.telegram.token,
        config.telegram.webhookSecret
      );
      await telegram.initialize();
      this.adapters.set('telegram', telegram);
    }

    // Initialize WhatsApp
    if (config.whatsapp.enabled && config.whatsapp.twilioSid && config.whatsapp.twilioToken && config.whatsapp.phoneNumber) {
      console.log('[PlatformManager] Initializing WhatsApp adapter...');
      const whatsapp = new WhatsAppAdapter(
        config.whatsapp.twilioSid,
        config.whatsapp.twilioToken,
        config.whatsapp.phoneNumber
      );
      await whatsapp.initialize();
      this.adapters.set('whatsapp', whatsapp);
    }

    // Initialize Farcaster
    if (config.farcaster.enabled && config.farcaster.apiKey && config.farcaster.botFid) {
      console.log('[PlatformManager] Initializing Farcaster adapter...');
      const farcaster = new FarcasterAdapter(
        config.farcaster.apiKey,
        config.farcaster.botFid,
        config.farcaster.signerUuid
      );
      await farcaster.initialize();
      this.adapters.set('farcaster', farcaster);
    }

    // Initialize Twitter/X
    if (config.twitter.enabled && config.twitter.bearerToken) {
      console.log('[PlatformManager] Initializing Twitter adapter...');
      const twitter = new TwitterAdapter(
        {
          apiKey: config.twitter.apiKey ?? '',
          apiSecret: config.twitter.apiSecret ?? '',
          accessToken: config.twitter.accessToken ?? '',
          accessSecret: config.twitter.accessSecret ?? '',
          bearerToken: config.twitter.bearerToken,
        },
        config.twitter.botUsername ?? 'otto_agent'
      );
      await twitter.initialize();
      this.adapters.set('twitter', twitter);
    }

    console.log(`[PlatformManager] Initialized ${this.adapters.size} platform(s)`);
  }

  async shutdown(): Promise<void> {
    console.log('[PlatformManager] Shutting down all adapters...');
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown();
    }
    this.adapters.clear();
  }

  getAdapter(platform: Platform): PlatformAdapter | null {
    return this.adapters.get(platform) ?? null;
  }

  getAdapters(): Map<Platform, PlatformAdapter> {
    return this.adapters;
  }

  isEnabled(platform: Platform): boolean {
    return this.adapters.has(platform);
  }

  getEnabledPlatforms(): Platform[] {
    return Array.from(this.adapters.keys());
  }
}

