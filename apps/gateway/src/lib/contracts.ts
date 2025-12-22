/**
 * Gateway-specific contract ABIs and constants
 */

/** Zero address constant */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

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
