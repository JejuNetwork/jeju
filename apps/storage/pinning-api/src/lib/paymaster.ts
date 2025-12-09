/**
 * Paymaster Integration for IPFS Pinning API
 * Re-exports shared implementation
 */

// Re-export shared paymaster functionality
export {
  type PaymasterInfo,
  getAvailablePaymasters,
  getPaymasterForToken,
  generatePaymasterData,
} from '../../../../../scripts/shared/paymaster';

// Legacy service export for compatibility
import { getAvailablePaymasters, getPaymasterForToken, generatePaymasterData } from '../../../../../scripts/shared/paymaster';

export const paymasterService = {
  getAvailablePaymasters,
  getPaymasterForToken,
  generatePaymasterData,
};
