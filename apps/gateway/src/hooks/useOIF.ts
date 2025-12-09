/**
 * @fileoverview React hooks for OIF (Open Intents Framework) integration
 * Provides cross-chain intent creation, quote fetching, and status tracking
 */

import { useState, useCallback, useMemo } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, usePublicClient } from 'wagmi';
import { parseEther, type Address, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';

// ============ ABIs ============

const INPUT_SETTLER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'originSettler', type: 'address' },
          { name: 'user', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'originChainId', type: 'uint256' },
          { name: 'openDeadline', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'orderDataType', type: 'bytes32' },
          { name: 'orderData', type: 'bytes' },
        ],
        name: 'order',
        type: 'tuple',
      },
    ],
    name: 'open',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    name: 'getOrder',
    outputs: [
      {
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
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    name: 'canRefund',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    name: 'refund',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserNonce',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const SOLVER_REGISTRY_ABI = [
  {
    inputs: [{ name: 'chains', type: 'uint256[]' }],
    name: 'register',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'addStake',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'startUnbonding',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'solver', type: 'address' }],
    name: 'getSolver',
    outputs: [
      {
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
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'solver', type: 'address' }],
    name: 'isSolverActive',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getStats',
    outputs: [
      { name: '_totalStaked', type: 'uint256' },
      { name: '_totalSlashed', type: 'uint256' },
      { name: '_activeSolvers', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ============ Types ============

interface CreateIntentParams {
  inputToken: Address;
  inputAmount: bigint;
  outputToken: Address;
  outputAmount: bigint;
  destinationChainId: number;
  recipient: Address;
  maxFee: bigint;
  openDeadlineBlocks?: number;
  fillDeadlineBlocks?: number;
}

interface IntentOrder {
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

// ============ Configuration ============

// Contract addresses - set via environment or use defaults for development
const getEnvAddress = (key: string, fallback: Address = '0x0000000000000000000000000000000000000000'): Address => {
  if (typeof window === 'undefined') return fallback;
  const envValue = (import.meta as { env?: Record<string, string> }).env?.[key];
  return (envValue as Address) || fallback;
};

const OIF_CONFIG = {
  inputSettlers: {
    1: getEnvAddress('VITE_OIF_INPUT_SETTLER_ETHEREUM'),
    42161: getEnvAddress('VITE_OIF_INPUT_SETTLER_ARBITRUM'),
    10: getEnvAddress('VITE_OIF_INPUT_SETTLER_OPTIMISM'),
    420691: getEnvAddress('VITE_OIF_INPUT_SETTLER_JEJU'),
    11155111: getEnvAddress('VITE_OIF_INPUT_SETTLER_SEPOLIA'),
  } as Record<number, Address>,
  solverRegistry: getEnvAddress('VITE_OIF_SOLVER_REGISTRY'),
  defaultOpenDeadlineBlocks: 100,
  defaultFillDeadlineBlocks: 1000,
  minSolverStake: parseEther('0.5'),
};

// ============ Hooks ============

/**
 * Hook for creating cross-chain intents
 */
export function useCreateIntent(inputSettlerAddress: Address | undefined) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [intentId, setIntentId] = useState<`0x${string}` | null>(null);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  // Get user nonce
  const { data: nonce } = useReadContract({
    address: inputSettlerAddress,
    abi: INPUT_SETTLER_ABI,
    functionName: 'getUserNonce',
    args: address ? [address] : undefined,
  });

  const createIntent = useCallback(
    async (params: CreateIntentParams) => {
      if (!address || !inputSettlerAddress || !publicClient) {
        throw new Error('Not connected');
      }

      const currentBlock = await publicClient.getBlockNumber();
      const openDeadline = Number(currentBlock) + (params.openDeadlineBlocks || OIF_CONFIG.defaultOpenDeadlineBlocks);
      const fillDeadline = Number(currentBlock) + (params.fillDeadlineBlocks || OIF_CONFIG.defaultFillDeadlineBlocks);

      // Encode order data
      const orderData = encodeAbiParameters(
        parseAbiParameters('address, uint256, address, uint256, uint256, address, uint256'),
        [
          params.inputToken,
          params.inputAmount,
          params.outputToken,
          params.outputAmount,
          BigInt(params.destinationChainId),
          params.recipient,
          params.maxFee,
        ]
      );

      // Generate intent ID
      const id = keccak256(
        encodeAbiParameters(
          parseAbiParameters('address, uint256, uint256, address, uint256'),
          [
            address,
            nonce || 0n,
            params.inputAmount,
            params.inputToken,
            BigInt(Date.now()),
          ]
        )
      );
      setIntentId(id);

      const order = {
        originSettler: inputSettlerAddress,
        user: address,
        nonce: nonce || 0n,
        originChainId: BigInt(await publicClient.getChainId()),
        openDeadline,
        fillDeadline,
        orderDataType: keccak256(encodeAbiParameters(parseAbiParameters('string'), ['CrossChainSwap'])),
        orderData,
      };

      writeContract({
        address: inputSettlerAddress,
        abi: INPUT_SETTLER_ABI,
        functionName: 'open',
        args: [order],
        value: params.inputToken === '0x0000000000000000000000000000000000000000' ? params.inputAmount : 0n,
      });
    },
    [address, inputSettlerAddress, publicClient, nonce, writeContract]
  );

  return {
    createIntent,
    intentId,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

/**
 * Hook for tracking intent status
 */
export function useIntentStatus(inputSettlerAddress: Address | undefined, intentId: `0x${string}` | undefined) {
  const { data: order, refetch } = useReadContract({
    address: inputSettlerAddress,
    abi: INPUT_SETTLER_ABI,
    functionName: 'getOrder',
    args: intentId ? [intentId] : undefined,
    query: {
      enabled: !!inputSettlerAddress && !!intentId,
      refetchInterval: 5000,
    },
  });

  const { data: canRefund } = useReadContract({
    address: inputSettlerAddress,
    abi: INPUT_SETTLER_ABI,
    functionName: 'canRefund',
    args: intentId ? [intentId] : undefined,
    query: {
      enabled: !!inputSettlerAddress && !!intentId,
    },
  });

  const status = useMemo(() => {
    if (!order) return 'unknown';
    if (order.refunded) return 'refunded';
    if (order.filled) return 'filled';
    if (order.solver !== '0x0000000000000000000000000000000000000000') return 'claimed';
    return 'open';
  }, [order]);

  return {
    order: order as IntentOrder | undefined,
    status,
    canRefund: canRefund ?? false,
    refetch,
  };
}

/**
 * Hook for refunding expired intents
 */
export function useRefundIntent(inputSettlerAddress: Address | undefined) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const refund = useCallback(
    (intentId: `0x${string}`) => {
      if (!inputSettlerAddress) throw new Error('No settler address');
      
      writeContract({
        address: inputSettlerAddress,
        abi: INPUT_SETTLER_ABI,
        functionName: 'refund',
        args: [intentId],
      });
    },
    [inputSettlerAddress, writeContract]
  );

  return {
    refund,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

/**
 * Hook for solver registration
 */
export function useSolverRegistration(registryAddress: Address | undefined) {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isSuccess, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const register = useCallback(
    (supportedChains: number[], stakeAmount: bigint) => {
      if (!registryAddress) throw new Error('No registry address');
      if (stakeAmount < OIF_CONFIG.minSolverStake) {
        throw new Error(`Minimum stake is ${OIF_CONFIG.minSolverStake} wei`);
      }

      writeContract({
        address: registryAddress,
        abi: SOLVER_REGISTRY_ABI,
        functionName: 'register',
        args: [supportedChains.map(BigInt)],
        value: stakeAmount,
      });
    },
    [registryAddress, writeContract]
  );

  const addStake = useCallback(
    (amount: bigint) => {
      if (!registryAddress) throw new Error('No registry address');

      writeContract({
        address: registryAddress,
        abi: SOLVER_REGISTRY_ABI,
        functionName: 'addStake',
        args: [],
        value: amount,
      });
    },
    [registryAddress, writeContract]
  );

  const startUnbonding = useCallback(
    (amount: bigint) => {
      if (!registryAddress) throw new Error('No registry address');

      writeContract({
        address: registryAddress,
        abi: SOLVER_REGISTRY_ABI,
        functionName: 'startUnbonding',
        args: [amount],
      });
    },
    [registryAddress, writeContract]
  );

  // Get solver info
  const { data: solverInfo } = useReadContract({
    address: registryAddress,
    abi: SOLVER_REGISTRY_ABI,
    functionName: 'getSolver',
    args: address ? [address] : undefined,
    query: {
      enabled: !!registryAddress && !!address,
    },
  });

  return {
    register,
    addStake,
    startUnbonding,
    solverInfo: solverInfo as SolverInfo | undefined,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

/**
 * Hook for solver registry stats
 */
export function useSolverRegistryStats(registryAddress: Address | undefined) {
  const { data: stats, refetch } = useReadContract({
    address: registryAddress,
    abi: SOLVER_REGISTRY_ABI,
    functionName: 'getStats',
    query: {
      enabled: !!registryAddress,
      refetchInterval: 30000,
    },
  });

  return {
    totalStaked: stats?.[0] ?? 0n,
    totalSlashed: stats?.[1] ?? 0n,
    activeSolvers: stats?.[2] ?? 0n,
    refetch,
  };
}

/**
 * Hook for OIF configuration
 */
export function useOIFConfig() {
  return {
    inputSettlers: OIF_CONFIG.inputSettlers,
    solverRegistry: OIF_CONFIG.solverRegistry,
    minSolverStake: OIF_CONFIG.minSolverStake,
    defaultOpenDeadlineBlocks: OIF_CONFIG.defaultOpenDeadlineBlocks,
    defaultFillDeadlineBlocks: OIF_CONFIG.defaultFillDeadlineBlocks,
  };
}

