import { ZERO_ADDRESS } from '@jejunetwork/ui'
import {
  type Abi,
  type Address,
  createPublicClient,
  http,
  type PublicClient,
} from 'viem'
import {
  INPUT_SETTLER_ADDRESS,
  OUTPUT_SETTLER_ADDRESS,
  SOLVER_REGISTRY_ADDRESS,
} from '../config/contracts.js'
import { getRpcUrl, JEJU_CHAIN_ID } from '../config/networks.js'
import { getChain } from '../lib/chains.js'

// ABIs for reading contract state and watching events
const INPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'getOrder',
    stateMutability: 'view',
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
  },
  {
    type: 'function',
    name: 'canRefund',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'OrderCreated',
    inputs: [
      { name: 'orderId', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'inputAmount', type: 'uint256', indexed: false },
    ],
  },
] as const

const OUTPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'isFilled',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'OrderFilled',
    inputs: [
      { name: 'orderId', type: 'bytes32', indexed: true },
      { name: 'solver', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

const SOLVER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getSolver',
    stateMutability: 'view',
    inputs: [{ name: 'solver', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'solver', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'slashedAmount', type: 'uint256' },
          { name: 'totalFills', type: 'uint256' },
          { name: 'successfulFills', type: 'uint256' },
          { name: 'supportedChains', type: 'uint256[]' },
          { name: 'isActive', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getStats',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '_totalStaked', type: 'uint256' },
      { name: '_totalSlashed', type: 'uint256' },
      { name: '_activeSolvers', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'isSolverActive',
    stateMutability: 'view',
    inputs: [{ name: 'solver', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const satisfies Abi

const clients = new Map<number, PublicClient>()

function getClient(chainId: number): PublicClient {
  let client = clients.get(chainId)
  if (!client) {
    const chain = getChain(chainId)
    const rpcUrl = getRpcUrl(chainId)
    client = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient
    clients.set(chainId, client)
  }
  return client
}

function getInputSettler(_chainId: number): Address {
  // Using centralized contract addresses from config
  return INPUT_SETTLER_ADDRESS
}

function getOutputSettler(_chainId: number): Address {
  return OUTPUT_SETTLER_ADDRESS
}

function getSolverRegistry(): Address {
  return SOLVER_REGISTRY_ADDRESS
}

interface OrderResult {
  user: Address
  inputToken: Address
  inputAmount: bigint
  outputToken: Address
  outputAmount: bigint
  destinationChainId: bigint
  recipient: Address
  maxFee: bigint
  openDeadline: number
  fillDeadline: number
  solver: Address
  filled: boolean
  refunded: boolean
  createdBlock: bigint
}

export async function fetchOrder(
  chainId: number,
  orderId: `0x${string}`,
): Promise<OrderResult | null> {
  const settler = getInputSettler(chainId)
  if (settler === ZERO_ADDRESS) {
    return null
  }

  const client = getClient(chainId)

  const order = (await client.readContract({
    address: settler,
    abi: INPUT_SETTLER_ABI,
    functionName: 'getOrder',
    args: [orderId],
  })) as OrderResult

  return order
}

export async function fetchFillStatus(
  chainId: number,
  orderId: `0x${string}`,
): Promise<boolean> {
  const settler = getOutputSettler(chainId)
  if (settler === ZERO_ADDRESS) {
    return false
  }

  const client = getClient(chainId)

  return (await client.readContract({
    address: settler,
    abi: OUTPUT_SETTLER_ABI,
    functionName: 'isFilled',
    args: [orderId],
  })) as boolean
}

interface SolverInfo {
  solver: Address
  stakedAmount: bigint
  slashedAmount: bigint
  totalFills: bigint
  successfulFills: bigint
  supportedChains: readonly bigint[]
  isActive: boolean
  registeredAt: bigint
}

export async function fetchSolverInfo(
  solverAddress: Address,
): Promise<SolverInfo | null> {
  const registry = getSolverRegistry()
  if (registry === ZERO_ADDRESS) {
    return null
  }

  // Registry lives on the network testnet (420690) or mainnet (420691)
  const client = getClient(JEJU_CHAIN_ID)

  const info = await client
    .readContract({
      address: registry,
      abi: SOLVER_REGISTRY_ABI,
      functionName: 'getSolver',
      args: [solverAddress],
    })
    .catch(() => null)

  return info as SolverInfo | null
}

export async function fetchRegistryStats(): Promise<{
  totalStaked: bigint
  totalSlashed: bigint
  activeSolvers: bigint
} | null> {
  const registry = getSolverRegistry()
  if (registry === ZERO_ADDRESS) {
    return null
  }

  // Registry lives on the network testnet (420690) or mainnet (420691)
  const client = getClient(JEJU_CHAIN_ID)

  // Return null if contract isn't deployed or call fails
  const result = await client
    .readContract({
      address: registry,
      abi: SOLVER_REGISTRY_ABI,
      functionName: 'getStats',
    })
    .catch(() => null)

  if (!result) return null
  const [totalStaked, totalSlashed, activeSolvers] = result as readonly [
    bigint,
    bigint,
    bigint,
  ]

  return { totalStaked, totalSlashed, activeSolvers }
}

export function watchOrders(
  chainId: number,
  callback: (log: {
    orderId: `0x${string}`
    user: Address
    inputAmount: bigint
  }) => void,
): () => void {
  const settler = getInputSettler(chainId)
  if (settler === ZERO_ADDRESS) {
    return () => {
      /* no settler configured for this chain */
    }
  }

  const client = getClient(chainId)

  const unwatch = client.watchContractEvent({
    address: settler,
    abi: INPUT_SETTLER_ABI,
    eventName: 'OrderCreated',
    onLogs: (logs) => {
      for (const log of logs) {
        const { orderId, user, inputAmount } = log.args
        if (orderId && user && inputAmount !== undefined) {
          callback({ orderId, user, inputAmount })
        }
      }
    },
  })

  return unwatch
}

export function watchFills(
  chainId: number,
  callback: (log: {
    orderId: `0x${string}`
    solver: Address
    amount: bigint
  }) => void,
): () => void {
  const settler = getOutputSettler(chainId)
  if (settler === ZERO_ADDRESS) {
    return () => {
      /* no settler configured for this chain */
    }
  }

  const client = getClient(chainId)

  const unwatch = client.watchContractEvent({
    address: settler,
    abi: OUTPUT_SETTLER_ABI,
    eventName: 'OrderFilled',
    onLogs: (logs) => {
      for (const log of logs) {
        const { orderId, solver, amount } = log.args
        if (orderId && solver && amount !== undefined) {
          callback({ orderId, solver, amount })
        }
      }
    },
  })

  return unwatch
}
