/**
 * Contract ABIs and constants
 * Re-exports from @jejunetwork/ui for backwards compatibility
 */

// Re-export from shared UI package
export {
  IERC20_ABI,
  LIQUIDITY_VAULT_ABI,
  PAYMASTER_FACTORY_ABI,
  TOKEN_REGISTRY_ABI,
  ZERO_ADDRESS,
  ZERO_BYTES32,
} from '@jejunetwork/ui'

// Gateway-specific ABIs (not in shared package)
export const JEJU_TOKEN_ABI = [
  {
    type: 'function',
    name: 'isBanned',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'banEnforcementEnabled',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'faucet',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'faucetCooldownRemaining',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'faucetEnabled',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const
