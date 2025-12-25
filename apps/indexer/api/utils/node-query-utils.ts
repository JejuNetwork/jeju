/**
 * Node query utilities
 * Shared utilities for querying nodes
 */

import type { DataSource } from 'typeorm'
import { NodeStake } from '../model'

export interface NodesQueryOptions {
  active?: boolean
  limit: number
}

export async function getNodes(
  dataSource: DataSource,
  options: NodesQueryOptions,
): Promise<NodeStake[]> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(
      `Invalid limit: ${options.limit}. Must be a positive number.`,
    )
  }

  const where: { isActive?: boolean } = {}
  if (options.active !== undefined) {
    where.isActive = options.active
  }

  return await dataSource.getRepository(NodeStake).find({
    where,
    order: { stakedValueUSD: 'DESC' },
    take: options.limit,
  })
}
