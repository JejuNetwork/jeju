import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { useMemo } from 'react';

export enum GPUType {
  NONE = 0,
  NVIDIA_RTX_4090 = 1,
  NVIDIA_A100_40GB = 2,
  NVIDIA_A100_80GB = 3,
  NVIDIA_H100 = 4,
  NVIDIA_H200 = 5,
  AMD_MI300X = 6,
  APPLE_M1_MAX = 7,
  APPLE_M2_ULTRA = 8,
  APPLE_M3_MAX = 9,
}

export const GPU_NAMES: Record<GPUType, string> = {
  [GPUType.NONE]: 'No GPU',
  [GPUType.NVIDIA_RTX_4090]: 'NVIDIA RTX 4090',
  [GPUType.NVIDIA_A100_40GB]: 'NVIDIA A100 40GB',
  [GPUType.NVIDIA_A100_80GB]: 'NVIDIA A100 80GB',
  [GPUType.NVIDIA_H100]: 'NVIDIA H100',
  [GPUType.NVIDIA_H200]: 'NVIDIA H200',
  [GPUType.AMD_MI300X]: 'AMD MI300X',
  [GPUType.APPLE_M1_MAX]: 'Apple M1 Max',
  [GPUType.APPLE_M2_ULTRA]: 'Apple M2 Ultra',
  [GPUType.APPLE_M3_MAX]: 'Apple M3 Max',
};

export enum RentalStatus {
  PENDING = 0,
  ACTIVE = 1,
  PAUSED = 2,
  COMPLETED = 3,
  CANCELLED = 4,
  EXPIRED = 5,
  DISPUTED = 6,
}

export const STATUS_LABELS: Record<RentalStatus, string> = {
  [RentalStatus.PENDING]: 'Pending',
  [RentalStatus.ACTIVE]: 'Active',
  [RentalStatus.PAUSED]: 'Paused',
  [RentalStatus.COMPLETED]: 'Completed',
  [RentalStatus.CANCELLED]: 'Cancelled',
  [RentalStatus.EXPIRED]: 'Expired',
  [RentalStatus.DISPUTED]: 'Disputed',
};

export interface ComputeResources {
  gpuType: GPUType;
  gpuCount: number;
  gpuVram: number;
  cpuCores: number;
  memory: number;
  storage: number;
  bandwidth: number;
  teeCapable: boolean;
}

export interface ResourcePricing {
  pricePerHour: bigint;
  pricePerGpuHour: bigint;
  minimumRentalHours: number;
  maximumRentalHours: number;
}

export interface ProviderResources {
  resources: ComputeResources;
  pricing: ResourcePricing;
  maxConcurrent: number;
  activeRentals: number;
  sshEnabled: boolean;
  dockerEnabled: boolean;
}

export interface Rental {
  rentalId: `0x${string}`;
  user: `0x${string}`;
  provider: `0x${string}`;
  status: RentalStatus;
  startTime: bigint;
  endTime: bigint;
  totalCost: bigint;
  paidAmount: bigint;
  refundedAmount: bigint;
  sshPublicKey: string;
  containerImage: string;
  startupScript: string;
  sshHost: string;
  sshPort: number;
}

// Deployed ComputeRental contract address
const COMPUTE_RENTAL_ADDRESS = '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1' as const;

const COMPUTE_RENTAL_ABI = [
  // Read functions
  {
    name: 'getRental',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'rentalId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'rentalId', type: 'bytes32' },
          { name: 'user', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'status', type: 'uint8' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'totalCost', type: 'uint256' },
          { name: 'paidAmount', type: 'uint256' },
          { name: 'refundedAmount', type: 'uint256' },
          { name: 'sshPublicKey', type: 'string' },
          { name: 'containerImage', type: 'string' },
          { name: 'startupScript', type: 'string' },
          { name: 'sshHost', type: 'string' },
          { name: 'sshPort', type: 'uint16' },
        ],
      },
    ],
  },
  {
    name: 'getProviderResources',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'gpuType', type: 'uint8' },
          { name: 'gpuCount', type: 'uint8' },
          { name: 'gpuVram', type: 'uint16' },
          { name: 'cpuCores', type: 'uint16' },
          { name: 'memory', type: 'uint32' },
          { name: 'storage', type: 'uint32' },
          { name: 'bandwidth', type: 'uint32' },
          { name: 'teeCapable', type: 'bool' },
        ],
      },
      {
        type: 'tuple',
        components: [
          { name: 'pricePerHour', type: 'uint256' },
          { name: 'pricePerGpuHour', type: 'uint256' },
          { name: 'minimumRentalHours', type: 'uint256' },
          { name: 'maximumRentalHours', type: 'uint256' },
        ],
      },
      { name: 'maxConcurrent', type: 'uint256' },
      { name: 'activeRentals', type: 'uint256' },
      { name: 'sshEnabled', type: 'bool' },
      { name: 'dockerEnabled', type: 'bool' },
    ],
  },
  {
    name: 'getUserRentals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'calculateRentalCost',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'durationHours', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'isRentalActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'rentalId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getRemainingTime',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'rentalId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Write functions
  {
    name: 'createRental',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'durationHours', type: 'uint256' },
      { name: 'sshPublicKey', type: 'string' },
      { name: 'containerImage', type: 'string' },
      { name: 'startupScript', type: 'string' },
    ],
    outputs: [{ name: 'rentalId', type: 'bytes32' }],
  },
  {
    name: 'extendRental',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'rentalId', type: 'bytes32' },
      { name: 'additionalHours', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'cancelRental',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'rentalId', type: 'bytes32' }],
    outputs: [],
  },
] as const;

export function getComputeRentalAddress(): `0x${string}` {
  return COMPUTE_RENTAL_ADDRESS;
}

export function useProviderResources(provider: `0x${string}` | undefined) {
  const { data, refetch, isLoading } = useReadContract({
    address: COMPUTE_RENTAL_ADDRESS,
    abi: COMPUTE_RENTAL_ABI,
    functionName: 'getProviderResources',
    args: provider ? [provider] : undefined,
  });

  const resources = useMemo(() => {
    if (!data) return null;

    const [res, pricing, maxConcurrent, activeRentals, sshEnabled, dockerEnabled] = data;

    return {
      resources: {
        gpuType: res.gpuType as GPUType,
        gpuCount: res.gpuCount,
        gpuVram: res.gpuVram,
        cpuCores: res.cpuCores,
        memory: res.memory,
        storage: res.storage,
        bandwidth: res.bandwidth,
        teeCapable: res.teeCapable,
      },
      pricing: {
        pricePerHour: pricing.pricePerHour,
        pricePerGpuHour: pricing.pricePerGpuHour,
        minimumRentalHours: Number(pricing.minimumRentalHours),
        maximumRentalHours: Number(pricing.maximumRentalHours),
      },
      maxConcurrent: Number(maxConcurrent),
      activeRentals: Number(activeRentals),
      sshEnabled,
      dockerEnabled,
    } as ProviderResources;
  }, [data]);

  return { resources, refetch, isLoading };
}

export function useUserRentals() {
  const { address } = useAccount();

  const { data: rentalIds, refetch: refetchIds } = useReadContract({
    address: COMPUTE_RENTAL_ADDRESS,
    abi: COMPUTE_RENTAL_ABI,
    functionName: 'getUserRentals',
    args: address ? [address] : undefined,
  });

  return {
    rentalIds: (rentalIds || []) as `0x${string}`[],
    refetchIds,
  };
}

export function useRental(rentalId: `0x${string}` | undefined) {
  const { data, refetch, isLoading } = useReadContract({
    address: COMPUTE_RENTAL_ADDRESS,
    abi: COMPUTE_RENTAL_ABI,
    functionName: 'getRental',
    args: rentalId ? [rentalId] : undefined,
  });

  return {
    rental: data as Rental | undefined,
    refetch,
    isLoading,
  };
}

export function useRentalCost(provider: `0x${string}` | undefined, durationHours: number) {
  const { data, isLoading } = useReadContract({
    address: COMPUTE_RENTAL_ADDRESS,
    abi: COMPUTE_RENTAL_ABI,
    functionName: 'calculateRentalCost',
    args: provider && durationHours > 0 ? [provider, BigInt(durationHours)] : undefined,
  });

  return {
    cost: data as bigint | undefined,
    costFormatted: data ? formatEther(data) : '0',
    isLoading,
  };
}

export function useCreateRental() {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const createRental = (
    provider: `0x${string}`,
    durationHours: number,
    sshPublicKey: string,
    containerImage: string,
    startupScript: string,
    cost: bigint
  ) => {
    writeContract({
      address: COMPUTE_RENTAL_ADDRESS,
      abi: COMPUTE_RENTAL_ABI,
      functionName: 'createRental',
      args: [provider, BigInt(durationHours), sshPublicKey, containerImage, startupScript],
      value: cost,
    });
  };

  return {
    createRental,
    isCreating: isPending || isConfirming,
    isSuccess,
    hash,
  };
}

export function useExtendRental() {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const extendRental = (rentalId: `0x${string}`, additionalHours: number, cost: bigint) => {
    writeContract({
      address: COMPUTE_RENTAL_ADDRESS,
      abi: COMPUTE_RENTAL_ABI,
      functionName: 'extendRental',
      args: [rentalId, BigInt(additionalHours)],
      value: cost,
    });
  };

  return {
    extendRental,
    isExtending: isPending || isConfirming,
    isSuccess,
  };
}

export function useCancelRental() {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const cancelRental = (rentalId: `0x${string}`) => {
    writeContract({
      address: COMPUTE_RENTAL_ADDRESS,
      abi: COMPUTE_RENTAL_ABI,
      functionName: 'cancelRental',
      args: [rentalId],
    });
  };

  return {
    cancelRental,
    isCancelling: isPending || isConfirming,
    isSuccess,
  };
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export function formatHourlyRate(weiPerHour: bigint): string {
  const ethPerHour = Number(formatEther(weiPerHour));
  return `${ethPerHour.toFixed(4)} ETH/hr`;
}

