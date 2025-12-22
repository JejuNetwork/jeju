/**
 * Network SDK - Complete protocol access
 *
 * @example
 * ```ts
 * import { createJejuClient } from '@jejunetwork/sdk';
 *
 * const jeju = await createJejuClient({
 *   network: 'testnet',
 *   privateKey: '0x...',
 * });
 *
 * // Compute
 * await jeju.compute.listProviders();
 * await jeju.compute.createRental({ provider, durationHours: 2 });
 *
 * // Storage
 * await jeju.storage.upload(file);
 *
 * // DeFi
 * await jeju.defi.swap({ tokenIn, tokenOut, amountIn });
 *
 * // Cross-chain
 * await jeju.crosschain.transfer({ from: 'base', to: 'arbitrum', amount });
 * ```
 */
export * from './a2a'
export * from './agents'
export * from './amm'
export * from './bridge'
export * from './cdn'
// CI/CD
export * from './cicd'
export type { JejuClient, JejuClientConfig } from './client'
export { createJejuClient } from './client'
// Module exports
export * from './compute'
export * from './containers'
// Contract utilities
export * from './contracts'
export * from './crosschain'
// Datasets (training data)
export * from './datasets'
export * from './defi'
export * from './distributor'
export * from './dws'
// Email client
export * from './email'
export * from './federation'
// Social Feed (Farcaster)
export * from './feed'
// Extended modules
export * from './games'
// Developer tools
export * from './git'
export * from './governance'
export * from './identity'
export * from './launchpad'
export * from './liquidity'
// MCP (Model Context Protocol)
export * from './mcp'
export * from './messaging'
// Models (HuggingFace-like)
export * from './models'
export * from './moderation'
export * from './names'
export * from './nfts'
export * from './oracle'
export * from './otc'
export * from './packages'
export * from './payments'
export * from './perps'
export * from './prediction'
export * from './sequencer'
export * from './staking'
export * from './storage'
export * from './training'
export * from './validation'
// VPN
export * from './vpn'
export * from './vpn-module'
// Wallet utilities
export * from './wallet'
export * from './work'
