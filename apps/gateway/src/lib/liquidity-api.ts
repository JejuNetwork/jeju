/**
 * Liquidity API - Contract interactions for RiskSleeve and LiquidityRouter
 */

import contractsConfig from '@jejunetwork/config/contracts'
import { type Address, createPublicClient, formatEther, http } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { NETWORK } from '../config/networks'

// Risk tier enum matching the contract
export enum RiskTier {
  CONSERVATIVE = 0,
  BALANCED = 1,
  AGGRESSIVE = 2,
}

export const RISK_TIER_NAMES = [
  'Conservative',
  'Balanced',
  'Aggressive',
] as const
export const RISK_TIER_APY_BPS = [300, 1000, 2000] as const // 3%, 10%, 20%

// Contracts config type
interface ContractsNetworkConfig {
  liquidity?: {
    riskSleeve?: string
    liquidityRouter?: string
    multiServiceStakeManager?: string
  }
}

// Get liquidity contract addresses
function getLiquidityContracts(): ContractsNetworkConfig['liquidity'] {
  const config = contractsConfig as {
    localnet?: ContractsNetworkConfig
    testnet?: ContractsNetworkConfig
    mainnet?: ContractsNetworkConfig
  }
  if (NETWORK === 'testnet') return config.testnet?.liquidity
  if (NETWORK === 'mainnet') return config.mainnet?.liquidity
  return config.localnet?.liquidity
}

// ABI fragments
const RISK_SLEEVE_ABI = [
  {
    name: 'getSleeveStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [
      { name: 'deposited', type: 'uint256' },
      { name: 'utilized', type: 'uint256' },
      { name: 'available', type: 'uint256' },
      { name: 'utilizationBps', type: 'uint256' },
      { name: 'yieldBps', type: 'uint256' },
    ],
  },
  {
    name: 'getUserPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [
      { name: 'deposited', type: 'uint256' },
      { name: 'pendingYield', type: 'uint256' },
      { name: 'depositDuration', type: 'uint256' },
    ],
  },
  {
    name: 'totalDeposits',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const LIQUIDITY_ROUTER_ABI = [
  {
    name: 'getPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'ethVaultShares', type: 'uint256' },
      { name: 'tokenVaultShares', type: 'uint256' },
      { name: 'stakedAmount', type: 'uint256' },
      { name: 'pendingRewards', type: 'uint256' },
      {
        name: 'strategy',
        type: 'tuple',
        components: [
          { name: 'ethVaultBps', type: 'uint256' },
          { name: 'tokenVaultBps', type: 'uint256' },
          { name: 'nodeStakeBps', type: 'uint256' },
          { name: 'xlpStakeBps', type: 'uint256' },
          { name: 'paymasterStakeBps', type: 'uint256' },
          { name: 'governanceStakeBps', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'estimateYield',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'defaultStrategy',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'ethVaultBps', type: 'uint256' },
          { name: 'tokenVaultBps', type: 'uint256' },
          { name: 'nodeStakeBps', type: 'uint256' },
          { name: 'xlpStakeBps', type: 'uint256' },
          { name: 'paymasterStakeBps', type: 'uint256' },
          { name: 'governanceStakeBps', type: 'uint256' },
        ],
      },
    ],
  },
] as const

// Create viem client
const chain = NETWORK === 'testnet' ? baseSepolia : base
const client = createPublicClient({
  chain,
  transport: http(),
})

export interface SleeveStats {
  tier: number
  tierName: string
  deposited: string
  utilized: string
  available: string
  utilizationBps: number
  yieldBps: number
}

export interface SleevePosition {
  address: string
  tier: number
  tierName: string
  deposited: string
  pendingYield: string
  depositDuration: number
}

export interface RouterPosition {
  address: string
  ethVaultShares: string
  tokenVaultShares: string
  stakedAmount: string
  pendingRewards: string
  strategy: {
    ethVaultBps: number
    tokenVaultBps: number
    nodeStakeBps: number
    xlpStakeBps: number
    paymasterStakeBps: number
    governanceStakeBps: number
  }
}

export interface AllocationStrategy {
  ethVaultBps: number
  tokenVaultBps: number
  nodeStakeBps: number
  xlpStakeBps: number
  paymasterStakeBps: number
  governanceStakeBps: number
}

// Check if contracts are deployed
export function isRiskSleeveDeployed(): boolean {
  const contracts = getLiquidityContracts()
  return !!contracts?.riskSleeve && contracts.riskSleeve.length > 0
}

export function isLiquidityRouterDeployed(): boolean {
  const contracts = getLiquidityContracts()
  return !!contracts?.liquidityRouter && contracts.liquidityRouter.length > 0
}

export function getRiskSleeveAddress(): Address | undefined {
  const contracts = getLiquidityContracts()
  return contracts?.riskSleeve && contracts.riskSleeve.length > 0
    ? (contracts.riskSleeve as Address)
    : undefined
}

export function getLiquidityRouterAddress(): Address | undefined {
  const contracts = getLiquidityContracts()
  return contracts?.liquidityRouter && contracts.liquidityRouter.length > 0
    ? (contracts.liquidityRouter as Address)
    : undefined
}

// Get sleeve stats from contract
export async function getSleeveStats(
  tier: RiskTier,
): Promise<SleeveStats | { status: 'not_deployed' }> {
  const address = getRiskSleeveAddress()
  if (!address) {
    return { status: 'not_deployed' }
  }

  const result = await client.readContract({
    address,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getSleeveStats',
    args: [tier],
  })

  return {
    tier,
    tierName: RISK_TIER_NAMES[tier],
    deposited: formatEther(result[0]),
    utilized: formatEther(result[1]),
    available: formatEther(result[2]),
    utilizationBps: Number(result[3]),
    yieldBps: Number(result[4]),
  }
}

// Get user sleeve position
export async function getSleevePosition(
  user: Address,
  tier: RiskTier,
): Promise<SleevePosition | { status: 'not_deployed' }> {
  const address = getRiskSleeveAddress()
  if (!address) {
    return { status: 'not_deployed' }
  }

  const result = await client.readContract({
    address,
    abi: RISK_SLEEVE_ABI,
    functionName: 'getUserPosition',
    args: [user, tier],
  })

  return {
    address: user,
    tier,
    tierName: RISK_TIER_NAMES[tier],
    deposited: formatEther(result[0]),
    pendingYield: formatEther(result[1]),
    depositDuration: Number(result[2]),
  }
}

// Get router position
export async function getRouterPosition(
  user: Address,
): Promise<RouterPosition | { status: 'not_deployed' }> {
  const address = getLiquidityRouterAddress()
  if (!address) {
    return { status: 'not_deployed' }
  }

  const result = await client.readContract({
    address,
    abi: LIQUIDITY_ROUTER_ABI,
    functionName: 'getPosition',
    args: [user],
  })

  return {
    address: user,
    ethVaultShares: formatEther(result[0]),
    tokenVaultShares: formatEther(result[1]),
    stakedAmount: formatEther(result[2]),
    pendingRewards: formatEther(result[3]),
    strategy: {
      ethVaultBps: Number(result[4].ethVaultBps),
      tokenVaultBps: Number(result[4].tokenVaultBps),
      nodeStakeBps: Number(result[4].nodeStakeBps),
      xlpStakeBps: Number(result[4].xlpStakeBps),
      paymasterStakeBps: Number(result[4].paymasterStakeBps),
      governanceStakeBps: Number(result[4].governanceStakeBps),
    },
  }
}

// Get estimated yield
export async function estimateYield(
  user: Address,
): Promise<
  { yieldBps: number; yieldPercent: number } | { status: 'not_deployed' }
> {
  const address = getLiquidityRouterAddress()
  if (!address) {
    return { status: 'not_deployed' }
  }

  const result = await client.readContract({
    address,
    abi: LIQUIDITY_ROUTER_ABI,
    functionName: 'estimateYield',
    args: [user],
  })

  return {
    yieldBps: Number(result),
    yieldPercent: Number(result) / 100,
  }
}

// Get default allocation strategy
export async function getDefaultStrategy(): Promise<
  AllocationStrategy | { status: 'not_deployed' }
> {
  const address = getLiquidityRouterAddress()
  if (!address) {
    return { status: 'not_deployed' }
  }

  const result = await client.readContract({
    address,
    abi: LIQUIDITY_ROUTER_ABI,
    functionName: 'defaultStrategy',
  })

  return {
    ethVaultBps: Number(result.ethVaultBps),
    tokenVaultBps: Number(result.tokenVaultBps),
    nodeStakeBps: Number(result.nodeStakeBps),
    xlpStakeBps: Number(result.xlpStakeBps),
    paymasterStakeBps: Number(result.paymasterStakeBps),
    governanceStakeBps: Number(result.governanceStakeBps),
  }
}

// Get all risk tiers info
export function getRiskTiers() {
  return {
    tiers: [
      {
        id: RiskTier.CONSERVATIVE,
        name: 'Conservative',
        description: 'Low risk, stable yields',
        expectedApyBps: 300,
        minDeposit: '0.01 ETH',
      },
      {
        id: RiskTier.BALANCED,
        name: 'Balanced',
        description: 'Moderate risk with competitive returns',
        expectedApyBps: 1000,
        minDeposit: '0.01 ETH',
      },
      {
        id: RiskTier.AGGRESSIVE,
        name: 'Aggressive',
        description: 'Higher risk, higher potential returns',
        expectedApyBps: 2000,
        minDeposit: '0.01 ETH',
      },
    ],
  }
}
