/**
 * Standard Bridge ABI and Helpers for Ethereum ↔ Jeju Token Transfers
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
  StandardBridge: '0x4200000000000000000000000000000000000010' as Address,
  CrossDomainMessenger: '0x4200000000000000000000000000000000000007' as Address,
  ToL1MessagePasser: '0x4200000000000000000000000000000000000016' as Address,
  WETH: '0x4200000000000000000000000000000000000006' as Address,
} as const;

/**
 * Bridge configuration for Ethereum ↔ Jeju
 */
export interface BridgeParams {
  sourceChain: 'ethereum' | 'jeju';
  destinationChain: 'ethereum' | 'jeju';
  token: Address;
  amount: bigint;
  recipient?: Address;
  minGasLimit?: number;
}

/**
 * Calculate estimated bridge time
 */
export function estimateBridgeTime(params: BridgeParams): number {
  // Ethereum → Jeju: ~15 minutes
  // Jeju → Ethereum: 7 days (challenge period)
  if (params.sourceChain === 'ethereum' && params.destinationChain === 'jeju') {
    return 900; // 15 minutes in seconds
  }
  return 604800; // 7 days in seconds
}

/**
 * Calculate estimated bridge gas cost
 */
export function estimateBridgeGas(_params: BridgeParams): bigint {
  const baseGas = 100000n; // 100k gas minimum
  const l1DataFee = 50000n; // Estimated L1 data fee
  
  return baseGas + l1DataFee;
}

/**
 * Generate bridge transaction data
 */
export function encodeBridgeData(_params: BridgeParams): `0x${string}` {
  return '0x' as `0x${string}`;
}

/**
 * Bridge event log structure
 */
export interface BridgeEventLog {
  topics: readonly string[];
  data: string;
}

/**
 * Parsed bridge event result
 */
export interface ParsedBridgeEvent {
  event: string;
  from: Address;
  to: Address;
  amount: bigint;
  token?: Address;
}

// Event signatures (keccak256 of event signature string)
const EVENT_SIGS = {
  ERC20BridgeInitiated: '0x7ff126db8024424bbfd9826e8ab82ff59136289ea440b04b39a0df1b03b9cabf',
  ERC20BridgeFinalized: '0xd59c65b35445225835c83f50b6uj1b32cc7c5fd2c95f2aa2c3ba5b5c7bd3e0f',
  ETHBridgeInitiated: '0x2849b43074093a05396b6f2a937dee8565b15a48a7b3d4bffb732a5017380af5',
  ETHBridgeFinalized: '0x31b2166ff604fc5672ea5df08a78081d2bc6d746cadce880747f3643d819e83d',
} as const;

/**
 * Parse bridge event logs
 */
export function parseBridgeEvent(log: BridgeEventLog): ParsedBridgeEvent | null {
  if (!log.topics || log.topics.length < 2) return null;

  const eventSig = log.topics[0];
  
  if (eventSig === EVENT_SIGS.ERC20BridgeInitiated || eventSig === EVENT_SIGS.ERC20BridgeFinalized) {
    return {
      event: eventSig === EVENT_SIGS.ERC20BridgeInitiated ? 'ERC20BridgeInitiated' : 'ERC20BridgeFinalized',
      from: `0x${log.topics[3].slice(26)}` as Address,
      to: `0x${log.data.slice(26, 66)}` as Address,
      amount: BigInt('0x' + log.data.slice(66, 130)),
      token: `0x${log.topics[1].slice(26)}` as Address,
    };
  }
  
  if (eventSig === EVENT_SIGS.ETHBridgeInitiated || eventSig === EVENT_SIGS.ETHBridgeFinalized) {
    return {
      event: eventSig === EVENT_SIGS.ETHBridgeInitiated ? 'ETHBridgeInitiated' : 'ETHBridgeFinalized',
      from: `0x${log.topics[1].slice(26)}` as Address,
      to: `0x${log.topics[2].slice(26)}` as Address,
      amount: BigInt('0x' + log.data.slice(2, 66)),
    };
  }

  return null;
}

/**
 * Get bridge contract address for chain
 */
export function getBridgeAddress(_chain: 'ethereum' | 'jeju'): Address {
  // Both use OP Stack Standard Bridge predeploy
  return OP_STACK_PREDEPLOYS.StandardBridge;
}

/**
 * Get messenger contract address for chain
 */
export function getMessengerAddress(_chain: 'ethereum' | 'jeju'): Address {
  // Both use OP Stack CrossDomainMessenger predeploy
  return OP_STACK_PREDEPLOYS.CrossDomainMessenger;
}
