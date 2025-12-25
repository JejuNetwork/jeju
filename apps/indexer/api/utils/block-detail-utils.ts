/**
 * Block detail utilities
 * Shared business logic for block detail operations
 */

import type { DataSource } from 'typeorm'
import { Block } from '../model'
import { buildBlockWhereClause, parseBlockIdentifier } from './block-utils'

export async function getBlockByIdentifier(
  dataSource: DataSource,
  numberOrHash: string,
): Promise<Block | null> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (!numberOrHash || numberOrHash.trim().length === 0) {
    throw new Error('numberOrHash is required and must be a non-empty string')
  }

  const identifier = parseBlockIdentifier(numberOrHash)
  const where = buildBlockWhereClause(identifier)

  return await dataSource.getRepository(Block).findOne({ where })
}
