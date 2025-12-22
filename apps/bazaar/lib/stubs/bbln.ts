/**
 * BBLN Token Integration
 *
 * Re-exports from @babylon/shared/contracts for Bazaar integration.
 * This provides the canonical BBLN contract addresses, ABIs, and configuration.
 */

// Re-export from babylon shared package for contract addresses and ABIs
export {
  BBLN_ADDRESSES,
  BBLN_PRESALE_ABI,
  BBLN_TOKEN,
  BBLN_TOKEN_ABI,
  getBBLNAddresses,
  getBBLNHomeChainId,
  isBBLNDeployed,
  type BBLNContractAddresses,
} from '../../../../vendor/babylon/packages/shared/src/contracts/bbln'
