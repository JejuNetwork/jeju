/**
 * Statistics calculation utilities
 * Shared business logic for computing various statistics
 */

import type { DataSource } from 'typeorm'
import { formatEther } from 'viem'
import {
  Block,
  ComputeProvider,
  ComputeRental,
  ContainerImage,
  Contract,
  CrossServiceRequest,
  NodeStake,
  OracleDispute,
  OracleFeed,
  OracleOperator,
  OracleReport,
  OracleSubscription,
  RegisteredAgent,
  StorageDeal,
  StorageProvider,
  Transaction,
  Account,
} from '../model'

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

export async function getMarketplaceStats(
  dataSource: DataSource,
): Promise<MarketplaceStats> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }

  // Compute stats
  const computeRepo = dataSource.getRepository(ComputeProvider)
  const computeProviders = await computeRepo.find()
  const activeCompute = computeProviders.filter((p) => p.isActive)
  const agentLinkedCompute = computeProviders.filter(
    (p) => p.agentId && p.agentId > 0,
  )
  const totalComputeStake = computeProviders.reduce(
    (sum, p) => sum + (p.stakeAmount || 0n),
    0n,
  )
  const totalComputeEarnings = computeProviders.reduce(
    (sum, p) => sum + (p.totalEarnings || 0n),
    0n,
  )

  // Storage stats
  const storageRepo = dataSource.getRepository(StorageProvider)
  const storageProviders = await storageRepo.find()
  const activeStorage = storageProviders.filter((p) => p.isActive)
  const agentLinkedStorage = storageProviders.filter(
    (p) => p.agentId && p.agentId > 0,
  )
  const totalStorageStake = storageProviders.reduce(
    (sum, p) => sum + (p.stakeAmount || 0n),
    0n,
  )
  const totalCapacity = storageProviders.reduce(
    (sum, p) => sum + Number(p.totalCapacityGB || 0n),
    0,
  )
  const usedCapacity = storageProviders.reduce(
    (sum, p) => sum + Number(p.usedCapacityGB || 0n),
    0,
  )

  // Cross-service stats
  const containerRepo = dataSource.getRepository(ContainerImage)
  const requestRepo = dataSource.getRepository(CrossServiceRequest)
  const [totalContainers, verifiedContainers] = await Promise.all([
    containerRepo.count(),
    containerRepo.count({ where: { verified: true } }),
  ])
  const [totalRequests, successfulRequests] = await Promise.all([
    requestRepo.count(),
    requestRepo.count({ where: { status: 'COMPLETED' as never } }),
  ])

  // Rental stats
  const rentalRepo = dataSource.getRepository(ComputeRental)
  const dealRepo = dataSource.getRepository(StorageDeal)
  const [totalRentals, activeRentals] = await Promise.all([
    rentalRepo.count(),
    rentalRepo.count({ where: { status: 'ACTIVE' as never } }),
  ])
  const [totalDeals, activeDeals] = await Promise.all([
    dealRepo.count(),
    dealRepo.count({ where: { status: 'ACTIVE' as never } }),
  ])

  // Agent stats
  const agentRepo = dataSource.getRepository(RegisteredAgent)
  const totalAgents = await agentRepo.count({ where: { active: true } })
  const bannedAgents = await agentRepo.count({ where: { isBanned: true } })

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

export async function getOracleStats(
  dataSource: DataSource,
): Promise<OracleStats> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }

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
    dataSource.getRepository(OracleFeed).count(),
    dataSource.getRepository(OracleFeed).count({ where: { isActive: true } }),
    dataSource.getRepository(OracleOperator).find(),
    dataSource.getRepository(OracleReport).count(),
    dataSource
      .getRepository(OracleReport)
      .count({ where: { isDisputed: true } }),
    dataSource.getRepository(OracleDispute).count(),
    dataSource
      .getRepository(OracleDispute)
      .count({ where: { status: 'OPEN' as never } }),
    dataSource.getRepository(OracleSubscription).count(),
    dataSource
      .getRepository(OracleSubscription)
      .count({ where: { isActive: true } }),
  ])

  const activeOperators = operators.filter((o) => o.isActive && !o.isJailed)
  const totalStaked = operators.reduce((sum, o) => sum + o.stakedAmount, 0n)
  const totalEarnings = operators.reduce((sum, o) => sum + o.totalEarnings, 0n)
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

export async function getNetworkStats(
  dataSource: DataSource,
): Promise<NetworkStats> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }

  const [
    blockCount,
    txCount,
    accountCount,
    contractCount,
    agentCount,
    nodeCount,
  ] = await Promise.all([
    dataSource.getRepository(Block).count(),
    dataSource.getRepository(Transaction).count(),
    dataSource.getRepository(Account).count(),
    dataSource.getRepository(Contract).count(),
    dataSource
      .getRepository(RegisteredAgent)
      .count({ where: { active: true } }),
    dataSource.getRepository(NodeStake).count({ where: { isActive: true } }),
  ])

  const latestBlock = await dataSource
    .getRepository(Block)
    .createQueryBuilder('b')
    .orderBy('b.number', 'DESC')
    .limit(1)
    .getOne()

  return {
    blocks: blockCount,
    transactions: txCount,
    accounts: accountCount,
    contracts: contractCount,
    agents: agentCount,
    nodes: nodeCount,
    latestBlock: latestBlock?.number || 0,
  }
}
