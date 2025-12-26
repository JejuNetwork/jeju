/**
 * @fileoverview Contract ABI exports
 * @module @jejunetwork/contracts/abis
 *
 * TYPED ABIs (camelCase) - Re-exported from generated.ts with full viem type inference
 * DEPRECATED ABIs (PascalCase) - Cast to Abi, no type inference (kept for backward compatibility)
 *
 * Always use typed ABIs (camelCase):
 * ```typescript
 * import { identityRegistryAbi } from '@jejunetwork/contracts'
 * ```
 */

// ============================================================================
// TYPED ABIs - Export from generated (full type inference)
// ============================================================================
export {
  automationRegistryAbi,
  banManagerAbi,
  // PascalCase aliases for backward compatibility
  banManagerAbi as BanManagerAbi,
  bondingCurveAbi,
  chainlinkGovernanceAbi,
  creditManagerAbi,
  federatedIdentityAbi,
  federatedLiquidityAbi,
  federatedSolverAbi,
  hyperlaneOracleAbi,
  icoPresaleAbi,
  identityRegistryAbi,
  identityRegistryAbi as IdentityRegistryAbi,
  inputSettlerAbi,
  launchpadTokenAbi,
  liquidityPaymasterAbi,
  liquidityVaultAbi,
  lpLockerAbi,
  mockErc20Abi,
  moderationMarketplaceAbi,
  moderationMarketplaceAbi as ModerationMarketplaceAbi,
  multiTokenPaymasterAbi,
  networkRegistryAbi,
  oracleRegistryAbi,
  oracleRouterAbi,
  otcAbi,
  outputSettlerAbi,
  paymasterFactoryAbi,
  registrationHelperAbi,
  reputationRegistryAbi,
  reputationRegistryAbi as ReputationRegistryAbi,
  simplePoolOracleAbi,
  solverRegistryAbi,
  tokenLaunchpadAbi,
  tokenRegistryAbi,
  userBlockRegistryAbi,
  validationRegistryAbi,
  vrfCoordinatorV2_5Abi,
} from '../generated'

// ============================================================================
// TYPED ABI FRAGMENTS - Common patterns with full type inference
// ============================================================================

/** Standard ERC20 read functions with full type inference */
export const ERC20ReadAbi = [
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** Standard ERC20 write functions with full type inference */
export const ERC20WriteAbi = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferFrom',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const
