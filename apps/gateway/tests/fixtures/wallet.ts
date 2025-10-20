/**
 * @fileoverview Gateway-specific wallet fixtures extending shared fixtures
 * @module gateway/tests/fixtures/wallet
 */

// Re-export shared fixtures
export { 
  testWithWallet,
  testWithConnectedWallet,
  JEJU_TEST_WALLET as TEST_WALLET,
  JEJU_NETWORK
} from '../../../../tests/shared/fixtures/wallet';

export { expect } from '@playwright/test';

