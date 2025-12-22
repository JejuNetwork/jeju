/**
 * Otto Wallet Service
 * Handles user wallet binding, account abstraction, and session keys
 * Uses StateManager for persistence
 */

import { type Address, type Hex, verifyMessage, isAddress, isHex } from 'viem';
import type { OttoUser, Platform, UserSettings } from '../types';
import { DEFAULT_CHAIN_ID, DEFAULT_SLIPPAGE_BPS } from '../config';
import { getStateManager } from './state';
import {
  expectValid,
  OttoUserSchema,
  UserSettingsSchema,
  ExternalSmartAccountResponseSchema,
  ExternalSessionKeyResponseSchema,
  ExternalResolveResponseSchema,
  ExternalReverseResolveResponseSchema,
} from '../schemas';
import { getRequiredEnv } from '../utils/validation';

const OAUTH3_API = getRequiredEnv('OAUTH3_API_URL', 'http://localhost:4025');

export class WalletService {
  private stateManager = getStateManager();

  // ============================================================================
  // User Management
  // ============================================================================

  getOrCreateUser(platform: Platform, platformId: string): OttoUser | null {
    return this.stateManager.getUserByPlatform(platform, platformId);
  }

  getUser(userId: string): OttoUser | null {
    return this.stateManager.getUser(userId);
  }

  getUserByPlatform(platform: Platform, platformId: string): OttoUser | null {
    return this.stateManager.getUserByPlatform(platform, platformId);
  }

  // ============================================================================
  // Wallet Connection
  // ============================================================================

  async generateConnectUrl(platform: Platform, platformId: string, username: string): Promise<string> {
    const nonce = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    const params = new URLSearchParams({
      platform,
      platformId,
      username,
      nonce,
      requestId,
    });

    return `${OAUTH3_API}/connect/wallet?${params}`;
  }

  async verifyAndConnect(
    platform: Platform,
    platformId: string,
    username: string,
    walletAddress: Address,
    signature: Hex,
    nonce: string
  ): Promise<OttoUser> {
    // Validate inputs
    if (!platform || !platformId || !username || !walletAddress || !signature || !nonce) {
      throw new Error('All parameters are required for wallet connection');
    }
    
    if (!isAddress(walletAddress)) {
      throw new Error('Invalid wallet address');
    }
    
    if (!isHex(signature)) {
      throw new Error('Invalid signature format');
    }
    
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
    let user = this.findUserByWallet(walletAddress);

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
        this.stateManager.setUser(user);
      }
    } else {
      // Create new user
      const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const newUser = {
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
      
      user = expectValid(OttoUserSchema, newUser, 'new user');
      this.stateManager.setUser(user);
    }

    return user;
  }

  private findUserByWallet(_walletAddress: Address): OttoUser | null {
    return null;
  }

  async disconnect(userId: string, platform: Platform, platformId: string): Promise<boolean> {
    const user = this.stateManager.getUser(userId);
    if (!user) return false;

    user.platforms = user.platforms.filter(
      p => !(p.platform === platform && p.platformId === platformId)
    );

    this.stateManager.setUser(user);
    return true;
  }

  // ============================================================================
  // Account Abstraction & Session Keys
  // ============================================================================

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

    const rawData = await response.json();
    const data = expectValid(ExternalSmartAccountResponseSchema, rawData, 'smart account response');

    user.smartAccountAddress = data.address;
    this.stateManager.setUser(user);
    return data.address;
  }

  async createSessionKey(
    user: OttoUser,
    permissions: SessionKeyPermissions
  ): Promise<{ address: Address; expiresAt: number }> {
    if (!user.smartAccountAddress) {
      await this.createSmartAccount(user);
    }

    const expiresAt = Date.now() + (permissions.validForMs ?? 24 * 60 * 60 * 1000);

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

    const rawData = await response.json();
    const data = expectValid(ExternalSessionKeyResponseSchema, rawData, 'session key response');

    user.sessionKeyAddress = data.sessionKeyAddress;
    user.sessionKeyExpiry = expiresAt;
    this.stateManager.setUser(user);

    return { address: data.sessionKeyAddress, expiresAt };
  }

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
    this.stateManager.setUser(user);

    return true;
  }

  hasValidSessionKey(user: OttoUser): boolean {
    return !!user.sessionKeyAddress &&
           !!user.sessionKeyExpiry &&
           user.sessionKeyExpiry > Date.now();
  }

  // ============================================================================
  // Settings
  // ============================================================================

  updateSettings(userId: string, settings: Partial<UserSettings>): boolean {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    const user = this.stateManager.getUser(userId);
    if (!user) {
      return false;
    }

    const mergedSettings = { ...user.settings, ...settings };
    const validatedSettings = expectValid(UserSettingsSchema, mergedSettings, 'user settings');
    
    user.settings = validatedSettings;
    this.stateManager.setUser(user);
    return true;
  }

  getSettings(userId: string): UserSettings {
    if (!userId) {
      throw new Error('User ID is required');
    }
    const user = this.stateManager.getUser(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    return user.settings;
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
    if (!nameOrAddress || typeof nameOrAddress !== 'string') {
      throw new Error('Name or address must be a non-empty string');
    }
    
    if (nameOrAddress.startsWith('0x') && nameOrAddress.length === 42) {
      const address = nameOrAddress as Address;
      if (!isAddress(address)) {
        throw new Error('Invalid address format');
      }
      return address;
    }

    const response = await fetch(`${OAUTH3_API}/api/resolve/${encodeURIComponent(nameOrAddress)}`);

    if (!response.ok) {
      return null;
    }

    const rawData = await response.json();
    const data = expectValid(ExternalResolveResponseSchema, rawData, 'resolve response');
    const address = data.address;
    
    if (!address) {
      return null;
    }
    
    if (!isAddress(address)) {
      throw new Error('Resolved address is invalid');
    }
    
    return address;
  }

  async getDisplayName(address: Address): Promise<string> {
    const response = await fetch(`${OAUTH3_API}/api/reverse/${address}`);

    if (!response.ok) {
      return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    const rawData = await response.json();
    const data = expectValid(ExternalReverseResolveResponseSchema, rawData, 'reverse resolve response');
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

