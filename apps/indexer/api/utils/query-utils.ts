/**
 * Query building utilities
 * Shared utilities for building TypeORM queries
 */

import type { DataSource, SelectQueryBuilder } from 'typeorm'
import {
  ContainerImage,
  Contract,
  CrossServiceRequest,
  OracleDispute,
  OracleFeed,
  OracleOperator,
  OracleReport,
  TokenTransfer,
} from '../model'

export interface ContractsQueryOptions {
  type?: string
  limit: number
}

export function buildContractsQuery(
  dataSource: DataSource,
  options: ContractsQueryOptions,
): SelectQueryBuilder<Contract> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }

  let query = dataSource
    .getRepository(Contract)
    .createQueryBuilder('c')
    .leftJoinAndSelect('c.creator', 'creator')

  if (options.type) {
    query = query.where('c.contractType = :type', { type: options.type })
  }

  return query.orderBy('c.firstSeenAt', 'DESC').take(options.limit)
}

export interface TokenTransfersQueryOptions {
  token?: string
  limit: number
}

export function buildTokenTransfersQuery(
  dataSource: DataSource,
  options: TokenTransfersQueryOptions,
): SelectQueryBuilder<TokenTransfer> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }

  let query = dataSource
    .getRepository(TokenTransfer)
    .createQueryBuilder('t')
    .leftJoinAndSelect('t.from', 'from')
    .leftJoinAndSelect('t.to', 'to')
    .leftJoinAndSelect('t.token', 'token')

  if (options.token) {
    query = query.where('token.address = :token', {
      token: options.token.toLowerCase(),
    })
  }

  return query.orderBy('t.timestamp', 'DESC').take(options.limit)
}

export interface OracleFeedsQueryOptions {
  active?: boolean
  category?: string
  limit: number
  offset: number
}

export function buildOracleFeedsQuery(
  dataSource: DataSource,
  options: OracleFeedsQueryOptions,
): SelectQueryBuilder<OracleFeed> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }
  if (typeof options.offset !== 'number' || options.offset < 0) {
    throw new Error(
      `Invalid offset: ${options.offset}. Must be a non-negative number.`,
    )
  }

  let query = dataSource.getRepository(OracleFeed).createQueryBuilder('f')

  if (options.active !== undefined) {
    query = query.where('f.isActive = :active', { active: options.active })
  }
  if (options.category) {
    query = query.andWhere('f.category = :category', {
      category: options.category,
    })
  }

  return query
    .orderBy('f.totalReports', 'DESC')
    .take(options.limit)
    .skip(options.offset)
}

export interface OracleOperatorsQueryOptions {
  active?: boolean
  jailed?: boolean
  limit: number
  offset: number
}

export function buildOracleOperatorsQuery(
  dataSource: DataSource,
  options: OracleOperatorsQueryOptions,
): SelectQueryBuilder<OracleOperator> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }
  if (typeof options.offset !== 'number' || options.offset < 0) {
    throw new Error(
      `Invalid offset: ${options.offset}. Must be a non-negative number.`,
    )
  }

  let query = dataSource.getRepository(OracleOperator).createQueryBuilder('o')

  if (options.active !== undefined) {
    query = query.where('o.isActive = :active', { active: options.active })
  }
  if (options.jailed !== undefined) {
    query = query.andWhere('o.isJailed = :jailed', { jailed: options.jailed })
  }

  return query
    .orderBy('o.stakedAmount', 'DESC')
    .take(options.limit)
    .skip(options.offset)
}

export interface OracleReportsQueryOptions {
  feedId?: string
  disputed?: boolean
  limit: number
  offset: number
}

export function buildOracleReportsQuery(
  dataSource: DataSource,
  options: OracleReportsQueryOptions,
): SelectQueryBuilder<OracleReport> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }
  if (typeof options.offset !== 'number' || options.offset < 0) {
    throw new Error(
      `Invalid offset: ${options.offset}. Must be a non-negative number.`,
    )
  }

  let query = dataSource
    .getRepository(OracleReport)
    .createQueryBuilder('r')
    .leftJoinAndSelect('r.feed', 'feed')
    .leftJoinAndSelect('r.submittedBy', 'submitter')

  if (options.feedId) {
    query = query.where('feed.feedId = :feedId', { feedId: options.feedId })
  }
  if (options.disputed !== undefined) {
    query = query.andWhere('r.isDisputed = :disputed', {
      disputed: options.disputed,
    })
  }

  return query
    .orderBy('r.submittedAt', 'DESC')
    .take(options.limit)
    .skip(options.offset)
}

export interface OracleDisputesQueryOptions {
  status?: string
  limit: number
  offset: number
}

export function buildOracleDisputesQuery(
  dataSource: DataSource,
  options: OracleDisputesQueryOptions,
): SelectQueryBuilder<OracleDispute> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }
  if (typeof options.offset !== 'number' || options.offset < 0) {
    throw new Error(
      `Invalid offset: ${options.offset}. Must be a non-negative number.`,
    )
  }

  let query = dataSource
    .getRepository(OracleDispute)
    .createQueryBuilder('d')
    .leftJoinAndSelect('d.report', 'report')
    .leftJoinAndSelect('d.feed', 'feed')
    .leftJoinAndSelect('d.disputer', 'disputer')
    .leftJoinAndSelect('d.challenger', 'challenger')

  if (options.status) {
    query = query.where('d.status = :status', { status: options.status })
  }

  return query
    .orderBy('d.openedAt', 'DESC')
    .take(options.limit)
    .skip(options.offset)
}

export interface ContainersQueryOptions {
  verified?: boolean
  gpu?: boolean
  tee?: boolean
  limit: number
  offset: number
}

export function buildContainersQuery(
  dataSource: DataSource,
  options: ContainersQueryOptions,
): SelectQueryBuilder<ContainerImage> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }
  if (typeof options.offset !== 'number' || options.offset < 0) {
    throw new Error(
      `Invalid offset: ${options.offset}. Must be a non-negative number.`,
    )
  }

  let query = dataSource
    .getRepository(ContainerImage)
    .createQueryBuilder('c')
    .leftJoinAndSelect('c.storageProvider', 'sp')
    .leftJoinAndSelect('c.uploadedBy', 'uploader')

  if (options.verified !== undefined) {
    query = query.andWhere('c.verified = :verified', {
      verified: options.verified,
    })
  }
  if (options.gpu !== undefined) {
    query = query.andWhere('c.gpuRequired = :gpu', { gpu: options.gpu })
  }
  if (options.tee !== undefined) {
    query = query.andWhere('c.teeRequired = :tee', { tee: options.tee })
  }

  return query
    .orderBy('c.pullCount', 'DESC')
    .take(options.limit)
    .skip(options.offset)
}

export interface CrossServiceRequestsQueryOptions {
  status?: string
  type?: string
  limit: number
  offset: number
}

export function buildCrossServiceRequestsQuery(
  dataSource: DataSource,
  options: CrossServiceRequestsQueryOptions,
): SelectQueryBuilder<CrossServiceRequest> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }
  if (typeof options.offset !== 'number' || options.offset < 0) {
    throw new Error(
      `Invalid offset: ${options.offset}. Must be a non-negative number.`,
    )
  }

  let query = dataSource
    .getRepository(CrossServiceRequest)
    .createQueryBuilder('r')
    .leftJoinAndSelect('r.requester', 'requester')
    .leftJoinAndSelect('r.containerImage', 'container')
    .leftJoinAndSelect('r.sourceProvider', 'storage')
    .leftJoinAndSelect('r.destinationProvider', 'compute')

  if (options.status) {
    query = query.andWhere('r.status = :status', { status: options.status })
  }
  if (options.type) {
    query = query.andWhere('r.requestType = :type', { type: options.type })
  }

  return query
    .orderBy('r.createdAt', 'DESC')
    .take(options.limit)
    .skip(options.offset)
}
