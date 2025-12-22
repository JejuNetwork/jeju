/**
 * Block utilities
 * Shared business logic for block-related operations
 */

import { hashSchema, blockNumberSchema, validateOrThrow } from './validation';

export interface BlockIdentifier {
  type: 'number' | 'hash';
  value: number | string;
}

/**
 * Parse and validate a block identifier (number or hash)
 */
export function parseBlockIdentifier(numberOrHash: string): BlockIdentifier {
  if (!numberOrHash || typeof numberOrHash !== 'string') {
    throw new Error('Block identifier is required and must be a string');
  }

  if (numberOrHash.startsWith('0x')) {
    // It's a hash
    validateOrThrow(hashSchema, numberOrHash, 'parseBlockIdentifier hash');
    return { type: 'hash', value: numberOrHash };
  } else {
    // It's a block number
    const blockNumber = parseInt(numberOrHash, 10);
    if (isNaN(blockNumber) || blockNumber <= 0) {
      throw new Error(`Invalid block number: ${numberOrHash}. Must be a positive integer.`);
    }
    validateOrThrow(blockNumberSchema, blockNumber, 'parseBlockIdentifier blockNumber');
    return { type: 'number', value: blockNumber };
  }
}

/**
 * Build a TypeORM where clause for block lookup
 */
export function buildBlockWhereClause(identifier: BlockIdentifier): { hash?: string; number?: number } {
  if (identifier.type === 'hash') {
    return { hash: identifier.value as string };
  } else {
    return { number: identifier.value as number };
  }
}
