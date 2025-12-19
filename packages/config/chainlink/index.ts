/**
 * Chainlink Configuration
 * 
 * Central configuration for all Chainlink integrations:
 * - Data Feeds (price oracles)
 * - VRF (verifiable randomness)
 * - Automation (keepers)
 * - Node operation
 * - LINK staking
 */

import feeds from './feeds.json';
import staking from './staking.json';
import vrf from './vrf.json';
import automation from './automation.json';
import nodes from './nodes.json';

export { feeds, staking, vrf, automation, nodes };

export interface ChainlinkFeed {
  pair: string;
  address: string;
  decimals: number;
  heartbeatSeconds: number;
}

export interface ChainlinkStakingConfig {
  contractAddress: string;
  minStake: string;
  maxStake: string;
  unbondingPeriodDays: number;
  estimatedApy: number;
}

export interface VRFConfig {
  coordinator: string;
  keyHash: string;
  callbackGasLimit: number;
  requestConfirmations: number;
  linkPremiumPpm: number;
}

export interface AutomationConfig {
  registry: string;
  minBalance: string;
  defaultGasLimit: number;
  keeperRewardBps: number;
}

export function getChainlinkFeeds(chainId: number): ChainlinkFeed[] {
  const chainFeeds = feeds.chains[chainId.toString() as keyof typeof feeds.chains];
  if (!chainFeeds) return [];
  return Object.entries(chainFeeds).map(([pair, config]) => ({
    pair,
    ...(config as Omit<ChainlinkFeed, 'pair'>),
  }));
}

export function getVRFConfig(chainId: number): VRFConfig | null {
  const config = vrf.chains[chainId.toString() as keyof typeof vrf.chains];
  return config ?? null;
}

export function getAutomationConfig(chainId: number): AutomationConfig | null {
  const config = automation.chains[chainId.toString() as keyof typeof automation.chains];
  return config ?? null;
}

export function getStakingConfig(): ChainlinkStakingConfig {
  return staking.ethereum;
}

export function getLinkTokenAddress(chainId: number): string | null {
  const token = feeds.linkToken[chainId.toString() as keyof typeof feeds.linkToken];
  return token ?? null;
}

