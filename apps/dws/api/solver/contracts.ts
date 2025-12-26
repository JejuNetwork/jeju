/**
 * Shared contract loading for solver components
 * Uses @jejunetwork/config for contract addresses (serverless-compatible)
 */
import {
  getChainId,
  getContract,
  getExternalContract,
} from '@jejunetwork/config'
import { isNativeToken } from '@jejunetwork/types'

export { isNativeToken }

export const OUTPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'fillDirect',
    inputs: [
      { name: 'orderId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'isFilled',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const

export const INPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'settle',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'canSettle',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOrder',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'user', type: 'address' },
          { name: 'inputToken', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
          { name: 'outputToken', type: 'address' },
          { name: 'outputAmount', type: 'uint256' },
          { name: 'destinationChainId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'maxFee', type: 'uint256' },
          { name: 'openDeadline', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'solver', type: 'address' },
          { name: 'filled', type: 'bool' },
          { name: 'refunded', type: 'bool' },
          { name: 'createdBlock', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

export const ORACLE_ABI = [
  {
    type: 'function',
    name: 'hasAttested',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'submitAttestation',
    inputs: [
      { name: 'orderId', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export const ERC20_APPROVE_ABI = [
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
] as const

type OifContractKey =
  | 'inputSettler'
  | 'outputSettler'
  | 'oracle'
  | 'solverRegistry'

/** Chain ID to external chain name mapping */
const CHAIN_ID_TO_NAME: Record<number, string> = {
  11155111: 'sepolia',
  84532: 'base-sepolia',
  421614: 'arbitrumSepolia',
  11155420: 'optimismSepolia',
  97: 'bscTestnet',
  56: 'bsc',
  1: 'ethereum',
  8453: 'base',
  42161: 'arbitrum',
  10: 'optimism',
}

/** Get OIF contract address for a given chain ID */
function getOifAddress(
  chainId: number,
  key: OifContractKey,
): `0x${string}` | undefined {
  // Check if it's a Jeju network (localnet, testnet, mainnet)
  const jejuChainId = getChainId()
  if (chainId === jejuChainId) {
    const configKey = key === 'oracle' ? 'oracleAdapter' : key
    try {
      const addr = getContract('oif', configKey)
      return addr ? (addr as `0x${string}`) : undefined
    } catch {
      return undefined
    }
  }

  // Check external chains - silently return undefined for unconfigured chains
  const chainName = CHAIN_ID_TO_NAME[chainId]
  if (!chainName) return undefined

  const configKey = key === 'oracle' ? 'oracleAdapter' : key
  try {
    const addr = getExternalContract(chainName, 'oif', configKey)
    return addr ? (addr as `0x${string}`) : undefined
  } catch {
    return undefined
  }
}

function extractAddresses(key: OifContractKey): Record<number, `0x${string}`> {
  const out: Record<number, `0x${string}`> = {}

  // Add Jeju network addresses
  const jejuChainId = getChainId()
  const jejuAddr = getOifAddress(jejuChainId, key)
  if (jejuAddr) out[jejuChainId] = jejuAddr

  // Add external chain addresses
  for (const [chainIdStr, _chainName] of Object.entries(CHAIN_ID_TO_NAME)) {
    const chainId = Number(chainIdStr)
    const addr = getOifAddress(chainId, key)
    if (addr) out[chainId] = addr
  }

  return out
}

export const INPUT_SETTLERS = extractAddresses('inputSettler')
export const OUTPUT_SETTLERS = extractAddresses('outputSettler')
export const ORACLES = extractAddresses('oracle')
export const SOLVER_REGISTRIES = extractAddresses('solverRegistry')

/** Convert bytes32 address to 0x address format */
export function bytes32ToAddress(b32: `0x${string}`): `0x${string}` {
  return `0x${b32.slice(26)}` as `0x${string}`
}
