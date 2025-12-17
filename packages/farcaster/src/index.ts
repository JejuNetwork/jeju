/**
 * @fileoverview Permissionless Farcaster Integration for Jeju Network
 * 
 * No API keys required - connects directly to Farcaster Hub nodes.
 * 
 * @example
 * ```typescript
 * import { FarcasterClient } from '@jeju/farcaster';
 * 
 * const client = new FarcasterClient({
 *   hubUrl: 'hub.testnet.jejunetwork.org:2283', // Self-hosted hub
 * });
 * 
 * const profile = await client.getProfile(123);
 * const casts = await client.getCasts(123);
 * ```
 */

export * from './hub/client';
export * from './hub/types';
export * from './frames/types';
export * from './identity/link';

