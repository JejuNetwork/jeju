/**
 * EIL Hooks for Gateway
 * Re-exports shared implementation with Gateway-specific config
 * 
 * Gateway shows:
 * - XLP staking dashboard
 * - All EIL liquidity
 * - Paymaster liquidity
 * - Staking rewards
 */

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { useState, useCallback, useEffect } from 'react';
import { parseEther, type Address } from 'viem';

// Re-export shared types and utilities
export {
  type ChainInfo,
  type CrossChainSwapParams,
  type XLPPosition,
  type EILStats,
  type SwapStatus,
  type StakeStatus,
  SUPPORTED_CHAINS,
  CROSS_CHAIN_PAYMASTER_ABI,
  L1_STAKE_MANAGER_ABI,
  calculateSwapFee,
  estimateSwapTime,
  formatSwapRoute,
  formatXLPPosition,
  getChainById,
  isCrossChainSwap,
  validateSwapParams,
  buildSwapTransaction,
  buildXLPStakeTransaction,
  buildLiquidityDepositTransaction,
} from '../../../../scripts/shared/eil-hooks';

// Import for local use
import {
  SUPPORTED_CHAINS,
  CROSS_CHAIN_PAYMASTER_ABI,
  L1_STAKE_MANAGER_ABI,
  type CrossChainSwapParams,
  type XLPPosition,
  type SwapStatus,
  type StakeStatus,
} from '../../../../scripts/shared/eil-hooks';

// Load config from JSON
import eilConfig from '@jejunetwork/config/eil';

// ============ Type Definitions ============

type EILChainConfig = {
  name: string;
  crossChainPaymaster: string;
  status: string;
  oif?: Record<string, string>;
  tokens?: Record<string, string>;
};

type EILNetworkConfig = {
  hub: { chainId: number; name: string; l1StakeManager: string; status: string };
  chains: Record<string, EILChainConfig>;
};

type EILConfig = {
  version: string;
  lastUpdated: string;
  entryPoint: string;
  l2Messenger: string;
  supportedTokens: string[];
  testnet: EILNetworkConfig;
  mainnet: EILNetworkConfig;
  localnet: EILNetworkConfig;
};

// Helper to get chain config based on current network
function getNetworkConfig(): EILNetworkConfig {
  const network = import.meta.env.VITE_NETWORK || 'localnet';
  const config = eilConfig as EILConfig;
  if (network === 'testnet') return config.testnet;
  if (network === 'mainnet') return config.mainnet;
  return config.localnet;
}

// ============ EIL Config Hook ============

export function useEILConfig() {
  const { chain } = useAccount();
  const chainId = chain?.id?.toString() || '420691';
  
  const networkConfig = getNetworkConfig();
  const chainConfig = networkConfig.chains[chainId];
  const paymasterAddress = chainConfig?.crossChainPaymaster;
  const crossChainPaymaster = (paymasterAddress && paymasterAddress.length > 0 ? paymasterAddress : undefined) as Address | undefined;
  const isAvailable = crossChainPaymaster && crossChainPaymaster !== '0x0000000000000000000000000000000000000000';
  
  const configuredChains = SUPPORTED_CHAINS.map(supportedChain => {
    const config = networkConfig.chains[supportedChain.id.toString()];
    const addr = config?.crossChainPaymaster;
    return {
      ...supportedChain,
      paymasterAddress: (addr && addr.length > 0 ? addr : undefined) as Address | undefined
    };
  });

  return {
    isAvailable: Boolean(isAvailable),
    crossChainPaymaster: isAvailable ? crossChainPaymaster : undefined,
    supportedChains: configuredChains,
    l1StakeManager: (networkConfig.hub.l1StakeManager || undefined) as Address | undefined,
    supportedTokens: (eilConfig as EILConfig).supportedTokens as Address[],
  };
}

// ============ Cross-Chain Swap Hook ============

export function useCrossChainSwap(paymasterAddress: Address | undefined) {
  const { address: userAddress } = useAccount();
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isPending) setSwapStatus('creating');
    else if (isConfirming) setSwapStatus('waiting');
    else if (isSuccess) setSwapStatus('complete');
  }, [isPending, isConfirming, isSuccess]);

  const executeCrossChainSwap = useCallback(async (params: CrossChainSwapParams) => {
    if (!paymasterAddress || !userAddress) {
      setError('Wallet not connected or EIL not configured');
      return;
    }

    setSwapStatus('creating');
    setError(null);

    const maxFee = parseEther('0.01');
    const feeIncrement = parseEther('0.0001');
    const gasOnDestination = parseEther('0.001');

    const isETH = params.sourceToken === '0x0000000000000000000000000000000000000000';
    const txValue = isETH ? params.amount + maxFee : maxFee;

    writeContract({
      address: paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'createVoucherRequest',
      args: [
        params.sourceToken,
        params.amount,
        params.destinationToken,
        BigInt(params.destinationChainId),
        params.recipient || userAddress,
        gasOnDestination,
        maxFee,
        feeIncrement
      ],
      value: txValue
    });
  }, [paymasterAddress, userAddress, writeContract]);

  const reset = useCallback(() => {
    setSwapStatus('idle');
    setError(null);
  }, []);

  return {
    executeCrossChainSwap,
    swapStatus,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash,
    reset
  };
}

// ============ XLP Position Hook ============

export function useXLPPosition(stakeManagerAddress: Address | undefined) {
  const { address } = useAccount();
  const [position, setPosition] = useState<XLPPosition | null>(null);
  
  const { data: stakeData } = useReadContract({
    address: stakeManagerAddress,
    abi: L1_STAKE_MANAGER_ABI,
    functionName: 'getXLPStake',
    args: address ? [address] : undefined,
  });
  
  const { data: chainsData } = useReadContract({
    address: stakeManagerAddress,
    abi: L1_STAKE_MANAGER_ABI,
    functionName: 'getXLPChains',
    args: address ? [address] : undefined,
  });

  useEffect(() => {
    if (stakeData && chainsData) {
      const [stakedAmount, unbondingAmount, unbondingStartTime, slashedAmount, isActive, registeredAt] = stakeData as [bigint, bigint, bigint, bigint, boolean, bigint];
      const chains = (chainsData as bigint[]).map(c => Number(c));
      
      setPosition({
        stakedAmount,
        unbondingAmount,
        unbondingStartTime: Number(unbondingStartTime),
        slashedAmount,
        isActive,
        registeredAt: Number(registeredAt),
        supportedChains: chains,
        tokenLiquidity: new Map(),
        ethBalance: 0n,
        pendingFees: 0n,
        totalEarnings: 0n,
      });
    }
  }, [stakeData, chainsData]);

  return { position };
}

// ============ XLP Registration Hook ============

export function useXLPRegistration(stakeManagerAddress: Address | undefined) {
  const [status, setStatus] = useState<StakeStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isPending) setStatus('pending');
    else if (isSuccess) setStatus('complete');
  }, [isPending, isSuccess]);

  const register = useCallback(async (chains: number[], stakeAmount: bigint) => {
    if (!stakeManagerAddress) {
      setError('Stake manager not configured');
      return;
    }

    setStatus('pending');
    setError(null);

    writeContract({
      address: stakeManagerAddress,
      abi: L1_STAKE_MANAGER_ABI,
      functionName: 'register',
      args: [chains.map(c => BigInt(c))],
      value: stakeAmount
    });
  }, [stakeManagerAddress, writeContract]);

  const addStake = useCallback(async (amount: bigint) => {
    if (!stakeManagerAddress) {
      setError('Stake manager not configured');
      return;
    }

    writeContract({
      address: stakeManagerAddress,
      abi: L1_STAKE_MANAGER_ABI,
      functionName: 'addStake',
      args: [],
      value: amount
    });
  }, [stakeManagerAddress, writeContract]);

  const startUnbonding = useCallback(async (amount: bigint) => {
    if (!stakeManagerAddress) {
      setError('Stake manager not configured');
      return;
    }

    writeContract({
      address: stakeManagerAddress,
      abi: L1_STAKE_MANAGER_ABI,
      functionName: 'startUnbonding',
      args: [amount]
    });
  }, [stakeManagerAddress, writeContract]);

  return {
    register,
    addStake,
    startUnbonding,
    status,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash
  };
}

// ============ XLP Liquidity Hook ============

export function useXLPLiquidity(paymasterAddress: Address | undefined) {
  const { address } = useAccount();
  const [status, setStatus] = useState<StakeStatus>('idle');

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: ethBalance } = useReadContract({
    address: paymasterAddress,
    abi: CROSS_CHAIN_PAYMASTER_ABI,
    functionName: 'getXLPETH',
    args: address ? [address] : undefined,
  });

  useEffect(() => {
    if (isPending) setStatus('pending');
    else if (isSuccess) setStatus('complete');
  }, [isPending, isSuccess]);

  const depositETH = useCallback(async (amount: bigint) => {
    if (!paymasterAddress) return;

    writeContract({
      address: paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'depositETH',
      args: [],
      value: amount
    });
  }, [paymasterAddress, writeContract]);

  const withdrawETH = useCallback(async (amount: bigint) => {
    if (!paymasterAddress) return;

    writeContract({
      address: paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'withdrawETH',
      args: [amount]
    });
  }, [paymasterAddress, writeContract]);

  const depositToken = useCallback(async (token: Address, amount: bigint) => {
    if (!paymasterAddress) return;

    writeContract({
      address: paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'depositLiquidity',
      args: [token, amount]
    });
  }, [paymasterAddress, writeContract]);

  const withdrawToken = useCallback(async (token: Address, amount: bigint) => {
    if (!paymasterAddress) return;

    writeContract({
      address: paymasterAddress,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'withdrawLiquidity',
      args: [token, amount]
    });
  }, [paymasterAddress, writeContract]);

  return {
    ethBalance: ethBalance as bigint | undefined,
    depositETH,
    withdrawETH,
    depositToken,
    withdrawToken,
    status,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash
  };
}

// ============ Fee Estimate Hook ============

export function useSwapFeeEstimate(
  sourceChainId: number,
  destinationChainId: number,
  amount: bigint
) {
  const [estimate, setEstimate] = useState({
    networkFee: parseEther('0.001'),
    xlpFee: parseEther('0.0005'),
    totalFee: parseEther('0.0015'),
    estimatedTime: 10,
    isLoading: false
  });

  useEffect(() => {
    const xlpFee = amount * 5n / 10000n;
    const networkFee = parseEther('0.001');
    const crossChainPremium = sourceChainId !== destinationChainId ? parseEther('0.0005') : 0n;
    
    setEstimate({
      networkFee: networkFee + crossChainPremium,
      xlpFee,
      totalFee: networkFee + crossChainPremium + xlpFee,
      estimatedTime: sourceChainId === destinationChainId ? 0 : 10,
      isLoading: false
    });
  }, [sourceChainId, destinationChainId, amount]);

  return estimate;
}
