/**
 * Statistics calculation utilities
 * Shared business logic for computing various statistics
 */

import { formatEther } from 'viem'
import {
  type Block,
  type ComputeProvider,
  ComputeRentalStatus,
  CrossServiceRequestStatus,
  count,
  find,
  OracleDisputeStatus,
  type OracleOperator,
  StorageDealStatus,
  type StorageProvider,
} from '../db'

export interface MarketplaceStats {
  compute: {
    totalProviders: number
    activeProviders: number
    agentLinkedProviders: number
    totalRentals: number
    activeRentals: number
    totalStakedETH: string
    totalEarningsETH: string
  }
  storage: {
    totalProviders: number
    activeProviders: number
    agentLinkedProviders: number
    totalDeals: number
    activeDeals: number
    totalCapacityTB: string
    usedCapacityTB: string
    totalStakedETH: string
  }
  crossService: {
    totalContainerImages: number
    verifiedContainerImages: number
    totalCrossServiceRequests: number
    successfulRequests: number
    fullStackAgents: number
  }
  erc8004: {
    totalRegisteredAgents: number
    computeAgents: number
    storageAgents: number
    fullStackAgents: number
    bannedAgents: number
  }
  lastUpdated: string
}

/**
 * Get marketplace statistics from SQLit
 */
export async function getMarketplaceStats(): Promise<MarketplaceStats> {
  // Compute stats - using SQLit queries
  const computeProviders = await find<ComputeProvider>('ComputeProvider', {})
  const activeCompute = computeProviders.filter((p) => p.isActive)
  const agentLinkedCompute = computeProviders.filter(
    (p) => p.agentId && p.agentId > 0,
  )
  const totalComputeStake = computeProviders.reduce(
    (sum, p) => sum + BigInt(p.stakeAmount ?? '0'),
    0n,
  )
  const totalComputeEarnings = computeProviders.reduce(
    (sum, p) => sum + BigInt(p.totalEarnings ?? '0'),
    0n,
  )

  // Storage stats
  const storageProviders = await find<StorageProvider>('StorageProvider', {})
  const activeStorage = storageProviders.filter((p) => p.isActive)
  const agentLinkedStorage = storageProviders.filter(
    (p) => p.agentId && p.agentId > 0,
  )
  const totalStorageStake = storageProviders.reduce(
    (sum, p) => sum + BigInt(p.stakeAmount ?? '0'),
    0n,
  )
  const totalCapacity = storageProviders.reduce(
    (sum, p) => sum + Number(p.totalCapacityGb ?? '0'),
    0,
  )
  const usedCapacity = storageProviders.reduce(
    (sum, p) => sum + Number(p.usedCapacityGb ?? '0'),
    0,
  )

  // Cross-service stats
  const [totalContainers, verifiedContainers] = await Promise.all([
    count('ContainerImage', {}),
    count('ContainerImage', { verified: true }),
  ])
  const [totalRequests, successfulRequests] = await Promise.all([
    count('CrossServiceRequest', {}),
    count('CrossServiceRequest', {
      status: CrossServiceRequestStatus.COMPLETED,
    }),
  ])

  // Rental stats
  const [totalRentals, activeRentals] = await Promise.all([
    count('ComputeRental', {}),
    count('ComputeRental', { status: ComputeRentalStatus.ACTIVE }),
  ])
  const [totalDeals, activeDeals] = await Promise.all([
    count('StorageDeal', {}),
    count('StorageDeal', { status: StorageDealStatus.ACTIVE }),
  ])

  // Agent stats
  const totalAgents = await count('RegisteredAgent', { active: true })
  const bannedAgents = await count('RegisteredAgent', { isBanned: true })

  // Full-stack agents (both compute and storage with same agent ID)
  const computeAgentIds = new Set(agentLinkedCompute.map((p) => p.agentId))
  const fullStackCount = agentLinkedStorage.filter(
    (p) => p.agentId && computeAgentIds.has(p.agentId),
  ).length

  return {
    compute: {
      totalProviders: computeProviders.length,
      activeProviders: activeCompute.length,
      agentLinkedProviders: agentLinkedCompute.length,
      totalRentals,
      activeRentals,
      totalStakedETH: formatEther(totalComputeStake),
      totalEarningsETH: formatEther(totalComputeEarnings),
    },
    storage: {
      totalProviders: storageProviders.length,
      activeProviders: activeStorage.length,
      agentLinkedProviders: agentLinkedStorage.length,
      totalDeals,
      activeDeals,
      totalCapacityTB: (totalCapacity / 1024).toFixed(2),
      usedCapacityTB: (usedCapacity / 1024).toFixed(2),
      totalStakedETH: formatEther(totalStorageStake),
    },
    crossService: {
      totalContainerImages: totalContainers,
      verifiedContainerImages: verifiedContainers,
      totalCrossServiceRequests: totalRequests,
      successfulRequests,
      fullStackAgents: fullStackCount,
    },
    erc8004: {
      totalRegisteredAgents: totalAgents,
      computeAgents: agentLinkedCompute.length,
      storageAgents: agentLinkedStorage.length,
      fullStackAgents: fullStackCount,
      bannedAgents,
    },
    lastUpdated: new Date().toISOString(),
  }
}

export interface OracleStats {
  feeds: {
    total: number
    active: number
  }
  operators: {
    total: number
    active: number
    jailed: number
    totalStakedETH: string
    totalEarningsETH: string
    avgParticipationScore: number
    avgAccuracyScore: number
  }
  reports: {
    total: number
    disputed: number
    disputeRate: string
  }
  disputes: {
    total: number
    open: number
  }
  subscriptions: {
    total: number
    active: number
  }
  lastUpdated: string
}

/**
 * Get oracle statistics from SQLit
 */
export async function getOracleStats(): Promise<OracleStats> {
  const [
    totalFeeds,
    activeFeeds,
    operators,
    totalReports,
    disputedReports,
    totalDisputes,
    openDisputes,
    totalSubscriptions,
    activeSubscriptions,
  ] = await Promise.all([
    count('OracleFeed', {}),
    count('OracleFeed', { isActive: true }),
    find<OracleOperator>('OracleOperator', {}),
    count('OracleReport', {}),
    count('OracleReport', { isDisputed: true }),
    count('OracleDispute', {}),
    count('OracleDispute', { status: OracleDisputeStatus.OPEN }),
    count('OracleSubscription', {}),
    count('OracleSubscription', { isActive: true }),
  ])

  const activeOperators = operators.filter((o) => o.isActive && !o.isJailed)
  const totalStaked = operators.reduce(
    (sum, o) => sum + BigInt(o.stakedAmount ?? '0'),
    0n,
  )
  const totalEarnings = operators.reduce(
    (sum, o) => sum + BigInt(o.totalEarnings ?? '0'),
    0n,
  )
  const avgParticipation =
    operators.length > 0
      ? Math.floor(
          operators.reduce((sum, o) => sum + o.participationScore, 0) /
            operators.length,
        )
      : 0
  const avgAccuracy =
    operators.length > 0
      ? Math.floor(
          operators.reduce((sum, o) => sum + o.accuracyScore, 0) /
            operators.length,
        )
      : 0

  return {
    feeds: {
      total: totalFeeds,
      active: activeFeeds,
    },
    operators: {
      total: operators.length,
      active: activeOperators.length,
      jailed: operators.filter((o) => o.isJailed).length,
      totalStakedETH: formatEther(totalStaked),
      totalEarningsETH: formatEther(totalEarnings),
      avgParticipationScore: avgParticipation,
      avgAccuracyScore: avgAccuracy,
    },
    reports: {
      total: totalReports,
      disputed: disputedReports,
      disputeRate:
        totalReports > 0
          ? ((disputedReports / totalReports) * 10000).toFixed(0)
          : '0',
    },
    disputes: {
      total: totalDisputes,
      open: openDisputes,
    },
    subscriptions: {
      total: totalSubscriptions,
      active: activeSubscriptions,
    },
    lastUpdated: new Date().toISOString(),
  }
}

export interface NetworkStats {
  blocks: number
  transactions: number
  accounts: number
  contracts: number
  agents: number
  nodes: number
  latestBlock: number
}

/**
 * Get network statistics from SQLit
 */
export async function getNetworkStats(): Promise<NetworkStats> {
  const [
    blockCount,
    txCount,
    accountCount,
    contractCount,
    agentCount,
    nodeCount,
  ] = await Promise.all([
    count('Block', {}),
    count('Transaction', {}),
    count('Account', {}),
    count('Contract', {}),
    count('RegisteredAgent', { active: true }),
    count('NodeStake', { isActive: true }),
  ])

  // Get latest block
  const latestBlocks = await find<Block>('Block', {
    order: { number: 'DESC' },
    take: 1,
  })
  const latestBlock = latestBlocks[0]

  return {
    blocks: blockCount,
    transactions: txCount,
    accounts: accountCount,
    contracts: contractCount,
    agents: agentCount,
    nodes: nodeCount,
    latestBlock: latestBlock?.number ?? 0,
  }
}
