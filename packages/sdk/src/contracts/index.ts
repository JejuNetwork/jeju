/**
 * Contract ABIs and utilities
 */

import {
  type Address,
  type Abi,
  getContract as viemGetContract,
  type GetContractReturnType,
  type PublicClient,
  type WalletClient,
} from 'viem';

// Import ABIs from @jeju/contracts
import BanManagerABI from './abis/BanManager.json';
import IdentityRegistryABI from './abis/IdentityRegistry.json';
import TokenRegistryABI from './abis/TokenRegistry.json';
import JNSRegistryABI from './abis/JNSRegistry.json';
import JNSResolverABI from './abis/JNSResolver.json';
import PaymasterFactoryABI from './abis/PaymasterFactory.json';
import LiquidityVaultABI from './abis/LiquidityVault.json';
import SolverRegistryABI from './abis/SolverRegistry.json';
import InputSettlerABI from './abis/InputSettler.json';
import OutputSettlerABI from './abis/OutputSettler.json';
import ERC20ABI from './abis/ERC20.json';

export const ABIS = {
  BanManager: BanManagerABI as Abi,
  IdentityRegistry: IdentityRegistryABI as Abi,
  TokenRegistry: TokenRegistryABI as Abi,
  JNSRegistry: JNSRegistryABI as Abi,
  JNSResolver: JNSResolverABI as Abi,
  PaymasterFactory: PaymasterFactoryABI as Abi,
  LiquidityVault: LiquidityVaultABI as Abi,
  SolverRegistry: SolverRegistryABI as Abi,
  InputSettler: InputSettlerABI as Abi,
  OutputSettler: OutputSettlerABI as Abi,
  ERC20: ERC20ABI as Abi,
} as const;

export type ContractName = keyof typeof ABIS;

export function createContract<TAbi extends Abi>(
  address: Address,
  abi: TAbi,
  client: { public: PublicClient; wallet?: WalletClient }
): GetContractReturnType<TAbi, typeof client.public, typeof client.wallet> {
  return viemGetContract({
    address,
    abi,
    client: {
      public: client.public,
      wallet: client.wallet,
    },
  }) as GetContractReturnType<TAbi, typeof client.public, typeof client.wallet>;
}

// Compute contract ABIs (inline for simplicity)
export const COMPUTE_REGISTRY_ABI = [
  {
    name: 'getAllProviders',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getProvider',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'endpoint', type: 'string' },
          { name: 'stake', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'isActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

export const COMPUTE_RENTAL_ABI = [
  {
    name: 'getProviderResources',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          {
            name: 'resources',
            type: 'tuple',
            components: [
              { name: 'cpuCores', type: 'uint256' },
              { name: 'memoryGb', type: 'uint256' },
              { name: 'storageGb', type: 'uint256' },
              { name: 'bandwidthMbps', type: 'uint256' },
              { name: 'gpuType', type: 'uint8' },
              { name: 'gpuCount', type: 'uint256' },
              { name: 'gpuMemoryGb', type: 'uint256' },
              { name: 'teeSupported', type: 'bool' },
            ],
          },
          {
            name: 'pricing',
            type: 'tuple',
            components: [
              { name: 'pricePerHour', type: 'uint256' },
              { name: 'minimumRentalHours', type: 'uint256' },
              { name: 'maximumRentalHours', type: 'uint256' },
              { name: 'depositRequired', type: 'uint256' },
            ],
          },
          { name: 'activeRentals', type: 'uint256' },
          { name: 'maxConcurrentRentals', type: 'uint256' },
          { name: 'available', type: 'bool' },
          { name: 'sshEnabled', type: 'bool' },
          { name: 'dockerEnabled', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'calculateRentalCost',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'durationHours', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
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
    outputs: [{ type: 'bytes32' }],
  },
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
    name: 'getUserRentals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'cancelRental',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'rentalId', type: 'bytes32' }],
    outputs: [],
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
] as const;

export const INFERENCE_ABI = [
  {
    name: 'getServices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'provider', type: 'address' },
          { name: 'model', type: 'string' },
          { name: 'endpoint', type: 'string' },
          { name: 'pricePerInputToken', type: 'uint256' },
          { name: 'pricePerOutputToken', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
] as const;

export const TRIGGER_REGISTRY_ABI = [
  {
    name: 'getTrigger',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'triggerId', type: 'bytes32' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'triggerType', type: 'uint8' },
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'active', type: 'bool' },
      { name: 'executionCount', type: 'uint256' },
      { name: 'lastExecutedAt', type: 'uint256' },
      { name: 'agentId', type: 'uint256' },
    ],
  },
  {
    name: 'registerTrigger',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'triggerType', type: 'uint8' },
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'cronExpression', type: 'string' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'getOwnerTriggers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
  },
  {
    name: 'prepaidBalances',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

