import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { type Address, type Hash, namehash } from 'viem';

// Contract addresses (loaded from environment or deployment)
const JNS_REGISTRY = import.meta.env.VITE_JNS_REGISTRY as Address || '0x0000000000000000000000000000000000000000';
const JNS_RESOLVER = import.meta.env.VITE_JNS_RESOLVER as Address || '0x0000000000000000000000000000000000000000';
const JNS_REGISTRAR = import.meta.env.VITE_JNS_REGISTRAR as Address || '0x0000000000000000000000000000000000000000';
const JNS_REVERSE_REGISTRAR = import.meta.env.VITE_JNS_REVERSE_REGISTRAR as Address || '0x0000000000000000000000000000000000000000';

// Contract ABIs
const JNS_REGISTRAR_ABI = [
  {
    name: 'available',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'rentPrice',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'rentPriceWithDiscount',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
      { name: 'agentOwner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'register',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'node', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'renew',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'nameExpires',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'inGracePeriod',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

const JNS_RESOLVER_ABI = [
  {
    name: 'addr',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'setAddr',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'addr_', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'text',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'setText',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'contenthash',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    name: 'setContenthash',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAppInfo',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [
      { name: 'appContract', type: 'address' },
      { name: 'appId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'endpoint', type: 'string' },
      { name: 'a2aEndpoint', type: 'string' },
      { name: 'contenthash_', type: 'bytes' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'setAppConfig',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'appContract', type: 'address' },
      { name: 'appId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'endpoint', type: 'string' },
      { name: 'a2aEndpoint', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'name',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const;

const JNS_REVERSE_REGISTRAR_ABI = [
  {
    name: 'claimWithName',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: 'node', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setName',
    type: 'function',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: 'node', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'nameOf',
    type: 'function',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const;

export interface JNSRegistration {
  name: string;
  owner: Address;
  expiresAt: number;
  inGracePeriod: boolean;
  isAvailable: boolean;
}

export interface JNSPriceQuote {
  name: string;
  duration: number;
  price: bigint;
  priceWithDiscount: bigint;
  hasDiscount: boolean;
}

export interface JNSAppInfo {
  appContract: Address;
  appId: string;
  agentId: bigint;
  endpoint: string;
  a2aEndpoint: string;
  contenthash: `0x${string}`;
}

export interface JNSResolverData {
  address: Address;
  texts: Record<string, string>;
  appInfo: JNSAppInfo;
}

export function useJNSLookup() {
  const publicClient = usePublicClient();
  const { address } = useAccount();

  const checkAvailability = useCallback(async (name: string): Promise<boolean> => {
    if (!publicClient || JNS_REGISTRAR === '0x0000000000000000000000000000000000000000') {
      return false;
    }

    const result = await publicClient.readContract({
      address: JNS_REGISTRAR,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'available',
      args: [name],
    });

    return result;
  }, [publicClient]);

  const getPrice = useCallback(async (name: string, durationYears: number = 1): Promise<JNSPriceQuote> => {
    if (!publicClient || JNS_REGISTRAR === '0x0000000000000000000000000000000000000000') {
      throw new Error('JNS not configured');
    }

    const duration = BigInt(durationYears * 365 * 24 * 60 * 60);

    const [price, priceWithDiscount] = await Promise.all([
      publicClient.readContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'rentPrice',
        args: [name, duration],
      }),
      address
        ? publicClient.readContract({
            address: JNS_REGISTRAR,
            abi: JNS_REGISTRAR_ABI,
            functionName: 'rentPriceWithDiscount',
            args: [name, duration, address],
          })
        : Promise.resolve(0n),
    ]);

    return {
      name,
      duration: durationYears,
      price,
      priceWithDiscount,
      hasDiscount: priceWithDiscount < price,
    };
  }, [publicClient, address]);

  const getRegistration = useCallback(async (name: string): Promise<JNSRegistration> => {
    if (!publicClient || JNS_REGISTRAR === '0x0000000000000000000000000000000000000000') {
      throw new Error('JNS not configured');
    }

    const [isAvailable, owner, expires, inGracePeriod] = await Promise.all([
      publicClient.readContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'available',
        args: [name],
      }),
      publicClient.readContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'ownerOf',
        args: [name],
      }),
      publicClient.readContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'nameExpires',
        args: [name],
      }),
      publicClient.readContract({
        address: JNS_REGISTRAR,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'inGracePeriod',
        args: [name],
      }),
    ]);

    return {
      name,
      owner,
      expiresAt: Number(expires),
      inGracePeriod,
      isAvailable,
    };
  }, [publicClient]);

  const getOwnerNames = useCallback(async (ownerAddress: Address): Promise<JNSRegistration[]> => {
    if (JNS_REGISTRAR === '0x0000000000000000000000000000000000000000') {
      return [];
    }

    const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || 'http://localhost:4350/graphql';
    const query = `
      query OwnerNames($owner: String!) {
        jnsNames(where: { owner_eq: $owner }) {
          name
          owner
          expiresAt
        }
      }
    `;

    const response = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner: ownerAddress.toLowerCase() } }),
    });

    if (!response.ok) {
      return [];
    }

    const { data } = await response.json();
    const names = data?.jnsNames || [];

    return names.map((n: { name: string; owner: string; expiresAt: string }) => ({
      name: n.name,
      owner: n.owner as Address,
      expiresAt: parseInt(n.expiresAt),
      inGracePeriod: false,
      isAvailable: false,
    }));
  }, []);

  return {
    checkAvailability,
    getPrice,
    getRegistration,
    getOwnerNames,
  };
}

export function useJNSRegister() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async (
    name: string,
    durationYears: number = 1,
    owner?: Address
  ): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }
    if (JNS_REGISTRAR === '0x0000000000000000000000000000000000000000') {
      throw new Error('JNS not configured');
    }

    setLoading(true);
    setError(null);

    const duration = BigInt(durationYears * 365 * 24 * 60 * 60);
    const ownerAddress = owner || address;

    // Get price
    const price = await publicClient?.readContract({
      address: JNS_REGISTRAR,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'rentPriceWithDiscount',
      args: [name, duration, address],
    });

    const hash = await walletClient.writeContract({
      address: JNS_REGISTRAR,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'register',
      args: [name, ownerAddress, duration],
      value: price,
    });

    setLoading(false);
    return hash;
  }, [walletClient, address, publicClient]);

  const renew = useCallback(async (
    name: string,
    durationYears: number = 1
  ): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }
    if (JNS_REGISTRAR === '0x0000000000000000000000000000000000000000') {
      throw new Error('JNS not configured');
    }

    setLoading(true);
    setError(null);

    const duration = BigInt(durationYears * 365 * 24 * 60 * 60);

    // Get price
    const price = await publicClient?.readContract({
      address: JNS_REGISTRAR,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'rentPrice',
      args: [name, duration],
    });

    const hash = await walletClient.writeContract({
      address: JNS_REGISTRAR,
      abi: JNS_REGISTRAR_ABI,
      functionName: 'renew',
      args: [name, duration],
      value: price,
    });

    setLoading(false);
    return hash;
  }, [walletClient, address, publicClient]);

  return {
    register,
    renew,
    loading,
    error,
  };
}

export function useJNSResolver() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const resolve = useCallback(async (name: string): Promise<Address | null> => {
    if (!publicClient || JNS_RESOLVER === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`;
    const node = namehash(fullName) as `0x${string}`;

    const addr = await publicClient.readContract({
      address: JNS_RESOLVER,
      abi: JNS_RESOLVER_ABI,
      functionName: 'addr',
      args: [node],
    });

    return addr === '0x0000000000000000000000000000000000000000' ? null : addr;
  }, [publicClient]);

  const getText = useCallback(async (name: string, key: string): Promise<string> => {
    if (!publicClient || JNS_RESOLVER === '0x0000000000000000000000000000000000000000') {
      return '';
    }

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`;
    const node = namehash(fullName) as `0x${string}`;

    return await publicClient.readContract({
      address: JNS_RESOLVER,
      abi: JNS_RESOLVER_ABI,
      functionName: 'text',
      args: [node, key],
    });
  }, [publicClient]);

  const getAppInfo = useCallback(async (name: string): Promise<JNSAppInfo | null> => {
    if (!publicClient || JNS_RESOLVER === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`;
    const node = namehash(fullName) as `0x${string}`;

    const result = await publicClient.readContract({
      address: JNS_RESOLVER,
      abi: JNS_RESOLVER_ABI,
      functionName: 'getAppInfo',
      args: [node],
    });

    return {
      appContract: result[0],
      appId: result[1],
      agentId: result[2],
      endpoint: result[3],
      a2aEndpoint: result[4],
      contenthash: result[5],
    };
  }, [publicClient]);

  const setAddr = useCallback(async (name: string, addr: Address): Promise<Hash> => {
    if (!walletClient) {
      throw new Error('Wallet not connected');
    }

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`;
    const node = namehash(fullName) as `0x${string}`;

    return await walletClient.writeContract({
      address: JNS_RESOLVER,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setAddr',
      args: [node, addr],
    });
  }, [walletClient]);

  const setText = useCallback(async (name: string, key: string, value: string): Promise<Hash> => {
    if (!walletClient) {
      throw new Error('Wallet not connected');
    }

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`;
    const node = namehash(fullName) as `0x${string}`;

    return await walletClient.writeContract({
      address: JNS_RESOLVER,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, key, value],
    });
  }, [walletClient]);

  return {
    resolve,
    getText,
    getAppInfo,
    setAddr,
    setText,
  };
}

export function useJNSReverse() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const reverseLookup = useCallback(async (addr: Address): Promise<string | null> => {
    if (!publicClient || JNS_REVERSE_REGISTRAR === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    const name = await publicClient.readContract({
      address: JNS_REVERSE_REGISTRAR,
      abi: JNS_REVERSE_REGISTRAR_ABI,
      functionName: 'nameOf',
      args: [addr],
    });

    return name || null;
  }, [publicClient]);

  const setPrimaryName = useCallback(async (name: string): Promise<Hash> => {
    if (!walletClient) {
      throw new Error('Wallet not connected');
    }

    const fullName = name.endsWith('.jeju') ? name : `${name}.jeju`;

    return await walletClient.writeContract({
      address: JNS_REVERSE_REGISTRAR,
      abi: JNS_REVERSE_REGISTRAR_ABI,
      functionName: 'setName',
      args: [fullName],
    });
  }, [walletClient]);

  const getPrimaryName = useCallback(async (addr: Address): Promise<string | null> => {
    return reverseLookup(addr);
  }, [reverseLookup]);

  return {
    reverseLookup,
    setPrimaryName,
    getPrimaryName,
  };
}

// Export contract addresses for other components
export const JNS_ADDRESSES = {
  registry: JNS_REGISTRY,
  resolver: JNS_RESOLVER,
  registrar: JNS_REGISTRAR,
  reverseRegistrar: JNS_REVERSE_REGISTRAR,
};

