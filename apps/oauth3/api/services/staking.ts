/**
 * Staking verification service for OAuth3 client registration.
 * Verifies on-chain stake amounts and tiers.
 * REQUIRES staking contract - no fallback.
 */

import type { Address } from 'viem'
import { createPublicClient, http, parseAbi } from 'viem'
import { foundry, mainnet, sepolia } from 'viem/chains'
import {
  CLIENT_TIER_THRESHOLDS,
  type ClientStakeInfo,
  type ClientTier,
  ClientTier as Tier,
} from '../../lib/types'

// Staking contract ABI matching Staking.sol
const STAKING_ABI = parseAbi([
  'function getPosition(address) view returns (tuple(uint256 stakedAmount, uint256 stakedAt, uint256 linkedAgentId, uint256 reputationBonus, uint256 unbondingAmount, uint256 unbondingStartTime, bool isActive, bool isFrozen))',
  'function getTier(address) view returns (uint8)',
  'function getEffectiveUsdValue(address) view returns (uint256)',
])

// Get RPC URL from environment - REQUIRED
function getRpcUrl(): string {
  const rpcUrl = process.env.RPC_URL
  if (!rpcUrl) {
    throw new Error(
      'RPC_URL environment variable is required.\n' +
        'For local development with anvil: RPC_URL=http://localhost:8545\n' +
        'Use `bun run start` to start all dependencies including anvil.',
    )
  }
  return rpcUrl
}

// Get staking contract address from env or localnet deployment
function getStakingContractAddress(): Address {
  // First check environment variable
  const envAddress = process.env.STAKING_CONTRACT_ADDRESS
  if (envAddress) {
    return envAddress as Address
  }

  // Try to load from localnet bootstrap output
  try {
    const { readFileSync, existsSync } = require('fs')
    const { join } = require('path')
    
    // Look for localnet-complete.json in the monorepo
    const possiblePaths = [
      join(process.cwd(), '../../packages/contracts/deployments/localnet-complete.json'),
      join(process.cwd(), '../packages/contracts/deployments/localnet-complete.json'),
      join(process.cwd(), 'packages/contracts/deployments/localnet-complete.json'),
    ]

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, 'utf-8'))
        const address = data?.contracts?.oauth3Staking
        if (address && address !== '0x0000000000000000000000000000000000000000') {
          console.log(`[Staking] Loaded staking contract from ${path}: ${address}`)
          return address as Address
        }
      }
    }
  } catch {
    // Ignore errors loading from file
  }

  throw new Error(
    'STAKING_CONTRACT_ADDRESS not found.\n' +
      'Either set STAKING_CONTRACT_ADDRESS environment variable, or\n' +
      'run `bun run start` (or `jeju dev`) to bootstrap contracts.',
  )
}

// Create public client for on-chain reads
function getPublicClient() {
  const rpcUrl = getRpcUrl()
  const network = process.env.NETWORK ?? 'localnet'

  // Determine chain based on network
  let chain
  switch (network) {
    case 'mainnet':
      chain = mainnet
      break
    case 'sepolia':
    case 'testnet':
      chain = sepolia
      break
    default:
      // Use foundry chain for local anvil
      chain = foundry
      break
  }

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
}

/**
 * Determine tier based on stake amount.
 */
export function getTierForAmount(amount: bigint): ClientTier {
  if (amount >= CLIENT_TIER_THRESHOLDS[Tier.ENTERPRISE]) return Tier.ENTERPRISE
  if (amount >= CLIENT_TIER_THRESHOLDS[Tier.PRO]) return Tier.PRO
  if (amount >= CLIENT_TIER_THRESHOLDS[Tier.BASIC]) return Tier.BASIC
  return Tier.FREE
}

/**
 * Verify staking amount for an address.
 * Returns stake info including amount and tier.
 * REQUIRES staking contract to be deployed and configured.
 */
export async function verifyStake(owner: Address): Promise<{
  valid: boolean
  stake?: ClientStakeInfo
  error?: string
}> {
  const stakingAddress = getStakingContractAddress()
  const client = getPublicClient()

  // Get stake position from contract
  let position: {
    stakedAmount: bigint
    stakedAt: bigint
    linkedAgentId: bigint
    reputationBonus: bigint
    unbondingAmount: bigint
    unbondingStartTime: bigint
    isActive: boolean
    isFrozen: boolean
  }

  try {
    position = await client.readContract({
      address: stakingAddress,
      abi: STAKING_ABI,
      functionName: 'getPosition',
      args: [owner],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[Staking] Contract call failed for ${owner}: ${message}`)
    return { valid: false, error: `contract_call_failed: ${message}` }
  }

  const { stakedAmount, isActive, isFrozen } = position

  if (isFrozen) {
    return { valid: false, error: 'stake_frozen' }
  }

  if (!isActive && stakedAmount === 0n) {
    // No stake - allowed for FREE tier
    return {
      valid: true,
      stake: {
        amount: 0n,
        tier: Tier.FREE,
        verifiedAt: Date.now(),
      },
    }
  }

  const tier = getTierForAmount(stakedAmount)

  return {
    valid: true,
    stake: {
      amount: stakedAmount,
      tier,
      verifiedAt: Date.now(),
    },
  }
}

/**
 * Get minimum stake required for a tier.
 */
export function getMinStakeForTier(tier: ClientTier): bigint {
  return CLIENT_TIER_THRESHOLDS[tier]
}
