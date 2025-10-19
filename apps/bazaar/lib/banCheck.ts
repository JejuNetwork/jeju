/**
 * Ban Check Utility for Bazaar
 * Checks if user is banned before allowing trades
 */

import { Address } from 'viem';

const BAN_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS as Address;
const BAZAAR_APP_ID = '0x' + Buffer.from('bazaar').toString('hex').padStart(64, '0');

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
  networkBanned?: boolean;
  appBanned?: boolean;
  labels?: string[];
}

export async function checkUserBan(userAddress: Address): Promise<BanCheckResult> {
  if (!BAN_MANAGER_ADDRESS) {
    // Ban manager not deployed, allow access
    return { allowed: true };
  }
  
  // TODO: Query BanManager contract
  // For now, allow all
  return { allowed: true };
}

export async function checkTradeAllowed(userAddress: Address): Promise<boolean> {
  const result = await checkUserBan(userAddress);
  return result.allowed;
}

