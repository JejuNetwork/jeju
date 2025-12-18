/**
 * Otto Wallet Service
 * Handles user wallet binding, account abstraction, and session keys
 */

import { type Address, type Hex, verifyMessage, keccak256, toBytes, parseEther } from 'viem';
import type { OttoUser, UserPlatformLink, Platform, UserSettings } from '../types';
import { DEFAULT_CHAIN_ID, DEFAULT_SLIPPAGE_BPS } from '../config';

// Service URLs
const OAUTH3_API = process.env.OAUTH3_API_URL ?? 'http://localhost:4025';
const KMS_API = process.env.KMS_API_URL ?? 'http://localhost:4026';

export class WalletService {
  private users = new Map<string, OttoUser>();
  private platformToUser = new Map<string, string>(); // platform:id -> userId

  // ============================================================================
  // User Management
  // ============================================================================

  async getOrCreateUser(platform: Platform, platformId: string): Promise<OttoUser | null> {
    const key = `${platform}:${platformId}`;
    const existingUserId = this.platformToUser.get(key);
    
    if (existingUserId) {
      return this.users.get(existingUserId) ?? null;
    }

    // User doesn't exist yet - they need to connect a wallet first
    return null;
  }

  getUser(userId: string): OttoUser | null {
    return this.users.get(userId) ?? null;
  }

  getUserByPlatform(platform: Platform, platformId: string): OttoUser | null {
    const key = `${platform}:${platformId}`;
    const userId = this.platformToUser.get(key);
    if (!userId) return null;
    return this.users.get(userId) ?? null;
  }

  // ============================================================================
  // Wallet Connection
  // ============================================================================

  /**
   * Generate a connection URL for wallet linking
   * Uses OAuth3 for social-to-wallet binding
   */
  async generateConnectUrl(platform: Platform, platformId: string, username: string): Promise<string> {
    const nonce = crypto.randomUUID();
    const message = this.createSignMessage(platform, platformId, nonce);
    
    // Create a pending connection request
    const requestId = crypto.randomUUID();
    
    // Store pending request (in production, this would be in a DB)
    // For now, we'll encode it in the URL
    const params = new URLSearchParams({
      platform,
      platformId,
      username,
      nonce,
      requestId,
    });

    // Return URL to OAuth3 service for wallet connection
    return `${OAUTH3_API}/connect/wallet?${params}`;
  }

  /**
   * Verify a wallet signature and complete the connection
   */
  async verifyAndConnect(
    platform: Platform,
    platformId: string,
    username: string,
    walletAddress: Address,
    signature: Hex,
    nonce: string
  ): Promise<OttoUser> {
    // Verify the signature
    const message = this.createSignMessage(platform, platformId, nonce);
    const valid = await verifyMessage({
      address: walletAddress,
      message,
      signature,
    });

    if (!valid) {
      throw new Error('Invalid signature');
    }

    // Check if user already exists with this wallet
    let user = Array.from(this.users.values()).find(u => u.primaryWallet === walletAddress);

    if (user) {
      // Add platform link if not already linked
      const hasLink = user.platforms.some(p => p.platform === platform && p.platformId === platformId);
      if (!hasLink) {
        user.platforms.push({
          platform,
          platformId,
          username,
          linkedAt: Date.now(),
          verified: true,
        });
      }
    } else {
      // Create new user
      const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      user = {
        id: userId,
        platforms: [{
          platform,
          platformId,
          username,
          linkedAt: Date.now(),
          verified: true,
        }],
        primaryWallet: walletAddress,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        settings: this.getDefaultSettings(),
      };
      this.users.set(userId, user);
    }

    // Create platform mapping
    const key = `${platform}:${platformId}`;
    this.platformToUser.set(key, user.id);

    return user;
  }

  /**
   * Disconnect a platform from a user
   */
  async disconnect(userId: string, platform: Platform, platformId: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;

    const key = `${platform}:${platformId}`;
    this.platformToUser.delete(key);

    user.platforms = user.platforms.filter(
      p => !(p.platform === platform && p.platformId === platformId)
    );

    // If no platforms left, we could optionally delete the user
    // For now, we keep the user record

    return true;
  }

  // ============================================================================
  // Account Abstraction & Session Keys
  // ============================================================================

  /**
   * Create a smart account for the user
   */
  async createSmartAccount(user: OttoUser): Promise<Address> {
    const response = await fetch(`${OAUTH3_API}/api/account/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner: user.primaryWallet,
        userId: user.id,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create smart account');
    }

    const data = await response.json() as { address: Address };
    
    user.smartAccountAddress = data.address;
    return data.address;
  }

  /**
   * Create a session key for automated trading
   * Session keys allow the bot to execute trades without user signature each time
   */
  async createSessionKey(
    user: OttoUser,
    permissions: SessionKeyPermissions
  ): Promise<{ address: Address; expiresAt: number }> {
    if (!user.smartAccountAddress) {
      await this.createSmartAccount(user);
    }

    const expiresAt = Date.now() + (permissions.validForMs ?? 24 * 60 * 60 * 1000); // Default 24 hours

    const response = await fetch(`${OAUTH3_API}/api/session-key/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smartAccount: user.smartAccountAddress,
        permissions: {
          allowedContracts: permissions.allowedContracts,
          maxSpendPerTx: permissions.maxSpendPerTx?.toString(),
          maxTotalSpend: permissions.maxTotalSpend?.toString(),
          allowedFunctions: permissions.allowedFunctions,
        },
        validUntil: Math.floor(expiresAt / 1000),
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create session key');
    }

    const data = await response.json() as { sessionKeyAddress: Address };

    user.sessionKeyAddress = data.sessionKeyAddress;
    user.sessionKeyExpiry = expiresAt;

    return { address: data.sessionKeyAddress, expiresAt };
  }

  /**
   * Revoke the user's session key
   */
  async revokeSessionKey(user: OttoUser): Promise<boolean> {
    if (!user.sessionKeyAddress || !user.smartAccountAddress) {
      return false;
    }

    const response = await fetch(`${OAUTH3_API}/api/session-key/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smartAccount: user.smartAccountAddress,
        sessionKey: user.sessionKeyAddress,
      }),
    });

    if (!response.ok) {
      return false;
    }

    user.sessionKeyAddress = undefined;
    user.sessionKeyExpiry = undefined;

    return true;
  }

  /**
   * Check if user has a valid session key
   */
  hasValidSessionKey(user: OttoUser): boolean {
    return !!user.sessionKeyAddress && 
           !!user.sessionKeyExpiry && 
           user.sessionKeyExpiry > Date.now();
  }

  // ============================================================================
  // Settings
  // ============================================================================

  updateSettings(userId: string, settings: Partial<UserSettings>): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    user.settings = { ...user.settings, ...settings };
    return true;
  }

  getSettings(userId: string): UserSettings | null {
    const user = this.users.get(userId);
    return user?.settings ?? null;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private createSignMessage(platform: Platform, platformId: string, nonce: string): string {
    return `Connect ${platform} account ${platformId} to Otto Trading Agent.\n\nNonce: ${nonce}\n\nThis signature will link your wallet to your ${platform} account for trading.`;
  }

  private getDefaultSettings(): UserSettings {
    return {
      defaultSlippageBps: DEFAULT_SLIPPAGE_BPS,
      defaultChainId: DEFAULT_CHAIN_ID,
      notifications: true,
    };
  }

  // ============================================================================
  // Address Resolution (ENS/JNS)
  // ============================================================================

  async resolveAddress(nameOrAddress: string): Promise<Address | null> {
    // If it's already an address, return it
    if (nameOrAddress.startsWith('0x') && nameOrAddress.length === 42) {
      return nameOrAddress as Address;
    }

    // Try to resolve as ENS or JNS name
    const response = await fetch(`${OAUTH3_API}/api/resolve/${encodeURIComponent(nameOrAddress)}`);
    
    if (!response.ok) return null;

    const data = await response.json() as { address?: Address };
    return data.address ?? null;
  }

  /**
   * Get display name for an address
   */
  async getDisplayName(address: Address): Promise<string> {
    const response = await fetch(`${OAUTH3_API}/api/reverse/${address}`);
    
    if (!response.ok) {
      return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    const data = await response.json() as { name?: string };
    return data.name ?? `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}

// Types
export interface SessionKeyPermissions {
  allowedContracts?: Address[];
  maxSpendPerTx?: bigint;
  maxTotalSpend?: bigint;
  allowedFunctions?: string[];
  validForMs?: number;
}

// Singleton instance
let walletService: WalletService | null = null;

export function getWalletService(): WalletService {
  if (!walletService) {
    walletService = new WalletService();
  }
  return walletService;
}

