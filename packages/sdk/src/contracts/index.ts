/**
 * Contract ABIs and utilities
 *
 * Provides canonical ABIs for all Jeju Network contracts.
 * Projects building on Jeju should import ABIs from here
 * rather than maintaining separate contract packages.
 */

// Import ABIs from JSON files
import BanManagerJSON from './abis/BanManager.json'
import ERC20JSON from './abis/ERC20.json'
import IdentityRegistryJSON from './abis/IdentityRegistry.json'
import InputSettlerJSON from './abis/InputSettler.json'
import JNSRegistryJSON from './abis/JNSRegistry.json'
import JNSResolverJSON from './abis/JNSResolver.json'
import LiquidityVaultJSON from './abis/LiquidityVault.json'
import ModerationMarketplaceJSON from './abis/ModerationMarketplace.json'
import OutputSettlerJSON from './abis/OutputSettler.json'
import PaymasterFactoryJSON from './abis/PaymasterFactory.json'
import ReputationRegistryJSON from './abis/ReputationRegistry.json'
import SolverRegistryJSON from './abis/SolverRegistry.json'
import TokenRegistryJSON from './abis/TokenRegistry.json'

/** ABI JSON structure - can be either direct array or object with abi property */
interface AbiJson {
  abi?: readonly Record<string, unknown>[]
}

/** Extract ABI arrays from JSON (some have .abi property, some are direct arrays) */
function getAbi(
  json: AbiJson | readonly Record<string, unknown>[],
): readonly Record<string, unknown>[] {
  if (Array.isArray(json)) return json
  if (json && 'abi' in json && Array.isArray(json.abi)) return json.abi
  return []
}

export const ABIS = {
  BanManager: getAbi(BanManagerJSON),
  IdentityRegistry: getAbi(IdentityRegistryJSON),
  TokenRegistry: getAbi(TokenRegistryJSON),
  JNSRegistry: getAbi(JNSRegistryJSON),
  JNSResolver: getAbi(JNSResolverJSON),
  PaymasterFactory: getAbi(PaymasterFactoryJSON),
  LiquidityVault: getAbi(LiquidityVaultJSON),
  SolverRegistry: getAbi(SolverRegistryJSON),
  InputSettler: getAbi(InputSettlerJSON),
  OutputSettler: getAbi(OutputSettlerJSON),
  ERC20: getAbi(ERC20JSON),
  ModerationMarketplace: getAbi(ModerationMarketplaceJSON),
  ReputationRegistry: getAbi(ReputationRegistryJSON),
} as const

export type ContractName = keyof typeof ABIS

// ═══════════════════════════════════════════════════════════════════════════
//                     PREDICTION MARKET ABIs
// ═══════════════════════════════════════════════════════════════════════════

/** LMSR-based prediction market ABI - used for binary outcome markets */
export const PREDICTION_MARKET_ABI = [
  {
    name: 'createMarket',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'gameType', type: 'uint8' },
      { name: 'question', type: 'string' },
      { name: 'oracle', type: 'address' },
      { name: 'liquidityParameter', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'markets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      { name: 'sessionId', type: 'bytes32' },
      { name: 'gameType', type: 'uint8' },
      { name: 'question', type: 'string' },
      { name: 'oracle', type: 'address' },
      { name: 'liquidityParameter', type: 'uint256' },
      { name: 'yesShares', type: 'uint256' },
      { name: 'noShares', type: 'uint256' },
      { name: 'totalVolume', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'resolvedAt', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'outcome', type: 'bool' },
      { name: 'creator', type: 'address' },
    ],
  },
  {
    name: 'buyShares',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
      { name: 'maxCost', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'sellShares',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
      { name: 'minReturn', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getBuyPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getSellPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getSpotPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'isYes', type: 'bool' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'positions',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'holder', type: 'address' },
    ],
    outputs: [
      { name: 'yesShares', type: 'uint256' },
      { name: 'noShares', type: 'uint256' },
      { name: 'totalInvested', type: 'uint256' },
      { name: 'totalClaimed', type: 'uint256' },
    ],
  },
  {
    name: 'claimWinnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getClaimableAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'holder', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'resolveMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'cancelMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getActiveMarkets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'getMarketIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'getMarketPrices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      { name: 'yesPrice', type: 'uint256' },
      { name: 'noPrice', type: 'uint256' },
    ],
  },
  {
    name: 'getMarketShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [
      { name: 'yesShares', type: 'uint256' },
      { name: 'noShares', type: 'uint256' },
    ],
  },
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'totalVolume',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** Oracle facet ABI - for prediction market resolution */
export const ORACLE_FACET_ABI = [
  {
    name: 'getOracleAddresses',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'chainlink', type: 'address' },
      { name: 'uma', type: 'address' },
    ],
  },
  {
    name: 'getPendingRequest',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'manualResolve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'outcome', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'oracleCallback',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'requestId', type: 'bytes32' },
      { name: 'outcome', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'requestChainlinkResolution',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'jobId', type: 'bytes32' },
      { name: 'fee', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
  },
  {
    name: 'setChainlinkOracle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'oracle', type: 'address' }],
    outputs: [],
  },
  {
    name: 'setUMAOracle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'oracle', type: 'address' }],
    outputs: [],
  },
] as const

/** Diamond loupe facet ABI - for querying diamond facets */
export const DIAMOND_LOUPE_ABI = [
  {
    name: 'facets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'facetAddress', type: 'address' },
          { name: 'functionSelectors', type: 'bytes4[]' },
        ],
      },
    ],
  },
  {
    name: 'facetFunctionSelectors',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_facet', type: 'address' }],
    outputs: [{ type: 'bytes4[]' }],
  },
  {
    name: 'facetAddresses',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'facetAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_functionSelector', type: 'bytes4' }],
    outputs: [{ type: 'address' }],
  },
] as const

// Convenience aliases for common naming patterns
export const predictionMarketAbi = PREDICTION_MARKET_ABI
export const oracleAbi = ORACLE_FACET_ABI
export const diamondLoupeAbi = DIAMOND_LOUPE_ABI
export const banManagerAbi = ABIS.BanManager
export const identityRegistryAbi = ABIS.IdentityRegistry
export const reputationRegistryAbi = ABIS.ReputationRegistry
export const moderationMarketplaceAbi = ABIS.ModerationMarketplace

// Compute contract ABIs (inline for simplicity)
export const COMPUTE_REGISTRY_ABI = [
  {
    name: 'getAllProviders',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getProvider',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'endpoint', type: 'string' },
          { name: 'stake', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'isActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

export const COMPUTE_RENTAL_ABI = [
  {
    name: 'getProviderResources',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          {
            name: 'resources',
            type: 'tuple',
            components: [
              { name: 'cpuCores', type: 'uint256' },
              { name: 'memoryGb', type: 'uint256' },
              { name: 'storageGb', type: 'uint256' },
              { name: 'bandwidthMbps', type: 'uint256' },
              { name: 'gpuType', type: 'uint8' },
              { name: 'gpuCount', type: 'uint256' },
              { name: 'gpuMemoryGb', type: 'uint256' },
              { name: 'teeSupported', type: 'bool' },
            ],
          },
          {
            name: 'pricing',
            type: 'tuple',
            components: [
              { name: 'pricePerHour', type: 'uint256' },
              { name: 'minimumRentalHours', type: 'uint256' },
              { name: 'maximumRentalHours', type: 'uint256' },
              { name: 'depositRequired', type: 'uint256' },
            ],
          },
          { name: 'activeRentals', type: 'uint256' },
          { name: 'maxConcurrentRentals', type: 'uint256' },
          { name: 'available', type: 'bool' },
          { name: 'sshEnabled', type: 'bool' },
          { name: 'dockerEnabled', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'calculateRentalCost',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'durationHours', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'createRental',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'durationHours', type: 'uint256' },
      { name: 'sshPublicKey', type: 'string' },
      { name: 'containerImage', type: 'string' },
      { name: 'startupScript', type: 'string' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getRental',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'rentalId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'rentalId', type: 'bytes32' },
          { name: 'user', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'status', type: 'uint8' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'totalCost', type: 'uint256' },
          { name: 'paidAmount', type: 'uint256' },
          { name: 'refundedAmount', type: 'uint256' },
          { name: 'sshPublicKey', type: 'string' },
          { name: 'containerImage', type: 'string' },
          { name: 'startupScript', type: 'string' },
          { name: 'sshHost', type: 'string' },
          { name: 'sshPort', type: 'uint16' },
        ],
      },
    ],
  },
  {
    name: 'getUserRentals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'cancelRental',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'rentalId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'extendRental',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'rentalId', type: 'bytes32' },
      { name: 'additionalHours', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export const INFERENCE_ABI = [
  {
    name: 'getServices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'provider', type: 'address' },
          { name: 'model', type: 'string' },
          { name: 'endpoint', type: 'string' },
          { name: 'pricePerInputToken', type: 'uint256' },
          { name: 'pricePerOutputToken', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
] as const

export const TRIGGER_REGISTRY_ABI = [
  {
    name: 'getTrigger',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'triggerId', type: 'bytes32' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'triggerType', type: 'uint8' },
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'active', type: 'bool' },
      { name: 'executionCount', type: 'uint256' },
      { name: 'lastExecutedAt', type: 'uint256' },
      { name: 'agentId', type: 'uint256' },
    ],
  },
  {
    name: 'registerTrigger',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'triggerType', type: 'uint8' },
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'cronExpression', type: 'string' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getOwnerTriggers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'prepaidBalances',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const
