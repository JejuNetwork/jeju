/**
 * Indexer initialization and contract registry
 */

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

  initialized = true
}

export function isInitialized(): boolean {
  return initialized
}

initializeIndexer()
