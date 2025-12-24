/**
 * Oracle operator utilities
 * Shared business logic for oracle operator operations
 */

import type { DataSource } from 'typeorm'
import { OracleOperator } from '../model'

export async function getOracleOperatorByAddress(
  dataSource: DataSource,
  address: string,
): Promise<OracleOperator | null> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    throw new Error('address is required and must be a non-empty string')
  }

  const normalizedAddress = address.toLowerCase()

  return await dataSource.getRepository(OracleOperator).findOne({
    where: { address: normalizedAddress },
  })
}
