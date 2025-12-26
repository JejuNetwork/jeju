/**
 * DWS Infrastructure Seed
 *
 * Seeds the permissionless infrastructure on DWS startup:
 * 1. External chain RPC nodes (Ethereum, Arbitrum, Optimism, Base, Solana)
 * 2. MEV/Arbitrage bots via Crucible integration
 *
 * Network Modes:
 * - localnet: Docker containers with Anvil forks, instant startup
 * - testnet: DWS-provisioned nodes, lighter infrastructure
 * - mainnet: Full archive nodes with TEE, production bots
 *
 * Runs automatically on startup - no flags needed.
 */

import { getCurrentNetwork, type NetworkType } from '@jejunetwork/config'
import { initializeExternalRPCNodes, type ChainType } from '../external-chains'
import { initializeBotDeployment, type BotType } from '../bots'

// ============================================================================
// Configuration
// ============================================================================

// Chains to provision per network
const CHAINS_BY_NETWORK: Record<NetworkType, ChainType[]> = {
  localnet: ['ethereum', 'arbitrum', 'optimism', 'base'], // Skip Solana locally (CPU issues)
  testnet: ['ethereum', 'arbitrum', 'optimism', 'base', 'solana'],
  mainnet: ['ethereum', 'arbitrum', 'optimism', 'base', 'solana'],
}

// Bots to deploy per network
const BOTS_BY_NETWORK: Record<NetworkType, BotType[]> = {
  localnet: [
    'DEX_ARBITRAGE',
    'ORACLE_KEEPER',
    'OIF_SOLVER',
  ],
  testnet: [
    'DEX_ARBITRAGE',
    'LIQUIDATION',
    'ORACLE_KEEPER',
    'CROSS_CHAIN_ARBITRAGE',
    'OIF_SOLVER',
  ],
  mainnet: [
    'DEX_ARBITRAGE',
    'SANDWICH',
    'LIQUIDATION',
    'ORACLE_KEEPER',
    'CROSS_CHAIN_ARBITRAGE',
    'OIF_SOLVER',
  ],
}

// ============================================================================
// Types
// ============================================================================

export interface SeedResult {
  network: NetworkType
  nodesProvisioned: number
  nodesReady: number
  botsDeployed: number
  botsRunning: number
  errors: string[]
  startedAt: number
  completedAt: number
}

// ============================================================================
// State
// ============================================================================

let seedComplete = false
let seedResult: SeedResult | null = null
let seedPromise: Promise<SeedResult> | null = null

// ============================================================================
// Seed Function
// ============================================================================

/**
 * Seed the DWS infrastructure
 * Called automatically on DWS/Crucible startup
 */
export async function seedInfrastructure(
  treasuryAddress: `0x${string}`,
): Promise<SeedResult> {
  // Return cached result if already seeded
  if (seedComplete && seedResult) {
    return seedResult
  }

  // Return existing promise if seed is in progress
  if (seedPromise) {
    return seedPromise
  }

  seedPromise = doSeed(treasuryAddress)
  return seedPromise
}

async function doSeed(treasuryAddress: `0x${string}`): Promise<SeedResult> {
  const network = getCurrentNetwork()
  const startedAt = Date.now()

  const result: SeedResult = {
    network,
    nodesProvisioned: 0,
    nodesReady: 0,
    botsDeployed: 0,
    botsRunning: 0,
    errors: [],
    startedAt,
    completedAt: 0,
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('DWS INFRASTRUCTURE SEED')
  console.log('='.repeat(60))
  console.log(`Network:  ${network}`)
  console.log(`Treasury: ${treasuryAddress}`)
  console.log('')

  const chainsToProvision = CHAINS_BY_NETWORK[network]
  const botsToDeply = BOTS_BY_NETWORK[network]

  // Step 1: Provision External Chain Nodes
  console.log('Step 1: Provisioning external chain nodes')
  console.log('-'.repeat(40))

  const rpcService = await initializeExternalRPCNodes()

  for (const chain of chainsToProvision) {
    try {
      const node = await rpcService.provisionNode(chain)
      result.nodesProvisioned++
      if (node.status === 'active') {
        result.nodesReady++
        console.log(`  ${chain.padEnd(12)} READY (${node.rpcEndpoint})`)
      } else {
        console.log(`  ${chain.padEnd(12)} ${node.status.toUpperCase()}`)
      }
    } catch (err) {
      const msg = `${chain}: ${err}`
      console.error(`  ${chain.padEnd(12)} FAILED - ${err}`)
      result.errors.push(msg)
    }
  }

  console.log('')
  console.log(`Nodes: ${result.nodesReady}/${result.nodesProvisioned} ready`)
  console.log('')

  // Step 2: Deploy Bots (only if nodes are ready)
  if (result.nodesReady > 0) {
    console.log('Step 2: Deploying bots')
    console.log('-'.repeat(40))

    const botService = await initializeBotDeployment()

    for (const botType of botsToDeply) {
      try {
        const bot = await botService.deployBot(botType, treasuryAddress)
        result.botsDeployed++
        if (bot.status === 'running') {
          result.botsRunning++
          console.log(`  ${botType.padEnd(24)} RUNNING`)
        } else {
          console.log(`  ${botType.padEnd(24)} ${bot.status.toUpperCase()}`)
        }
      } catch (err) {
        const msg = `${botType}: ${err}`
        console.error(`  ${botType.padEnd(24)} FAILED - ${err}`)
        result.errors.push(msg)
      }
    }

    console.log('')
    console.log(`Bots: ${result.botsRunning}/${result.botsDeployed} running`)
  } else {
    console.log('Step 2: Skipping bots - no nodes ready')
  }

  result.completedAt = Date.now()
  seedComplete = true
  seedResult = result

  console.log('')
  console.log('='.repeat(60))
  console.log('SEED COMPLETE')
  console.log(`Duration: ${result.completedAt - result.startedAt}ms`)
  if (result.errors.length > 0) {
    console.log(`Errors:   ${result.errors.length}`)
  }
  console.log('='.repeat(60))
  console.log('')

  return result
}

// ============================================================================
// Status Functions
// ============================================================================

/**
 * Get the current seed status
 */
export function getSeedStatus(): SeedResult | null {
  return seedResult
}

/**
 * Check if seed is complete
 */
export function isSeedComplete(): boolean {
  return seedComplete
}

/**
 * Reset seed state (for testing)
 */
export function resetSeed(): void {
  seedComplete = false
  seedResult = null
  seedPromise = null
}

/**
 * Wait for seed to complete (useful in tests)
 */
export async function waitForSeed(): Promise<SeedResult | null> {
  if (seedPromise) {
    return seedPromise
  }
  return seedResult
}
