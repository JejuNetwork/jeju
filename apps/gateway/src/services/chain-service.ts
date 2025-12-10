import { createPublicClient, http, type PublicClient, type Address, type Abi } from 'viem';
import { CHAINS, getChain } from '../lib/chains.js';

// ABIs for reading contract state and watching events
const INPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'getOrder',
    stateMutability: 'view',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [{
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
    }],
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
] as const;

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
] as const;

const SOLVER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getSolver',
    stateMutability: 'view',
    inputs: [{ name: 'solver', type: 'address' }],
    outputs: [{
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
    }],
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
] as const satisfies Abi;

const clients = new Map<number, PublicClient>();

function getClient(chainId: number): PublicClient {
  if (!clients.has(chainId)) {
    const chain = getChain(chainId);
    const rpcUrl = process.env[`OIF_RPC_${chainId}`] 
      || process.env[`${chain.name.toUpperCase().replace(/ /g, '_')}_RPC_URL`]
      || chain.rpcUrls.default.http[0];
    
    clients.set(chainId, createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient);
  }
  return clients.get(chainId)!;
}

function getInputSettler(chainId: number): Address | undefined {
  return process.env[`OIF_INPUT_SETTLER_${chainId}`] as Address;
}

function getOutputSettler(chainId: number): Address | undefined {
  return process.env[`OIF_OUTPUT_SETTLER_${chainId}`] as Address;
}

function getSolverRegistry(): Address | undefined {
  return process.env.OIF_SOLVER_REGISTRY as Address;
}

interface OrderResult {
  user: Address;
  inputToken: Address;
  inputAmount: bigint;
  outputToken: Address;
  outputAmount: bigint;
  destinationChainId: bigint;
  recipient: Address;
  maxFee: bigint;
  openDeadline: number;
  fillDeadline: number;
  solver: Address;
  filled: boolean;
  refunded: boolean;
  createdBlock: bigint;
}

export async function fetchOrder(chainId: number, orderId: `0x${string}`): Promise<OrderResult | null> {
  const settler = getInputSettler(chainId);
  if (!settler || settler === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  const client = getClient(chainId);
  
  const order = await client.readContract({
    address: settler,
    abi: INPUT_SETTLER_ABI,
    functionName: 'getOrder',
    args: [orderId],
  }) as OrderResult;

  return order;
}

export async function fetchFillStatus(chainId: number, orderId: `0x${string}`): Promise<boolean> {
  const settler = getOutputSettler(chainId);
  if (!settler || settler === '0x0000000000000000000000000000000000000000') {
    return false;
  }

  const client = getClient(chainId);
  
  return await client.readContract({
    address: settler,
    abi: OUTPUT_SETTLER_ABI,
    functionName: 'isFilled',
    args: [orderId],
  }) as boolean;
}

interface SolverInfo {
  solver: Address;
  stakedAmount: bigint;
  slashedAmount: bigint;
  totalFills: bigint;
  successfulFills: bigint;
  supportedChains: readonly bigint[];
  isActive: boolean;
  registeredAt: bigint;
}

export async function fetchSolverInfo(solverAddress: Address): Promise<SolverInfo | null> {
  const registry = getSolverRegistry();
  if (!registry || registry === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  const client = getClient(1);
  
  const info = await client.readContract({
    address: registry,
    abi: SOLVER_REGISTRY_ABI,
    functionName: 'getSolver',
    args: [solverAddress],
  }) as SolverInfo;

  return info;
}

export async function fetchRegistryStats(): Promise<{
  totalStaked: bigint;
  totalSlashed: bigint;
  activeSolvers: bigint;
} | null> {
  const registry = getSolverRegistry();
  if (!registry || registry === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  const client = getClient(1);
  
  const result = await client.readContract({
    address: registry,
    abi: SOLVER_REGISTRY_ABI,
    functionName: 'getStats',
  }) as readonly [bigint, bigint, bigint];

  return { 
    totalStaked: result[0], 
    totalSlashed: result[1], 
    activeSolvers: result[2] 
  };
}

export function watchOrders(chainId: number, callback: (log: { orderId: `0x${string}`; user: Address; inputAmount: bigint }) => void): () => void {
  const settler = getInputSettler(chainId);
  if (!settler || settler === '0x0000000000000000000000000000000000000000') {
    return () => {};
  }

  const client = getClient(chainId);
  
  const unwatch = client.watchContractEvent({
    address: settler,
    abi: INPUT_SETTLER_ABI,
    eventName: 'OrderCreated',
    onLogs: (logs) => {
      for (const log of logs) {
        callback({
          orderId: log.args.orderId!,
          user: log.args.user!,
          inputAmount: log.args.inputAmount!,
        });
      }
    },
  });

  return unwatch;
}

export function watchFills(chainId: number, callback: (log: { orderId: `0x${string}`; solver: Address; amount: bigint }) => void): () => void {
  const settler = getOutputSettler(chainId);
  if (!settler || settler === '0x0000000000000000000000000000000000000000') {
    return () => {};
  }

  const client = getClient(chainId);
  
  const unwatch = client.watchContractEvent({
    address: settler,
    abi: OUTPUT_SETTLER_ABI,
    eventName: 'OrderFilled',
    onLogs: (logs) => {
      for (const log of logs) {
        callback({
          orderId: log.args.orderId!,
          solver: log.args.solver!,
          amount: log.args.amount!,
        });
      }
    },
  });

  return unwatch;
}



