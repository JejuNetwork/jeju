/**
 * Indexer initialization and contract registry
 */

// Mute verbose squid processor logs in dev (set before any subsquid imports)
// Only show warnings and errors, not INFO level block processing logs
if (!process.env.SQD_LOG_LEVEL) {
  process.env.SQD_LOG_LEVEL = 'WARN'
}

import 'reflect-metadata'
// Import ALL models via the index file which handles circular dependency ordering
// The index.ts imports all models as side effects first, then exports them
import '../src/model'

import { getContract, getCurrentNetwork } from '@jejunetwork/config'
import { config } from './config'
import { type ContractInfo, registerContract } from './contract-events'
import { configureDWSDatabase } from './dws-database'
import { getContractAddressSet, loadNetworkConfig } from './network-config'
import { registerTFMMPool } from './tfmm-processor'

const CONTRACT_TYPES: Record<string, ContractInfo['type']> = {
  entryPoint: 'paymaster',
  priceOracle: 'oracle',
  serviceRegistry: 'cloud',
  creditManager: 'cloud',
  tokenRegistry: 'paymaster',
  paymasterFactory: 'paymaster',
  liquidityPaymaster: 'paymaster',
  multiTokenPaymaster: 'paymaster',
  identityRegistry: 'registry',
  reputationRegistry: 'registry',
  validationRegistry: 'registry',
  registryGovernance: 'registry',
  liquidityVault: 'defi',
  feeDistributor: 'defi',
  poolManager: 'defi',
  swapRouter: 'defi',
  nodeStakingManager: 'node',
  nodePerformanceOracle: 'oracle',
  autoSlasher: 'node',
  multiOracleConsensus: 'oracle',
  banManager: 'moderation',
  reputationLabelManager: 'moderation',
  reportingSystem: 'moderation',
  computeRegistry: 'cloud',
  computeRental: 'cloud',
  ledgerManager: 'cloud',
  inferenceServing: 'cloud',
  computeStaking: 'cloud',
  storageRegistry: 'cloud',
  storageMarket: 'cloud',
  storageLedger: 'cloud',
  solverRegistry: 'defi',
  inputSettler: 'defi',
  outputSettler: 'defi',
  oifOracle: 'oracle',
  l1StakeManager: 'defi',
  crossChainPaymaster: 'paymaster',
  bazaarMarketplace: 'marketplace',
  goldToken: 'token',
  itemsNFT: 'game',
  predictionMarket: 'prediction',
  predictionOracle: 'oracle',
  playerTradeEscrow: 'marketplace',
  contest: 'game',
  weth: 'token',
  usdc: 'token',
  jeju: 'token',
  otc: 'defi',
}

let initialized = false

export async function initializeIndexer(): Promise<void> {
  if (initialized) return

  // If using DWS mode, configure database credentials first
  if (config.indexerMode === 'dws') {
    console.log('[Indexer] Using DWS database provisioning...')
    await configureDWSDatabase()
  }

  const networkConfig = loadNetworkConfig()
  console.log(
    `Initializing indexer for network: ${networkConfig.network} (chainId: ${networkConfig.chainId})`,
  )
  console.log(`RPC endpoint: ${networkConfig.rpcUrl}`)
  console.log(`Indexer mode: ${config.indexerMode}`)

  let registeredCount = 0
  for (const [name, address] of Object.entries(networkConfig.contracts)) {
    if (address && typeof address === 'string') {
      const contractType = CONTRACT_TYPES[name]
      if (!contractType) {
        console.warn(
          `Unknown contract type for '${name}' - add it to CONTRACT_TYPES mapping`,
        )
        continue
      }
      registerContract({
        address,
        name,
        type: contractType,
        events: [],
      })
      registeredCount++
    }
  }

  console.log(`Registered ${registeredCount} known contracts`)

  // Register TFMM pools from amm category
  const network = getCurrentNetwork()
  let tfmmPoolCount = 0
  try {
    const ammContracts = getContract('amm', '', network)
    if (ammContracts && typeof ammContracts === 'object') {
      for (const [name, address] of Object.entries(ammContracts)) {
        if (name.startsWith('TFMMPool_') && typeof address === 'string') {
          registerTFMMPool(address)
          tfmmPoolCount++
        }
      }
    }
  } catch {
    // AMM category may not exist on all networks
  }

  if (tfmmPoolCount > 0) {
    console.log(`Registered ${tfmmPoolCount} TFMM pools for event processing`)
  }

  const addressSet = getContractAddressSet(networkConfig)
  if (addressSet.size > 0) {
    console.log(
      `Known contract addresses: ${Array.from(addressSet).slice(0, 5).join(', ')}${addressSet.size > 5 ? '...' : ''}`,
    )
  }

  // Log which optional contracts are configured
  const c = networkConfig.contracts
  const missingOptional: string[] = []

  // Check moderation contracts (optional - may not be deployed on all networks)
  if (!c.banManager) missingOptional.push('moderation.banManager')
  if (!c.reportingSystem) missingOptional.push('moderation.reportingSystem')
  if (!c.reputationLabelManager)
    missingOptional.push('moderation.reputationLabelManager')

  if (missingOptional.length > 0) {
    console.log(
      `Optional contracts not configured for ${networkConfig.network}: ${missingOptional.join(', ')}. ` +
        `Some features may be unavailable.`,
    )
  } else {
    console.log('All contracts configured')
  }
  initialized = true
}

export function isInitialized(): boolean {
  return initialized
}

initializeIndexer()
