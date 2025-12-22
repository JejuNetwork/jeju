/**
 * @fileoverview Account Abstraction (ERC-4337) utilities for network contracts
 * @module @jejunetwork/contracts/aa
 */

import type { Address, Hex } from 'viem'
import { encodePacked, pad, toHex } from 'viem'

export const ENTRYPOINT_V07_ADDRESS =
  '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const

export const DEFAULT_GAS_LIMITS = {
  verificationGasLimit: 100000n,
  postOpGasLimit: 50000n,
} as const

export interface PaymasterData {
  paymasterAndData: Hex
  paymaster: Address
  verificationGasLimit: bigint
  postOpGasLimit: bigint
}

export interface SponsoredPaymasterConfig {
  paymaster: Address
  verificationGasLimit?: bigint
  postOpGasLimit?: bigint
}

export interface LiquidityPaymasterConfig {
  paymaster: Address
  appAddress: Address
  verificationGasLimit?: bigint
  postOpGasLimit?: bigint
}

export interface MultiTokenPaymasterConfig {
  paymaster: Address
  serviceName: string
  paymentToken: 0 | 1 | 2
  overpayment?: bigint
  verificationGasLimit?: bigint
  postOpGasLimit?: bigint
}

export function getSponsoredPaymasterData(
  config: SponsoredPaymasterConfig,
): PaymasterData {
  const verificationGasLimit =
    config.verificationGasLimit ?? DEFAULT_GAS_LIMITS.verificationGasLimit
  const postOpGasLimit =
    config.postOpGasLimit ?? DEFAULT_GAS_LIMITS.postOpGasLimit

  const paymasterAndData = encodePacked(
    ['address', 'uint128', 'uint128'],
    [config.paymaster, verificationGasLimit, postOpGasLimit],
  )

  return {
    paymasterAndData,
    paymaster: config.paymaster,
    verificationGasLimit,
    postOpGasLimit,
  }
}

export function getLiquidityPaymasterData(
  config: LiquidityPaymasterConfig,
): PaymasterData {
  const verificationGasLimit =
    config.verificationGasLimit ?? DEFAULT_GAS_LIMITS.verificationGasLimit
  const postOpGasLimit =
    config.postOpGasLimit ?? DEFAULT_GAS_LIMITS.postOpGasLimit

  const paymasterAndData = encodePacked(
    ['address', 'uint128', 'uint128', 'address'],
    [config.paymaster, verificationGasLimit, postOpGasLimit, config.appAddress],
  )

  return {
    paymasterAndData,
    paymaster: config.paymaster,
    verificationGasLimit,
    postOpGasLimit,
  }
}

export function getMultiTokenPaymasterData(
  config: MultiTokenPaymasterConfig,
): PaymasterData {
  const verificationGasLimit =
    config.verificationGasLimit ?? DEFAULT_GAS_LIMITS.verificationGasLimit
  const postOpGasLimit =
    config.postOpGasLimit ?? DEFAULT_GAS_LIMITS.postOpGasLimit

  const serviceNameBytes = new TextEncoder().encode(config.serviceName)

  let data = encodePacked(
    ['address', 'uint128', 'uint128', 'uint8', 'bytes', 'uint8'],
    [
      config.paymaster,
      verificationGasLimit,
      postOpGasLimit,
      serviceNameBytes.length,
      toHex(serviceNameBytes),
      config.paymentToken,
    ],
  )

  if (config.overpayment !== undefined && config.overpayment > 0n) {
    data = (data + pad(toHex(config.overpayment), { size: 32 }).slice(2)) as Hex
  }

  return {
    paymasterAndData: data,
    paymaster: config.paymaster,
    verificationGasLimit,
    postOpGasLimit,
  }
}

export function parsePaymasterAddress(
  paymasterAndData: Hex,
): Address | undefined {
  if (!paymasterAndData || paymasterAndData.length < 42) {
    return undefined
  }
  return paymasterAndData.slice(0, 42) as Address
}

export function isSponsoredPaymaster(paymasterAndData: Hex): boolean {
  return paymasterAndData.length === 106
}

export function calculateRequiredDeposit(
  maxGasCost: bigint,
  safetyMargin = 1.2,
): bigint {
  return BigInt(Math.ceil(Number(maxGasCost) * safetyMargin))
}

export const SponsoredPaymasterAbi = [
  {
    name: 'canSponsor',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'target', type: 'address' },
      { name: 'gasCost', type: 'uint256' },
    ],
    outputs: [
      { name: 'canSponsor', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    name: 'getRemainingTx',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'remaining', type: 'uint256' }],
  },
  {
    name: 'getStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'deposit', type: 'uint256' },
      { name: 'isPaused', type: 'bool' },
      { name: 'totalTx', type: 'uint256' },
      { name: 'totalGas', type: 'uint256' },
    ],
  },
  {
    name: 'isWhitelisted',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'target', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'fund',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
] as const

export const LiquidityPaymasterAbi = [
  {
    name: 'isOperational',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'entryPointBalance', type: 'uint256' },
      { name: 'vaultLiquidity', type: 'uint256' },
      { name: 'oracleFresh', type: 'bool' },
      { name: 'operational', type: 'bool' },
    ],
  },
  {
    name: 'calculateElizaOSAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'gasCostInETH', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'previewCost',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'estimatedGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const EntryPointAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'depositTo',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    name: 'getNonce',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
