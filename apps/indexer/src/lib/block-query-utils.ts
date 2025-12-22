/**
 * Block query utilities
 * Shared utilities for querying blocks
 */

import type { DataSource } from 'typeorm'
import { Block } from '../model'

export interface BlocksQueryOptions {
  limit: number
  offset: number
}

export async function getBlocks(
  dataSource: DataSource,
  options: BlocksQueryOptions,
): Promise<Block[]> {
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

  return await dataSource.getRepository(Block).find({
    order: { number: 'DESC' },
    take: options.limit,
    skip: options.offset,
  })
}
