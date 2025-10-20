/**
 * App Identifier Utilities
 * Consistent app ID generation across all Jeju apps
 * 
 * CRITICAL: Apps compute their own IDs - contracts have NO hardcoded knowledge
 */

import { ethers } from 'ethers';
import { keccak256, toBytes } from 'viem';

/**
 * Generate app ID for use with moderation contracts
 * @param appName Lowercase app name (e.g., 'hyperscape', 'bazaar')
 * @returns bytes32 app identifier
 */
export function getAppId(appName: string): string {
  // Normalize to lowercase
  const normalized = appName.toLowerCase().trim();
  
  // Generate keccak256 hash (ethers)
  return ethers.keccak256(ethers.toUtf8Bytes(normalized));
}

/**
 * Generate app ID using viem (for frontend)
 */
export function getAppIdViem(appName: string): `0x${string}` {
  const normalized = appName.toLowerCase().trim();
  return keccak256(toBytes(normalized));
}

/**
 * Standard app IDs for Jeju Network applications
 * These are computed, not hardcoded in contracts
 */
export const APP_IDS = {
  HYPERSCAPE: getAppId('hyperscape'),
  BAZAAR: getAppId('bazaar'),
  PREDIMARKET: getAppId('predimarket'),
  GATEWAY: getAppId('gateway'),
  LEADERBOARD: getAppId('leaderboard'),
  INDEXER: getAppId('indexer'),
} as const;

/**
 * Get human-readable name from app ID
 * This is a convenience function - the mapping is stored client-side
 */
export function getAppName(appId: string): string {
  // Reverse lookup
  for (const [name, id] of Object.entries(APP_IDS)) {
    if (id === appId) {
      return name.charAt(0) + name.slice(1).toLowerCase();
    }
  }
  
  // Unknown app - show truncated ID
  return `Unknown (${appId.substring(0, 10)}...)`;
}

/**
 * Validate app ID format
 */
export function isValidAppId(appId: string): boolean {
  // Must be 32-byte hex string with 0x prefix
  return /^0x[0-9a-f]{64}$/i.test(appId);
}

/**
 * For Solidity tests - generate multiple app IDs
 */
export function generateTestAppIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => getAppId(`test_app_${i}`));
}

// Export as default for convenience
export default {
  getAppId,
  getAppIdViem,
  APP_IDS,
  getAppName,
  isValidAppId,
  generateTestAppIds,
};

