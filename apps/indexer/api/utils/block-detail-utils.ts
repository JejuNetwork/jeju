/**
 * Block detail utilities
 * Shared business logic for block detail operations
 */

import { type Block, find } from '../db'
import { buildBlockWhereClause, parseBlockIdentifier } from './block-utils'

/**
 * Get a block by number or hash
 * Returns null for invalid formats - caller should return 404
 */
export async function getBlockByIdentifier(
  numberOrHash: string,
): Promise<Block | null> {
  if (!numberOrHash || numberOrHash.trim().length === 0) {
    return null
  }

  const identifier = parseBlockIdentifier(numberOrHash)
  if (!identifier) {
    return null
  }

  const where = buildBlockWhereClause(identifier)

  const results = await find<Block>('Block', {
    where: where as Record<string, string | number | boolean | null>,
    take: 1,
  })

  return results[0] ?? null
}
