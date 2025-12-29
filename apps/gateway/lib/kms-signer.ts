/**
 * KMS Signer - Gateway Application
 *
 * SECURITY: Private keys are NEVER exposed. All signing uses:
 * - MPC/FROST threshold signing in production
 * - TEE hardware isolation when available
 *
 * Import directly from @jejunetwork/kms:
 * ```typescript
 * import { getKMSSigner, KMSSigner } from '@jejunetwork/kms'
 * ```
 */
