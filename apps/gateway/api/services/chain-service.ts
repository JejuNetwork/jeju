import { safeReadContract } from '@jejunetwork/shared'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Abi,
  type Address,
  createPublicClient,
  type Hex,
  http,
} from 'viem'
import { getChain } from '../../lib/chains'
import {
  INPUT_SETTLER_ADDRESS,
  OUTPUT_SETTLER_ADDRESS,
  SOLVER_REGISTRY_ADDRESS,
} from '../../lib/config/contracts'
import { getRpcUrl, JEJU_CHAIN_ID } from '../../lib/config/networks'

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

type Client = ReturnType<typeof createPublicClient>
const clients = new Map<number, Client>()

function getClient(chainId: number): Client {
  let client = clients.get(chainId)
  if (!client) {
    const chain = getChain(chainId)
    const rpcUrl = getRpcUrl(chainId)
    client = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })
    clients.set(chainId, client)
  }
  return client
}

function getInputSettler(_chainId: number): Address {
  return INPUT_SETTLER_ADDRESS
}

function getOutputSettler(_chainId: number): Address {
  return OUTPUT_SETTLER_ADDRESS
}

function getSolverRegistry(): Address {
  return SOLVER_REGISTRY_ADDRESS
}

/** Order data from InputSettler.getOrder - matches ABI output tuple */
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
  orderId: Hex,
): Promise<OrderResult | null> {
  const settler = getInputSettler(chainId)
  if (settler === ZERO_ADDRESS) {
    return null
  }

  const client = getClient(chainId)

  const order = await safeReadContract<OrderResult>(client, {
    address: settler,
    abi: INPUT_SETTLER_ABI,
    functionName: 'getOrder',
    args: [orderId],
  })

  return order
}

export async function fetchFillStatus(
  chainId: number,
  orderId: Hex,
): Promise<boolean> {
  const settler = getOutputSettler(chainId)
  if (settler === ZERO_ADDRESS) {
    return false
  }

  const client = getClient(chainId)

  return safeReadContract<boolean>(client, {
    address: settler,
    abi: OUTPUT_SETTLER_ABI,
    functionName: 'isFilled',
    args: [orderId],
  })
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

  const client = getClient(JEJU_CHAIN_ID)

  const info = await safeReadContract<SolverInfo>(client, {
    address: registry,
    abi: SOLVER_REGISTRY_ABI,
    functionName: 'getSolver',
    args: [solverAddress],
  })

  return info
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

  const client = getClient(JEJU_CHAIN_ID)

  const result = await safeReadContract<readonly [bigint, bigint, bigint]>(
    client,
    {
      address: registry,
      abi: SOLVER_REGISTRY_ABI,
      functionName: 'getStats',
    },
  ).catch((): null => null)

  if (!result) return null
  const [totalStaked, totalSlashed, activeSolvers] = result

  return { totalStaked, totalSlashed, activeSolvers }
}

export function watchOrders(
  chainId: number,
  callback: (log: { orderId: Hex; user: Address; inputAmount: bigint }) => void,
): () => void {
  const settler = getInputSettler(chainId)
  if (settler === ZERO_ADDRESS) {
    return () => {}
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
  callback: (log: { orderId: Hex; solver: Address; amount: bigint }) => void,
): () => void {
  const settler = getOutputSettler(chainId)
  if (settler === ZERO_ADDRESS) {
    return () => {}
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
