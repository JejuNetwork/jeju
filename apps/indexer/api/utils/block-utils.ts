/**
 * Block utilities
 * Shared business logic for block-related operations
 */

import { HashSchema } from '@jejunetwork/types'
import { blockNumberSchema } from './validation'

export type BlockIdentifier =
  | { type: 'number'; value: number }
  | { type: 'hash'; value: string }

/**
 * Parse and validate a block identifier (number or hash)
 * Returns null for invalid formats - caller should return 404
 */
export function parseBlockIdentifier(
  numberOrHash: string,
): BlockIdentifier | null {
  if (!numberOrHash) {
    return null
  }

  if (numberOrHash.startsWith('0x')) {
    // It's a hash - validate format
    const hashResult = HashSchema.safeParse(numberOrHash)
    if (!hashResult.success) {
      return null
    }
    return { type: 'hash', value: numberOrHash }
  } else {
    // It's a block number
    const blockNumber = parseInt(numberOrHash, 10)
    if (Number.isNaN(blockNumber) || blockNumber <= 0) {
      return null
    }
    const result = blockNumberSchema.safeParse(blockNumber)
    if (!result.success) {
      return null
    }
    return { type: 'number', value: blockNumber }
  }
}

/**
 * Build a TypeORM where clause for block lookup
 */
export function buildBlockWhereClause(identifier: BlockIdentifier): {
  hash?: string
  number?: number
} {
  if (identifier.type === 'hash') {
    return { hash: identifier.value }
  } else {
    return { number: identifier.value }
  }
}
