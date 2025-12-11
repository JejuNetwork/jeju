/**
 * @fileoverview Account Abstraction (ERC-4337) utilities for Jeju contracts
 * @module @jejunetwork/contracts/aa
 *
 * This module provides helpers for gasless transactions using ERC-4337.
 * 
 * Paymasters Available:
 * - SponsoredPaymaster: Free transactions for games (platform pays)
 * - LiquidityPaymaster: Pay gas in elizaOS tokens
 * - MultiTokenPaymaster: Pay gas in USDC/elizaOS with credit system
 *
 * @example
 * ```typescript
 * import { 
 *   getSponsoredPaymasterData,
 *   getLiquidityPaymasterData,
 *   ENTRYPOINT_V07_ADDRESS,
 * } from '@jejunetwork/contracts/aa';
 *
 * // For free game transactions:
 * const paymasterData = getSponsoredPaymasterData(SPONSORED_PAYMASTER_ADDRESS);
 *
 * // For token-paid transactions:
 * const paymasterData = getLiquidityPaymasterData(
 *   LIQUIDITY_PAYMASTER_ADDRESS,
 *   appRevenueAddress,
 * );
 * ```
 */

import type { Address, Hex } from 'viem';
import { encodePacked, pad, toHex } from 'viem';

// ============================================================================
// Constants
// ============================================================================

/**
 * ERC-4337 EntryPoint v0.7 address (same on all chains)
 */
export const ENTRYPOINT_V07_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;

/**
 * Default gas limits for paymasters
 */
export const DEFAULT_GAS_LIMITS = {
  verificationGasLimit: 100000n,
  postOpGasLimit: 50000n,
} as const;

// ============================================================================
// Types
// ============================================================================

export interface PaymasterData {
  /** Full paymasterAndData hex string */
  paymasterAndData: Hex;
  /** Paymaster address */
  paymaster: Address;
  /** Verification gas limit */
  verificationGasLimit: bigint;
  /** Post-operation gas limit */
  postOpGasLimit: bigint;
}

export interface SponsoredPaymasterConfig {
  /** Paymaster contract address */
  paymaster: Address;
  /** Custom verification gas limit (default: 100000) */
  verificationGasLimit?: bigint;
  /** Custom post-op gas limit (default: 50000) */
  postOpGasLimit?: bigint;
}

export interface LiquidityPaymasterConfig {
  /** Paymaster contract address */
  paymaster: Address;
  /** App address that receives fee revenue share */
  appAddress: Address;
  /** Custom verification gas limit (default: 100000) */
  verificationGasLimit?: bigint;
  /** Custom post-op gas limit (default: 50000) */
  postOpGasLimit?: bigint;
}

export interface MultiTokenPaymasterConfig {
  /** Paymaster contract address */
  paymaster: Address;
  /** Service name being called */
  serviceName: string;
  /** Payment token: 0=USDC, 1=elizaOS, 2=ETH */
  paymentToken: 0 | 1 | 2;
  /** Overpayment amount to credit (optional) */
  overpayment?: bigint;
  /** Custom verification gas limit */
  verificationGasLimit?: bigint;
  /** Custom post-op gas limit */
  postOpGasLimit?: bigint;
}

// ============================================================================
// Paymaster Data Builders
// ============================================================================

/**
 * Build paymasterAndData for SponsoredPaymaster (free transactions)
 * 
 * @param config - Sponsored paymaster configuration
 * @returns PaymasterData for UserOperation
 * 
 * @example
 * ```typescript
 * const { paymasterAndData } = getSponsoredPaymasterData({
 *   paymaster: '0x...',
 * });
 * 
 * const userOp = {
 *   ...baseUserOp,
 *   paymasterAndData,
 * };
 * ```
 */
export function getSponsoredPaymasterData(config: SponsoredPaymasterConfig): PaymasterData {
  const verificationGasLimit = config.verificationGasLimit ?? DEFAULT_GAS_LIMITS.verificationGasLimit;
  const postOpGasLimit = config.postOpGasLimit ?? DEFAULT_GAS_LIMITS.postOpGasLimit;

  // Format: paymaster (20) + verificationGasLimit (16) + postOpGasLimit (16)
  // Total: 52 bytes
  const paymasterAndData = encodePacked(
    ['address', 'uint128', 'uint128'],
    [config.paymaster, verificationGasLimit, postOpGasLimit]
  );

  return {
    paymasterAndData,
    paymaster: config.paymaster,
    verificationGasLimit,
    postOpGasLimit,
  };
}

/**
 * Build paymasterAndData for LiquidityPaymaster (pay gas in tokens)
 * 
 * @param config - Liquidity paymaster configuration
 * @returns PaymasterData for UserOperation
 * 
 * @example
 * ```typescript
 * const { paymasterAndData } = getLiquidityPaymasterData({
 *   paymaster: '0x...',
 *   appAddress: '0x...',  // App revenue address
 * });
 * 
 * const userOp = {
 *   ...baseUserOp,
 *   paymasterAndData,
 * };
 * ```
 */
export function getLiquidityPaymasterData(config: LiquidityPaymasterConfig): PaymasterData {
  const verificationGasLimit = config.verificationGasLimit ?? DEFAULT_GAS_LIMITS.verificationGasLimit;
  const postOpGasLimit = config.postOpGasLimit ?? DEFAULT_GAS_LIMITS.postOpGasLimit;

  // Format: paymaster (20) + verificationGasLimit (16) + postOpGasLimit (16) + appAddress (20)
  // Total: 72 bytes
  const paymasterAndData = encodePacked(
    ['address', 'uint128', 'uint128', 'address'],
    [config.paymaster, verificationGasLimit, postOpGasLimit, config.appAddress]
  );

  return {
    paymasterAndData,
    paymaster: config.paymaster,
    verificationGasLimit,
    postOpGasLimit,
  };
}

/**
 * Build paymasterAndData for MultiTokenPaymaster (credit system)
 * 
 * @param config - Multi-token paymaster configuration
 * @returns PaymasterData for UserOperation
 * 
 * @example
 * ```typescript
 * const { paymasterAndData } = getMultiTokenPaymasterData({
 *   paymaster: '0x...',
 *   serviceName: 'ai-inference',
 *   paymentToken: 0, // USDC
 *   overpayment: 10_000_000n, // 10 USDC
 * });
 * ```
 */
export function getMultiTokenPaymasterData(config: MultiTokenPaymasterConfig): PaymasterData {
  const verificationGasLimit = config.verificationGasLimit ?? DEFAULT_GAS_LIMITS.verificationGasLimit;
  const postOpGasLimit = config.postOpGasLimit ?? DEFAULT_GAS_LIMITS.postOpGasLimit;

  const serviceNameBytes = new TextEncoder().encode(config.serviceName);

  // Format: paymaster (20) + verificationGasLimit (16) + postOpGasLimit (16) +
  //         serviceNameLength (1) + serviceName (N) + paymentToken (1) + [overpayment (32)]
  let data = encodePacked(
    ['address', 'uint128', 'uint128', 'uint8', 'bytes', 'uint8'],
    [
      config.paymaster,
      verificationGasLimit,
      postOpGasLimit,
      serviceNameBytes.length,
      toHex(serviceNameBytes),
      config.paymentToken,
    ]
  );

  if (config.overpayment !== undefined && config.overpayment > 0n) {
    data = (data + pad(toHex(config.overpayment), { size: 32 }).slice(2)) as Hex;
  }

  return {
    paymasterAndData: data,
    paymaster: config.paymaster,
    verificationGasLimit,
    postOpGasLimit,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse paymasterAndData to extract paymaster address
 * 
 * @param paymasterAndData - The paymasterAndData hex string
 * @returns Paymaster address or null if invalid
 */
export function parsePaymasterAddress(paymasterAndData: Hex): Address | null {
  if (!paymasterAndData || paymasterAndData.length < 42) {
    return null;
  }
  return paymasterAndData.slice(0, 42) as Address;
}

/**
 * Check if paymasterAndData is for sponsored (free) transactions
 * 
 * @param paymasterAndData - The paymasterAndData hex string
 * @returns True if this is sponsored (52 bytes = no custom data)
 */
export function isSponsoredPaymaster(paymasterAndData: Hex): boolean {
  // Sponsored paymaster has exactly 52 bytes (20 + 16 + 16)
  // Liquidity paymaster has 72 bytes (20 + 16 + 16 + 20)
  return paymasterAndData.length === 106; // "0x" + 52 bytes * 2
}

/**
 * Calculate the minimum paymaster deposit needed for a UserOperation
 * 
 * @param maxGasCost - Maximum gas cost in wei
 * @param safetyMargin - Additional margin (default 1.2 = 20%)
 * @returns Required deposit in wei
 */
export function calculateRequiredDeposit(maxGasCost: bigint, safetyMargin = 1.2): bigint {
  return BigInt(Math.ceil(Number(maxGasCost) * safetyMargin));
}

// ============================================================================
// Contract ABIs (Minimal for paymaster interactions)
// ============================================================================

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
] as const;

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
] as const;

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
] as const;
