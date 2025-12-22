/**
 * @fileoverview Chainlink Configuration
 * @module config/chainlink
 * 
 * Provides validated access to Chainlink data feeds, VRF, and automation configs.
 */

import { z } from 'zod';
import feeds from './feeds.json';
import staking from './staking.json';
import vrf from './vrf.json';
import automation from './automation.json';
import nodes from './nodes.json';

export { feeds, staking, vrf, automation, nodes };

// ============================================================================
// Zod Schemas
// ============================================================================

const FeedEntrySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  decimals: z.number().int().positive(),
  heartbeatSeconds: z.number().int().positive(),
});

const FeedsConfigSchema = z.object({
  linkToken: z.record(z.string(), z.string()),
  chains: z.record(z.string(), z.record(z.string(), FeedEntrySchema)),
  relayConfig: z.object({
    updateThresholdBps: z.number().int().positive(),
    minSourcesForConsensus: z.number().int().positive(),
    maxStalenessSeconds: z.number().int().positive(),
    priorityChains: z.array(z.number()),
  }),
});

const VRFChainConfigSchema = z.object({
  coordinator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  wrapper: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  linkToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  linkEthFeed: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  keyHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  callbackGasLimit: z.number().int().positive(),
  requestConfirmations: z.number().int().positive(),
  numWords: z.number().int().positive(),
  status: z.enum(['pending_deployment', 'reference', 'active']),
});

const VRFConfigSchema = z.object({
  chains: z.record(z.string(), VRFChainConfigSchema),
  jejuVrfConfig: z.object({
    description: z.string(),
    pricing: z.object({
      linkPremiumPpm: z.number(),
      nativePremiumPpm: z.number(),
      flatFeeLinkPpm: z.number(),
      flatFeeNativePpm: z.number(),
    }),
    limits: z.object({
      maxGasLimit: z.number(),
      maxNumWords: z.number(),
      minRequestConfirmations: z.number(),
      maxRequestConfirmations: z.number(),
    }),
    governance: z.object({
      feeRecipient: z.string(),
      feeUpdateProposalRequired: z.boolean(),
      maxFeeIncreaseBps: z.number(),
    }),
  }),
});

const AutomationChainConfigSchema = z.object({
  registry: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  registrar: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  minBalance: z.string(),
  defaultGasLimit: z.number().int().positive(),
  maxGasLimit: z.number().int().positive(),
  keeperRewardBps: z.number().int().nonnegative(),
  protocolFeeBps: z.number().int().nonnegative(),
  status: z.enum(['pending_deployment', 'active']),
});

const AutomationConfigSchema = z.object({
  chains: z.record(z.string(), AutomationChainConfigSchema),
  jejuAutomationConfig: z.object({
    description: z.string(),
    keeper: z.object({
      minStakeEth: z.string(),
      maxKeepers: z.number(),
      selectionAlgorithm: z.string(),
      performanceThreshold: z.number(),
    }),
    upkeep: z.object({
      minBalanceEth: z.string(),
      maxUpkeepsPerAddress: z.number(),
      defaultCheckGasLimit: z.number(),
      defaultPerformGasLimit: z.number(),
      minInterval: z.number(),
      maxInterval: z.number(),
    }),
    fees: z.object({
      registrationFeeEth: z.string(),
      performPremiumBps: z.number(),
      cancellationFeeBps: z.number(),
    }),
    governance: z.object({
      feeRecipient: z.string(),
      keeperApprovalRequired: z.boolean(),
      parameterUpdateDelay: z.number(),
    }),
  }),
  officialChainlinkAutomation: z.object({
    description: z.string(),
  }).catchall(z.object({
    registry: z.string(),
    registrar: z.string(),
  })),
});

// ============================================================================
// Types
// ============================================================================

export interface ChainlinkFeed {
  pair: string;
  address: string;
  decimals: number;
  heartbeatSeconds: number;
}

export interface VRFConfig {
  coordinator: string;
  wrapper: string;
  linkToken: string;
  linkEthFeed: string;
  keyHash: string;
  callbackGasLimit: number;
  requestConfirmations: number;
  numWords: number;
  status: 'pending_deployment' | 'reference' | 'active';
}

export interface AutomationConfig {
  registry: string;
  registrar: string;
  minBalance: string;
  defaultGasLimit: number;
  maxGasLimit: number;
  keeperRewardBps: number;
  protocolFeeBps: number;
  status: 'pending_deployment' | 'active';
}

// ============================================================================
// Config Accessors (validated on first access)
// ============================================================================

let feedsValidated = false;
let vrfValidated = false;
let automationValidated = false;

function validateFeeds(): void {
  if (feedsValidated) return;
  FeedsConfigSchema.parse(feeds);
  feedsValidated = true;
}

function validateVRF(): void {
  if (vrfValidated) return;
  VRFConfigSchema.parse(vrf);
  vrfValidated = true;
}

function validateAutomation(): void {
  if (automationValidated) return;
  AutomationConfigSchema.parse(automation);
  automationValidated = true;
}

// ============================================================================
// Public API
// ============================================================================

export function getChainlinkFeeds(chainId: number): ChainlinkFeed[] {
  validateFeeds();
  const chainFeeds = feeds.chains[chainId.toString() as keyof typeof feeds.chains];
  if (!chainFeeds) {
    throw new Error(`Chainlink feeds not configured for chain ${chainId}`);
  }
  return Object.entries(chainFeeds).map(([pair, config]) => ({
    pair,
    address: config.address,
    decimals: config.decimals,
    heartbeatSeconds: config.heartbeatSeconds,
  }));
}

export function getChainlinkFeed(chainId: number, pair: string): ChainlinkFeed {
  validateFeeds();
  const chainFeeds = feeds.chains[chainId.toString() as keyof typeof feeds.chains];
  if (!chainFeeds) {
    throw new Error(`Chainlink feeds not configured for chain ${chainId}`);
  }
  const feedConfig = chainFeeds[pair as keyof typeof chainFeeds];
  if (!feedConfig) {
    throw new Error(`Chainlink feed ${pair} not configured for chain ${chainId}`);
  }
  return {
    pair,
    address: feedConfig.address,
    decimals: feedConfig.decimals,
    heartbeatSeconds: feedConfig.heartbeatSeconds,
  };
}

export function getVRFConfig(chainId: number): VRFConfig {
  validateVRF();
  const config = vrf.chains[chainId.toString() as keyof typeof vrf.chains];
  if (!config) {
    throw new Error(`Chainlink VRF not configured for chain ${chainId}`);
  }
  return config;
}

export function getAutomationConfig(chainId: number): AutomationConfig {
  validateAutomation();
  const config = automation.chains[chainId.toString() as keyof typeof automation.chains];
  if (!config) {
    throw new Error(`Chainlink Automation not configured for chain ${chainId}`);
  }
  return config;
}

export function getLinkTokenAddress(chainId: number): string {
  validateFeeds();
  const address = feeds.linkToken[chainId.toString() as keyof typeof feeds.linkToken];
  if (!address) {
    throw new Error(`LINK token address not configured for chain ${chainId}`);
  }
  return address;
}

export function getSupportedChainIds(): number[] {
  validateFeeds();
  return Object.keys(feeds.chains).map(Number);
}

export function hasChainlinkSupport(chainId: number): boolean {
  return chainId.toString() in feeds.chains;
}
