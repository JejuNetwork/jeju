/**
 * Shared Contract ABIs for UI hooks
 */

import type { Address, Hex } from 'viem'

// Canonical zero constants
export const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000' as Address
export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

export const TOKEN_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerToken',
    inputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'oracleAddress', type: 'address' },
      { name: 'minFeeMargin', type: 'uint256' },
      { name: 'maxFeeMargin', type: 'uint256' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getAllTokens',
    inputs: [],
    outputs: [{ name: 'addresses', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTokenConfig',
    inputs: [{ name: 'tokenAddress', type: 'address' }],
    outputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'tokenAddress', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'decimals', type: 'uint8' },
          { name: 'oracleAddress', type: 'address' },
          { name: 'minFeeMargin', type: 'uint256' },
          { name: 'maxFeeMargin', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'registrant', type: 'address' },
          { name: 'registrationTime', type: 'uint256' },
          { name: 'totalVolume', type: 'uint256' },
          { name: 'totalTransactions', type: 'uint256' },
          { name: 'metadataHash', type: 'bytes32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'registrationFee',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getTokenInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'symbol', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'decimals', type: 'uint8' },
    ],
  },
] as const

export const PAYMASTER_FACTORY_ABI = [
  {
    type: 'function',
    name: 'deployPaymaster',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'feeMargin', type: 'uint256' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [
      { name: 'paymaster', type: 'address' },
      { name: 'vault', type: 'address' },
      { name: 'distributor', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getDeployment',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'paymaster', type: 'address' },
      { name: 'vault', type: 'address' },
      { name: 'oracle', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllDeployments',
    inputs: [],
    outputs: [{ name: 'tokens', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const

export const LIQUIDITY_VAULT_ABI = [
  {
    type: 'function',
    name: 'addETHLiquidity',
    inputs: [],
    outputs: [{ name: 'lpTokens', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'removeETHLiquidity',
    inputs: [{ name: 'lpTokens', type: 'uint256' }],
    outputs: [{ name: 'ethAmount', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimFees',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getLPPosition',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'ethShareBalance', type: 'uint256' },
      { name: 'ethValue', type: 'uint256' },
      { name: 'tokenShareBalance', type: 'uint256' },
      { name: 'tokenValue', type: 'uint256' },
      { name: 'pendingFeeAmount', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const IERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const
