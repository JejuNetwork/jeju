/**
 * Account utilities
 * Shared business logic for account-related operations
 */

import type { DataSource } from 'typeorm'
import { Account } from '../model'

export async function getAccountByAddress(
  dataSource: DataSource,
  address: string,
): Promise<Account | null> {
  if (!dataSource) {
    throw new Error('DataSource is required')
  }
  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    throw new Error('address is required and must be a non-empty string')
  }

  const normalizedAddress = address.toLowerCase()

  return await dataSource.getRepository(Account).findOne({
    where: { address: normalizedAddress },
  })
}
