/**
 * Token Registry Contract Hook
 * Consolidated from gateway and bazaar
 */

import { useCallback, useMemo } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { Address } from 'viem';
import { TOKEN_REGISTRY_ABI } from '../contracts';

export interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

export interface TokenConfig {
  tokenAddress: Address;
  name: string;
  symbol: string;
  decimals: number;
  oracleAddress: Address;
  minFeeMargin: bigint;
  maxFeeMargin: bigint;
  isActive: boolean;
  registrant: Address;
  registrationTime: bigint;
  totalVolume: bigint;
  totalTransactions: bigint;
  metadataHash: `0x${string}`;
}

// Known tokens for fallback
const KNOWN_TOKENS: Record<string, TokenInfo> = {
  '0x0000000000000000000000000000000000000000': {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
  },
};

export function useTokenRegistry(registryAddress: Address | undefined) {
  // Read all tokens
  const { data: allTokens, refetch: refetchTokens } = useReadContract({
    address: registryAddress,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'getAllTokens',
  });

  // Read registration fee
  const { data: registrationFee } = useReadContract({
    address: registryAddress,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'registrationFee',
  });

  // Write: Register token
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const registerToken = useCallback(async (
    tokenAddress: Address,
    oracleAddress: Address,
    minFee: number,
    maxFee: number
  ) => {
    if (!registryAddress || !registrationFee) {
      throw new Error('Registry not configured or registration fee not loaded');
    }
    writeContract({
      address: registryAddress,
      abi: TOKEN_REGISTRY_ABI,
      functionName: 'registerToken',
      args: [tokenAddress, oracleAddress, BigInt(minFee), BigInt(maxFee)],
      value: registrationFee,
    });
  }, [registryAddress, registrationFee, writeContract]);

  // Local token lookup for known tokens
  const getTokenInfo = useCallback((address: string): TokenInfo | undefined => {
    const normalizedAddress = address.toLowerCase();
    return KNOWN_TOKENS[normalizedAddress];
  }, []);

  const tokens = useMemo(() => Object.values(KNOWN_TOKENS), []);

  return {
    allTokens: allTokens ? (allTokens as Address[]) : [],
    registrationFee,
    registerToken,
    isPending: isPending || isConfirming,
    isSuccess,
    refetchTokens,
    getTokenInfo,
    tokens,
  };
}

export function useTokenConfig(registryAddress: Address | undefined, tokenAddress: Address | undefined) {
  const { data: config, refetch } = useReadContract({
    address: registryAddress,
    abi: TOKEN_REGISTRY_ABI,
    functionName: 'getTokenConfig',
    args: tokenAddress ? [tokenAddress] : undefined,
  });

  return {
    config: config as TokenConfig | undefined,
    refetch,
  };
}
