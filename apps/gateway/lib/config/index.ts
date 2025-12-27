/**
 * Gateway Frontend Configuration
 *
 * Uses @jejunetwork/config for all configuration.
 */

import {
  getChainId,
  getContractsConfig,
  getCurrentNetwork,
  getRpcUrl,
  getServicesConfig,
  getWsUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { type Address, getAddress } from 'viem'

// Network from config
export const NETWORK: NetworkType = getCurrentNetwork()

// Chain configuration from config
export const CHAIN_ID = getChainId(NETWORK)
export const RPC_URL = getRpcUrl(NETWORK)
export const WS_URL = getWsUrl(NETWORK)

// Service URLs from config
const services = getServicesConfig(NETWORK)

function requireServiceUrl(url: string | undefined, name: string): string {
  if (!url) throw new Error(`${name} URL not configured for network ${NETWORK}`)
  return url
}

export const OAUTH3_AGENT_URL = requireServiceUrl(
  services.oauth3?.api,
  'OAuth3',
)
export const INDEXER_URL = requireServiceUrl(
  services.indexer.graphql,
  'Indexer GraphQL',
)
export const INDEXER_REST_URL = requireServiceUrl(
  services.indexer.rest,
  'Indexer REST',
)
export const INDEXER_A2A_URL = requireServiceUrl(
  services.gateway.a2a,
  'Indexer A2A',
)
export const INDEXER_MCP_URL = requireServiceUrl(
  services.gateway.mcp,
  'Indexer MCP',
)
export const RPC_GATEWAY_URL = requireServiceUrl(
  services.rpcGateway,
  'RPC Gateway',
)
export const IPFS_API_URL = requireServiceUrl(services.storage.api, 'IPFS API')
export const IPFS_GATEWAY_URL = requireServiceUrl(
  services.storage.ipfsGateway,
  'IPFS Gateway',
)
export const OIF_AGGREGATOR_URL = requireServiceUrl(
  services.oif.aggregator,
  'OIF Aggregator',
)
export const LEADERBOARD_API_URL = requireServiceUrl(
  services.leaderboard.api,
  'Leaderboard',
)
export const EXPLORER_URL = requireServiceUrl(services.explorer, 'Explorer')

// Contract addresses from config
const contracts = getContractsConfig(NETWORK)

/** Helper to get address - throws if not configured */
function addr(value: string | undefined, name: string): Address {
  if (!value) throw new Error(`Contract address not configured: ${name}`)
  return getAddress(value)
}

export const CONTRACTS = {
  // Tokens
  jeju: addr(contracts.tokens.jeju, 'tokens.jeju'),
  usdc: addr(contracts.tokens.usdc, 'tokens.usdc'),
  weth: getAddress('0x4200000000000000000000000000000000000006'),

  // Registry
  identityRegistry: addr(contracts.registry.identity, 'registry.identity'),
  tokenRegistry: addr(contracts.registry.token, 'registry.token'),
  reputationRegistry: addr(
    contracts.registry.reputation,
    'registry.reputation',
  ),
  validationRegistry: addr(
    contracts.registry.validation,
    'registry.validation',
  ),

  // Moderation
  banManager: addr(contracts.moderation.banManager, 'moderation.banManager'),
  reportingSystem: addr(
    contracts.moderation.reportingSystem,
    'moderation.reportingSystem',
  ),
  reputationLabelManager: addr(
    contracts.moderation.reputationLabelManager,
    'moderation.reputationLabelManager',
  ),
  registryGovernance: addr(
    contracts.governance.registryGovernance,
    'governance.registryGovernance',
  ),

  // Bazaar (Prediction Markets)
  predictionMarket: addr(
    contracts.bazaar?.predictionMarket,
    'bazaar.predictionMarket',
  ),

  // Node Staking
  nodeStakingManager: addr(
    contracts.nodeStaking.manager,
    'nodeStaking.manager',
  ),
  nodePerformanceOracle: addr(
    contracts.nodeStaking.performanceOracle,
    'nodeStaking.performanceOracle',
  ),
  rpcStaking: addr(contracts.rpc?.staking, 'rpc.staking'),

  // JNS
  jnsRegistry: addr(contracts.jns.registry, 'jns.registry'),
  jnsResolver: addr(contracts.jns.resolver, 'jns.resolver'),
  jnsRegistrar: addr(contracts.jns.registrar, 'jns.registrar'),
  jnsReverseRegistrar: addr(
    contracts.jns.reverseRegistrar,
    'jns.reverseRegistrar',
  ),

  // Payments
  paymasterFactory: addr(
    contracts.payments.paymasterFactory,
    'payments.paymasterFactory',
  ),
  priceOracle: addr(contracts.payments.priceOracle, 'payments.priceOracle'),
  entryPoint: getAddress('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'),
  x402Facilitator: addr(
    contracts.payments.x402Facilitator,
    'payments.x402Facilitator',
  ),

  // Compute
  computeRegistry: addr(contracts.compute.registry, 'compute.registry'),
  ledgerManager: addr(contracts.compute.ledgerManager, 'compute.ledgerManager'),
  inferenceServing: addr(
    contracts.compute.inferenceServing,
    'compute.inferenceServing',
  ),
  computeStaking: addr(contracts.compute.staking, 'compute.staking'),

  // OIF
  solverRegistry: addr(contracts.oif.solverRegistry, 'oif.solverRegistry'),
  inputSettler: {
    jeju: addr(contracts.oif.inputSettler, 'oif.inputSettler'),
    ethereum: ZERO_ADDRESS,
    sepolia: ZERO_ADDRESS,
    arbitrum: ZERO_ADDRESS,
    optimism: ZERO_ADDRESS,
  },

  // EIL
  crossChainPaymaster: addr(
    contracts.eil.crossChainPaymaster,
    'eil.crossChainPaymaster',
  ),

  // GitHub Reputation
  githubReputationProvider: addr(
    contracts.registry.githubReputationProvider,
    'registry.githubReputationProvider',
  ),

  // Oracle Network
  oracleNetworkConnector: addr(
    contracts.oracle?.oracleNetworkConnector,
    'oracle.oracleNetworkConnector',
  ),
} as const
