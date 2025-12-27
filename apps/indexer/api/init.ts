/**
 * Indexer initialization and contract registry
 */

import 'reflect-metadata'
// Preload core models in correct order to avoid circular import issues
import '../src/model/generated/block.model'
import '../src/model/generated/transaction.model'
import '../src/model/generated/account.model'
import '../src/model/generated/contract.model'
import '../src/model/generated/log.model'
import '../src/model/generated/decodedEvent.model'

import { type ContractInfo, registerContract } from './contract-events'
import { getContractAddressSet, loadNetworkConfig } from './network-config'

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

export function initializeIndexer(): void {
  if (initialized) return

  const config = loadNetworkConfig()
  console.log(
    `Initializing indexer for network: ${config.network} (chainId: ${config.chainId})`,
  )
  console.log(`RPC endpoint: ${config.rpcUrl}`)

  let registeredCount = 0
  for (const [name, address] of Object.entries(config.contracts)) {
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

  const addressSet = getContractAddressSet(config)
  if (addressSet.size > 0) {
    console.log(
      `Known contract addresses: ${Array.from(addressSet).slice(0, 5).join(', ')}${addressSet.size > 5 ? '...' : ''}`,
    )
  }

  // Validate critical contracts are configured - fail fast
  const c = config.contracts
  const missingContracts: string[] = []

  // Check moderation contracts
  if (!c.banManager) missingContracts.push('moderation.banManager')
  if (!c.reportingSystem) missingContracts.push('moderation.reportingSystem')
  if (!c.reputationLabelManager)
    missingContracts.push('moderation.reputationLabelManager')

  if (missingContracts.length > 0) {
    throw new Error(
      `Required contracts not configured for ${config.network}: ${missingContracts.join(', ')}. ` +
        `Add them to packages/config/contracts.json`,
    )
  }

  console.log('All required contracts configured')
  initialized = true
}

export function isInitialized(): boolean {
  return initialized
}

initializeIndexer()
