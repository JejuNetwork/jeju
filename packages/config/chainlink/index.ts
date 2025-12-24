/**
 * @fileoverview Chainlink Configuration
 * @module config/chainlink
 *
 * Provides validated access to Chainlink data feeds, VRF, and automation configs.
 */

import { z } from 'zod'
import automation from './automation.json'
import feeds from './feeds.json'
import nodes from './nodes.json'
import staking from './staking.json'
import vrf from './vrf.json'

export { feeds, staking, vrf, automation, nodes }

// Zod Schemas

/** Ethereum address - 40 hex characters prefixed with 0x */
const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')

/** Chain ID string key (numeric string like "1", "8453") */
const ChainIdKeySchema = z
  .string()
  .regex(/^\d+$/, 'Chain ID must be numeric string')

const FeedEntrySchema = z.object({
  address: AddressSchema,
  decimals: z.number().int().min(0).max(18),
  heartbeatSeconds: z.number().int().positive().max(86400),
})

const FeedsConfigSchema = z.object({
  linkToken: z.record(ChainIdKeySchema, AddressSchema),
  chains: z.record(
    ChainIdKeySchema,
    z.record(z.string().min(1), FeedEntrySchema),
  ),
  relayConfig: z.object({
    updateThresholdBps: z.number().int().positive().max(10000),
    minSourcesForConsensus: z.number().int().positive().max(100),
    maxStalenessSeconds: z.number().int().positive().max(86400),
    priorityChains: z.array(z.number().int().positive()),
  }),
})

/** Bytes32 hash - 64 hex characters prefixed with 0x */
const Bytes32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid bytes32 hash')

const VRFChainConfigSchema = z.object({
  coordinator: AddressSchema,
  wrapper: AddressSchema,
  linkToken: AddressSchema,
  linkEthFeed: AddressSchema,
  keyHash: Bytes32Schema,
  callbackGasLimit: z.number().int().positive().max(10_000_000),
  requestConfirmations: z.number().int().min(1).max(200),
  numWords: z.number().int().min(1).max(500),
  status: z.enum(['pending_deployment', 'reference', 'active']),
})

const VRFConfigSchema = z.object({
  chains: z.record(ChainIdKeySchema, VRFChainConfigSchema),
  jejuVrfConfig: z.object({
    description: z.string().min(1),
    pricing: z.object({
      linkPremiumPpm: z.number().int().nonnegative(),
      nativePremiumPpm: z.number().int().nonnegative(),
      flatFeeLinkPpm: z.number().int().nonnegative(),
      flatFeeNativePpm: z.number().int().nonnegative(),
    }),
    limits: z.object({
      maxGasLimit: z.number().int().positive(),
      maxNumWords: z.number().int().positive(),
      minRequestConfirmations: z.number().int().positive(),
      maxRequestConfirmations: z.number().int().positive(),
    }),
    governance: z.object({
      feeRecipient: z.string().min(1),
      feeUpdateProposalRequired: z.boolean(),
      maxFeeIncreaseBps: z.number().int().nonnegative().max(10000),
    }),
  }),
})

/** ETH amount string (e.g., "0.1", "1.0") */
const EthAmountSchema = z.string().regex(/^\d+(\.\d+)?$/, 'Invalid ETH amount')

const AutomationChainConfigSchema = z.object({
  registry: AddressSchema,
  registrar: AddressSchema,
  minBalance: EthAmountSchema,
  defaultGasLimit: z.number().int().positive().max(10_000_000),
  maxGasLimit: z.number().int().positive().max(30_000_000),
  keeperRewardBps: z.number().int().nonnegative().max(10000),
  protocolFeeBps: z.number().int().nonnegative().max(10000),
  status: z.enum(['pending_deployment', 'active']),
})

/** Selection algorithm types */
const SelectionAlgorithmSchema = z.enum([
  'round_robin',
  'round_robin_weighted',
  'weighted',
  'random',
  'reputation',
])

const AutomationConfigSchema = z.object({
  chains: z.record(ChainIdKeySchema, AutomationChainConfigSchema),
  jejuAutomationConfig: z.object({
    description: z.string().min(1),
    keeper: z.object({
      minStakeEth: EthAmountSchema,
      maxKeepers: z.number().int().positive().max(1000),
      selectionAlgorithm: SelectionAlgorithmSchema,
      performanceThreshold: z.number().min(0).max(1),
    }),
    upkeep: z.object({
      minBalanceEth: EthAmountSchema,
      maxUpkeepsPerAddress: z.number().int().positive().max(1000),
      defaultCheckGasLimit: z.number().int().positive().max(10_000_000),
      defaultPerformGasLimit: z.number().int().positive().max(10_000_000),
      minInterval: z.number().int().positive(),
      maxInterval: z.number().int().positive(),
    }),
    fees: z.object({
      registrationFeeEth: EthAmountSchema,
      performPremiumBps: z.number().int().nonnegative().max(10000),
      cancellationFeeBps: z.number().int().nonnegative().max(10000),
    }),
    governance: z.object({
      feeRecipient: z.string().min(1),
      keeperApprovalRequired: z.boolean(),
      parameterUpdateDelay: z.number().int().nonnegative(),
    }),
  }),
  officialChainlinkAutomation: z
    .object({
      description: z.string().min(1),
    })
    .catchall(
      z.object({
        registry: z.string().min(1),
        registrar: z.string().min(1),
      }),
    ),
})

// Types

export interface ChainlinkFeed {
  pair: string
  address: string
  decimals: number
  heartbeatSeconds: number
}

export interface VRFConfig {
  coordinator: string
  wrapper: string
  linkToken: string
  linkEthFeed: string
  keyHash: string
  callbackGasLimit: number
  requestConfirmations: number
  numWords: number
  status: 'pending_deployment' | 'reference' | 'active'
}

export interface AutomationConfig {
  registry: string
  registrar: string
  minBalance: string
  defaultGasLimit: number
  maxGasLimit: number
  keeperRewardBps: number
  protocolFeeBps: number
  status: 'pending_deployment' | 'active'
}

// Config Accessors (validated on first access)

let feedsValidated = false
let vrfValidated = false
let automationValidated = false

function validateFeeds(): void {
  if (feedsValidated) return
  FeedsConfigSchema.parse(feeds)
  feedsValidated = true
}

function validateVRF(): void {
  if (vrfValidated) return
  VRFConfigSchema.parse(vrf)
  vrfValidated = true
}

function validateAutomation(): void {
  if (automationValidated) return
  AutomationConfigSchema.parse(automation)
  automationValidated = true
}

// Public API

export function getChainlinkFeeds(chainId: number): ChainlinkFeed[] {
  validateFeeds()
  const chainFeeds =
    feeds.chains[chainId.toString() as keyof typeof feeds.chains]
  if (!chainFeeds) {
    throw new Error(`Chainlink feeds not configured for chain ${chainId}`)
  }
  return Object.entries(chainFeeds).map(([pair, config]) => ({
    pair,
    address: config.address,
    decimals: config.decimals,
    heartbeatSeconds: config.heartbeatSeconds,
  }))
}

export function getChainlinkFeed(chainId: number, pair: string): ChainlinkFeed {
  validateFeeds()
  const chainFeeds =
    feeds.chains[chainId.toString() as keyof typeof feeds.chains]
  if (!chainFeeds) {
    throw new Error(`Chainlink feeds not configured for chain ${chainId}`)
  }
  const feedConfig = chainFeeds[pair as keyof typeof chainFeeds]
  if (!feedConfig) {
    throw new Error(
      `Chainlink feed ${pair} not configured for chain ${chainId}`,
    )
  }
  return {
    pair,
    address: feedConfig.address,
    decimals: feedConfig.decimals,
    heartbeatSeconds: feedConfig.heartbeatSeconds,
  }
}

export function getVRFConfig(chainId: number): VRFConfig {
  validateVRF()
  const config = vrf.chains[chainId.toString() as keyof typeof vrf.chains]
  if (!config) {
    throw new Error(`Chainlink VRF not configured for chain ${chainId}`)
  }
  return config
}

export function getAutomationConfig(chainId: number): AutomationConfig {
  validateAutomation()
  const config =
    automation.chains[chainId.toString() as keyof typeof automation.chains]
  if (!config) {
    throw new Error(`Chainlink Automation not configured for chain ${chainId}`)
  }
  return config
}

export function getLinkTokenAddress(chainId: number): string {
  validateFeeds()
  const address =
    feeds.linkToken[chainId.toString() as keyof typeof feeds.linkToken]
  if (!address) {
    throw new Error(`LINK token address not configured for chain ${chainId}`)
  }
  return address
}

export function getSupportedChainIds(): number[] {
  validateFeeds()
  return Object.keys(feeds.chains).map(Number)
}

export function hasChainlinkSupport(chainId: number): boolean {
  return chainId.toString() in feeds.chains
}
