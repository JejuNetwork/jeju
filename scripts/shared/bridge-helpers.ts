/**
 * Standard Bridge ABI and Helpers for Base ↔ Jeju Token Transfers
 */

import type { Address } from 'viem';

export const STANDARD_BRIDGE_ABI = [
  {
    type: 'function',
    name: 'bridgeETH',
    inputs: [
      { name: '_minGasLimit', type: 'uint32' },
      { name: '_extraData', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'bridgeERC20',
    inputs: [
      { name: '_localToken', type: 'address' },
      { name: '_remoteToken', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_minGasLimit', type: 'uint32' },
      { name: '_extraData', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'bridgeERC20To',
    inputs: [
      { name: '_localToken', type: 'address' },
      { name: '_remoteToken', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_minGasLimit', type: 'uint32' },
      { name: '_extraData', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'event',
    name: 'ERC20BridgeInitiated',
    inputs: [
      { name: 'localToken', type: 'address', indexed: true },
      { name: 'remoteToken', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'extraData', type: 'bytes', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'ERC20BridgeFinalized',
    inputs: [
      { name: 'localToken', type: 'address', indexed: true },
      { name: 'remoteToken', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'extraData', type: 'bytes', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'ETHBridgeInitiated',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'extraData', type: 'bytes', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'ETHBridgeFinalized',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'extraData', type: 'bytes', indexed: false }
    ]
  },
] as const;

export const CROSS_DOMAIN_MESSENGER_ABI = [
  {
    type: 'function',
    name: 'sendMessage',
    inputs: [
      { name: '_target', type: 'address' },
      { name: '_message', type: 'bytes' },
      { name: '_minGasLimit', type: 'uint32' }
    ],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'relayMessage',
    inputs: [
      { name: '_nonce', type: 'uint256' },
      { name: '_sender', type: 'address' },
      { name: '_target', type: 'address' },
      { name: '_value', type: 'uint256' },
      { name: '_minGasLimit', type: 'uint256' },
      { name: '_message', type: 'bytes' }
    ],
    outputs: [],
    stateMutability: 'payable'
  },
  {
    type: 'event',
    name: 'SentMessage',
    inputs: [
      { name: 'target', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: false },
      { name: 'message', type: 'bytes', indexed: false },
      { name: 'messageNonce', type: 'uint256', indexed: false },
      { name: 'gasLimit', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'RelayedMessage',
    inputs: [
      { name: 'msgHash', type: 'bytes32', indexed: true }
    ]
  },
] as const;

/**
 * Standard OP Stack predeploy addresses
 */
export const OP_STACK_PREDEPLOYS = {
  L2StandardBridge: '0x4200000000000000000000000000000000000010' as Address,
  L2CrossDomainMessenger: '0x4200000000000000000000000000000000000007' as Address,
  L2ToL1MessagePasser: '0x4200000000000000000000000000000000000016' as Address,
  WETH: '0x4200000000000000000000000000000000000006' as Address,
} as const;

/**
 * Bridge configuration for Base ↔ Jeju
 */
export interface BridgeParams {
  sourceChain: 'base' | 'jeju';
  destinationChain: 'base' | 'jeju';
  token: Address;
  amount: bigint;
  recipient?: Address;
  minGasLimit?: number;
}

/**
 * Calculate estimated bridge time
 */
export function estimateBridgeTime(params: BridgeParams): number {
  // Base → Jeju: ~2 minutes (L2 → L3)
  // Jeju → Base: ~2 minutes (L3 → L2)
  return 120; // seconds
}

/**
 * Calculate estimated bridge gas cost
 */
export function estimateBridgeGas(params: BridgeParams): bigint {
  const baseGas = 100000n; // 100k gas minimum
  const l1DataFee = 50000n; // Estimated L1 data fee
  
  return baseGas + l1DataFee;
}

/**
 * Generate bridge transaction data
 */
export function encodeBridgeData(params: BridgeParams): `0x${string}` {
  return '0x' as `0x${string}`;
}

/**
 * Parse bridge event logs
 */
export function parseBridgeEvent(log: any): {
  event: string;
  from: Address;
  to: Address;
  amount: bigint;
  token?: Address;
} | null {
  // Parse based on event signature
  if (!log.topics || log.topics.length < 2) return null;

  const eventSig = log.topics[0];
  
  // ERC20BridgeInitiated or ERC20BridgeFinalized
  if (eventSig === '0x...' /* actual signature */) {
    return {
      event: 'ERC20BridgeInitiated',
      from: `0x${log.topics[3].slice(26)}` as Address,
      to: log.data.slice(0, 42) as Address,
      amount: BigInt(log.data.slice(42)),
      token: `0x${log.topics[1].slice(26)}` as Address,
    };
  }

  return null;
}

/**
 * Get bridge contract address for chain
 */
export function getBridgeAddress(chain: 'base' | 'jeju'): Address {
  // Both use OP Stack Standard Bridge predeploy
  return OP_STACK_PREDEPLOYS.L2StandardBridge;
}

/**
 * Get messenger contract address for chain
 */
export function getMessengerAddress(chain: 'base' | 'jeju'): Address {
  // Both use OP Stack CrossDomainMessenger predeploy
  return OP_STACK_PREDEPLOYS.L2CrossDomainMessenger;
}

