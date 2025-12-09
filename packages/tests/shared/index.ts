/**
 * @jejunetwork/tests - Shared test utilities for Jeju Network
 * 
 * @example
 * ```typescript
 * import { testWithWallet, JEJU_TEST_WALLET } from '@jejunetwork/tests';
 * import { connectWallet, approveToken } from '@jejunetwork/tests/helpers';
 * import { captureScreenshot } from '@jejunetwork/tests/helpers/screenshots';
 * ```
 */

// Fixtures
export * from './fixtures/wallet';

// Helpers
export * from './helpers/contracts';
export * from './helpers/screenshots';
export * from './helpers/navigation';
export * from './helpers/error-detection';

// Constants
export * from './constants';

