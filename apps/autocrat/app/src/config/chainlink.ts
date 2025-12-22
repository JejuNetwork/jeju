import { type Address, parseAbi } from 'viem'

const NETWORK = process.env.NEXT_PUBLIC_NETWORK || 'testnet'

interface ChainlinkAddresses {
  vrfCoordinator: Address
  automationRegistry: Address
  oracleRouter: Address
  chainlinkGovernance: Address
}

const ADDRESSES: Record<string, ChainlinkAddresses> = {
  testnet: {
    vrfCoordinator: (process.env.NEXT_PUBLIC_VRF_COORDINATOR ||
      '0x0') as Address,
    automationRegistry: (process.env.NEXT_PUBLIC_AUTOMATION_REGISTRY ||
      '0x0') as Address,
    oracleRouter: (process.env.NEXT_PUBLIC_ORACLE_ROUTER || '0x0') as Address,
    chainlinkGovernance: (process.env.NEXT_PUBLIC_CHAINLINK_GOVERNANCE ||
      '0x0') as Address,
  },
  mainnet: {
    vrfCoordinator: (process.env.NEXT_PUBLIC_VRF_COORDINATOR ||
      '0x0') as Address,
    automationRegistry: (process.env.NEXT_PUBLIC_AUTOMATION_REGISTRY ||
      '0x0') as Address,
    oracleRouter: (process.env.NEXT_PUBLIC_ORACLE_ROUTER || '0x0') as Address,
    chainlinkGovernance: (process.env.NEXT_PUBLIC_CHAINLINK_GOVERNANCE ||
      '0x0') as Address,
  },
}

export const CHAINLINK_CONTRACTS = ADDRESSES[NETWORK] ?? ADDRESSES.testnet

export const VRF_COORDINATOR_ABI = parseAbi([
  'function feeConfig() view returns (uint32, uint32, uint8, uint8)',
  'function minimumRequestConfirmations() view returns (uint16)',
  'function maxGasLimit() view returns (uint32)',
  'function feeRecipient() view returns (address)',
  'function setConfig(uint16, uint32, (uint32,uint32,uint8,uint8))',
  'function setFeeRecipient(address)',
])

export const AUTOMATION_REGISTRY_ABI = parseAbi([
  'function config() view returns (uint32, uint32, uint32, uint16, uint16, uint32, uint32, uint96)',
  'function getState() view returns (uint256, uint256, uint256, uint256, uint256)',
  'function getActiveKeepers() view returns (address[])',
  'function setConfig((uint32,uint32,uint32,uint16,uint16,uint32,uint32,uint96))',
  'function approveKeeper(address)',
  'function pause()',
  'function unpause()',
])

export const ORACLE_ROUTER_ABI = parseAbi([
  'function config() view returns (uint96, uint32, uint16, uint16, uint32)',
  'function getStats() view returns (uint256, uint256, uint256, uint256, uint256)',
  'function getActiveOracles() view returns (address[])',
  'function setConfig((uint96,uint32,uint16,uint16,uint32))',
  'function approveOracle(address)',
])

export const CHAINLINK_GOVERNANCE_ABI = parseAbi([
  'function config() view returns (uint256, uint256, uint256, uint256)',
  'function revenueConfig() view returns (uint16, uint16, uint16, address, address, address)',
  'function paused() view returns (bool)',
  'function emergencyPause()',
  'function emergencyUnpause()',
  'function setRevenueConfig((uint16,uint16,uint16,address,address,address))',
])

// Type-safe ABI return types matching the exact contract returns
// feeConfig() returns (uint32, uint32, uint8, uint8)
export type VRFFeeConfigTuple = readonly [number, number, number, number]

// config() for automation returns (uint32, uint32, uint32, uint16, uint16, uint32, uint32, uint96)
export type AutomationConfigTuple = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  bigint,
]

// getState() returns (uint256, uint256, uint256, uint256, uint256)
export type AutomationStateTuple = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
]

// config() for oracle returns (uint96, uint32, uint16, uint16, uint32)
export type OracleConfigTuple = readonly [
  bigint,
  number,
  number,
  number,
  number,
]

// getStats() returns (uint256, uint256, uint256, uint256, uint256)
export type OracleStatsTuple = readonly [bigint, bigint, bigint, bigint, bigint]

// config() for governance returns (uint256, uint256, uint256, uint256)
export type GovernanceConfigTuple = readonly [bigint, bigint, bigint, bigint]

// revenueConfig() returns (uint16, uint16, uint16, address, address, address)
export type RevenueConfigTuple = readonly [
  number,
  number,
  number,
  Address,
  Address,
  Address,
]

// Helper functions to extract named values from tuples
export function parseVRFFeeConfig(tuple: VRFFeeConfigTuple) {
  return {
    fulfillmentFlatFeeLinkPPM: tuple[0],
    fulfillmentFlatFeeNativePPM: tuple[1],
    premiumPercentage: tuple[2],
    nativePremiumPercentage: tuple[3],
  }
}

export function parseAutomationConfig(tuple: AutomationConfigTuple) {
  return {
    paymentPremiumPPB: tuple[0],
    flatFeeMicroLink: tuple[1],
    checkGasLimit: tuple[2],
    stalenessSeconds: tuple[3],
    gasCeilingMultiplier: tuple[4],
    minUpkeepSpend: tuple[5],
    maxPerformGas: tuple[6],
    minKeeperStake: tuple[7],
  }
}

export function parseAutomationState(tuple: AutomationStateTuple) {
  return {
    upkeepCount: tuple[0],
    totalActive: tuple[1],
    totalPerforms: tuple[2],
    totalFees: tuple[3],
    keeperCount: tuple[4],
  }
}

export function parseOracleConfig(tuple: OracleConfigTuple) {
  return {
    minPayment: tuple[0],
    requestTimeout: tuple[1],
    oracleFeeBps: tuple[2],
    protocolFeeBps: tuple[3],
    maxDataSize: tuple[4],
  }
}

export function parseOracleStats(tuple: OracleStatsTuple) {
  return {
    totalRequests: tuple[0],
    totalFulfilled: tuple[1],
    totalCollected: tuple[2],
    activeJobs: tuple[3],
    activeOracleCount: tuple[4],
  }
}

export function parseGovernanceConfig(tuple: GovernanceConfigTuple) {
  return {
    proposalDelay: tuple[0],
    gracePeriod: tuple[1],
    votingPeriod: tuple[2],
    quorum: tuple[3],
  }
}

export function parseRevenueConfig(tuple: RevenueConfigTuple) {
  return {
    treasuryBps: tuple[0],
    operationalBps: tuple[1],
    communityBps: tuple[2],
    treasuryAddress: tuple[3],
    operationalAddress: tuple[4],
    communityAddress: tuple[5],
  }
}

export interface ChainlinkStats {
  vrf: {
    totalSubscriptions: number
    totalRequests: bigint
    totalFeesCollected: bigint
  }
  automation: {
    totalUpkeeps: number
    activeUpkeeps: number
    totalPerforms: bigint
    totalFeesCollected: bigint
    activeKeepers: number
  }
  oracle: {
    totalRequests: bigint
    totalFulfilled: bigint
    totalFeesCollected: bigint
    activeJobs: number
    activeOracles: number
  }
}
