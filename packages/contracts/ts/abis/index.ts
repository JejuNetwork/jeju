/**
 * @fileoverview Contract ABI exports
 * @module @jejunetwork/contracts/abis
 *
 * TYPED ABIs (camelCase) - Import directly from @jejunetwork/contracts (which exports from generated.ts)
 * DEPRECATED ABIs (PascalCase) - Import directly from @jejunetwork/contracts
 *
 * Always use typed ABIs (camelCase):
 * ```typescript
 * import { identityRegistryAbi } from '@jejunetwork/contracts'
 * ```
 */

// Import ABIs from generated for PascalCase aliases
import {
  banManagerAbi,
  identityRegistryAbi,
  moderationMarketplaceAbi,
  reputationRegistryAbi,
} from '../generated'

// ============================================================================
// PascalCase aliases for backward compatibility
// ============================================================================
export const BanManagerAbi = banManagerAbi
export const IdentityRegistryAbi = identityRegistryAbi
export const ModerationMarketplaceAbi = moderationMarketplaceAbi
export const ReputationRegistryAbi = reputationRegistryAbi

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
