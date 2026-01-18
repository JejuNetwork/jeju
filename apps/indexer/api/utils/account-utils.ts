/**
 * Account utilities
 * Shared business logic for account-related operations
 */

import { type Account, find } from '../db'

/**
 * Get account by address from SQLit
 * Returns null for invalid formats - caller should return 404
 */
export async function getAccountByAddress(
  address: string,
): Promise<Account | null> {
  if (!address || address.trim().length === 0) {
    return null
  }

  // Validate address format (should be 0x followed by 40 hex chars)
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return null
  }

  const normalizedAddress = address.toLowerCase()

  const results = await find<Account>('Account', {
    where: { address: normalizedAddress },
    take: 1,
  })

  return results[0] ?? null
}
