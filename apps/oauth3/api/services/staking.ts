import type { Address } from 'viem'
import { createPublicClient, http, parseAbi } from 'viem'
import { foundry, mainnet, sepolia } from 'viem/chains'
import {
  CLIENT_TIER_THRESHOLDS,
  type ClientStakeInfo,
  type ClientTier,
  ClientTier as Tier,
} from '../../lib/types'

const STAKING_ABI = parseAbi([
  'function getPosition(address) view returns ((uint256, uint256, uint256, uint256, uint256, uint256, bool, bool))',
  'function getTier(address) view returns (uint8)',
  'function getEffectiveUsdValue(address) view returns (uint256)',
])

function getStakingContractAddress(): Address | null {
  const envAddress = process.env.STAKING_CONTRACT_ADDRESS
  if (envAddress) {
    return envAddress as Address
  }

  try {
    const { readFileSync, existsSync } = require('node:fs')
    const { join } = require('node:path')

    const possiblePaths = [
      join(
        process.cwd(),
        '../../packages/contracts/deployments/localnet-complete.json',
      ),
      join(
        process.cwd(),
        '../packages/contracts/deployments/localnet-complete.json',
      ),
      join(
        process.cwd(),
        'packages/contracts/deployments/localnet-complete.json',
      ),
    ]

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, 'utf-8'))
        const address = data?.contracts?.oauth3Staking
        if (
          address &&
          address !== '0x0000000000000000000000000000000000000000'
        ) {
          return address as Address
        }
      }
    }
  } catch {
    // Ignore
  }

  return null
}

function getPublicClient() {
  const rpcUrl = process.env.RPC_URL ?? 'http://localhost:8545'
  const network = process.env.NETWORK ?? 'localnet'

  const chain =
    network === 'mainnet' ? mainnet : network === 'testnet' ? sepolia : foundry

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
}

export function getTierForAmount(amount: bigint): ClientTier {
  if (amount >= CLIENT_TIER_THRESHOLDS[Tier.ENTERPRISE]) return Tier.ENTERPRISE
  if (amount >= CLIENT_TIER_THRESHOLDS[Tier.PRO]) return Tier.PRO
  if (amount >= CLIENT_TIER_THRESHOLDS[Tier.BASIC]) return Tier.BASIC
  return Tier.FREE
}

export async function verifyStake(owner: Address): Promise<{
  valid: boolean
  stake?: ClientStakeInfo
  error?: string
}> {
  const stakingAddress = getStakingContractAddress()

  if (!stakingAddress) {
    return {
      valid: true,
      stake: {
        amount: 0n,
        tier: Tier.FREE,
        verifiedAt: Date.now(),
      },
    }
  }

  const client = getPublicClient()

  type StakePosition = readonly [
    stakedAmount: bigint,
    stakedAt: bigint,
    linkedAgentId: bigint,
    reputationBonus: bigint,
    unbondingAmount: bigint,
    unbondingStartTime: bigint,
    isActive: boolean,
    isFrozen: boolean,
  ]

  let positionTuple: StakePosition

  try {
    positionTuple = (await client.readContract({
      address: stakingAddress,
      abi: STAKING_ABI,
      functionName: 'getPosition',
      args: [owner],
    })) as StakePosition
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[Staking] Contract call failed for ${owner}: ${message}`)
    return { valid: false, error: `contract_call_failed: ${message}` }
  }

  const [stakedAmount, , , , , , isActive, isFrozen] = positionTuple

  if (isFrozen) {
    return { valid: false, error: 'stake_frozen' }
  }

  if (!isActive && stakedAmount === 0n) {
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

export function getMinStakeForTier(tier: ClientTier): bigint {
  return CLIENT_TIER_THRESHOLDS[tier]
}
