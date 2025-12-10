import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { parseEther, type Address } from 'viem';
import { NETWORK } from '../config';

// Re-export shared types and utilities
export {
  type ChainInfo,
  type CrossChainSwapParams,
  type XLPPosition,
  type EILStats,
  type SwapStatus,
  type StakeStatus,
  type AppPreference,
  type GasPaymentOption,
  SUPPORTED_CHAINS,
  CROSS_CHAIN_PAYMASTER_ABI,
  L1_STAKE_MANAGER_ABI,
  APP_TOKEN_PREFERENCE_ABI,
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
  buildTokenPaymentData,
  buildAppAwarePaymentData,
  getBestGasTokenForApp,
  selectBestGasToken,
  formatGasPaymentOption,
} from '../../../../scripts/shared/eil-hooks';

// Import for local use
import {
  SUPPORTED_CHAINS,
  CROSS_CHAIN_PAYMASTER_ABI,
  L1_STAKE_MANAGER_ABI,
  APP_TOKEN_PREFERENCE_ABI,
  type CrossChainSwapParams,
  type XLPPosition,
  type SwapStatus,
  type StakeStatus,
  type AppPreference,
} from '../../../../scripts/shared/eil-hooks';

// Load config from JSON
import eilConfig from '@jejunetwork/config/eil';

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
  const config = eilConfig as EILConfig;
  if (NETWORK === 'testnet') return config.testnet;
  if (NETWORK === 'mainnet') return config.mainnet;
  return config.localnet;
}

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

  // Get appTokenPreference address from chain config if available
  const appTokenPreferenceAddr = chainConfig?.tokens?.['appTokenPreference'] as Address | undefined;

  return {
    isAvailable: Boolean(isAvailable),
    crossChainPaymaster: isAvailable ? crossChainPaymaster : undefined,
    appTokenPreference: appTokenPreferenceAddr || undefined,
    supportedChains: configuredChains,
    l1StakeManager: (networkConfig.hub.l1StakeManager || undefined) as Address | undefined,
    supportedTokens: (eilConfig as EILConfig).supportedTokens as Address[],
  };
}

export function useCrossChainSwap(paymasterAddress: Address | undefined) {
  const { address: userAddress } = useAccount();
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (writeError) {
      setSwapStatus('idle');
      setError(writeError.message);
    } else if (isPending) setSwapStatus('creating');
    else if (isConfirming) setSwapStatus('waiting');
    else if (isSuccess) setSwapStatus('complete');
  }, [isPending, isConfirming, isSuccess, writeError]);

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

export function useXLPPosition(stakeManagerAddress: Address | undefined) {
  const { address } = useAccount();
  
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

  const position = useMemo<XLPPosition | null>(() => {
    if (!stakeData || !chainsData) return null;
    
    const [stakedAmount, unbondingAmount, unbondingStartTime, slashedAmount, isActive, registeredAt] = stakeData as [bigint, bigint, bigint, bigint, boolean, bigint];
    const chains = (chainsData as bigint[]).map(c => Number(c));
    
    return {
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
    };
  }, [stakeData, chainsData]);

  return { position };
}

export function useXLPRegistration(stakeManagerAddress: Address | undefined) {
  const [status, setStatus] = useState<StakeStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (writeError) {
      setStatus('idle');
      setError(writeError.message);
    } else if (isPending) setStatus('pending');
    else if (isSuccess) setStatus('complete');
  }, [isPending, isSuccess, writeError]);

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

  const completeUnbonding = useCallback(async () => {
    if (!stakeManagerAddress) {
      setError('Stake manager not configured');
      return;
    }

    writeContract({
      address: stakeManagerAddress,
      abi: L1_STAKE_MANAGER_ABI,
      functionName: 'completeUnbonding',
      args: []
    });
  }, [stakeManagerAddress, writeContract]);

  return {
    register,
    addStake,
    startUnbonding,
    completeUnbonding,
    status,
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash
  };
}

export function useXLPLiquidity(paymasterAddress: Address | undefined) {
  const { address } = useAccount();
  const [status, setStatus] = useState<StakeStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: ethBalance } = useReadContract({
    address: paymasterAddress,
    abi: CROSS_CHAIN_PAYMASTER_ABI,
    functionName: 'getXLPETH',
    args: address ? [address] : undefined,
  });

  useEffect(() => {
    if (writeError) {
      setStatus('idle');
      setError(writeError.message);
    } else if (isPending) setStatus('pending');
    else if (isSuccess) setStatus('complete');
  }, [isPending, isSuccess, writeError]);

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
    error,
    isLoading: isPending || isConfirming,
    isSuccess,
    hash
  };
}

export function useAppTokenPreference(preferenceAddress: Address | undefined) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const registerApp = useCallback(async (
    appAddress: Address,
    preferredToken: Address,
    allowFallback: boolean,
    minBalance: bigint
  ) => {
    if (!preferenceAddress) return;
    
    writeContract({
      address: preferenceAddress,
      abi: APP_TOKEN_PREFERENCE_ABI,
      functionName: 'registerApp',
      args: [appAddress, preferredToken, allowFallback, minBalance],
    });
  }, [preferenceAddress, writeContract]);

  const updatePreferredToken = useCallback(async (
    appAddress: Address,
    newPreferredToken: Address
  ) => {
    if (!preferenceAddress) return;
    
    writeContract({
      address: preferenceAddress,
      abi: APP_TOKEN_PREFERENCE_ABI,
      functionName: 'updatePreferredToken',
      args: [appAddress, newPreferredToken],
    });
  }, [preferenceAddress, writeContract]);

  const setFallbackTokens = useCallback(async (
    appAddress: Address,
    tokens: Address[]
  ) => {
    if (!preferenceAddress) return;
    
    writeContract({
      address: preferenceAddress,
      abi: APP_TOKEN_PREFERENCE_ABI,
      functionName: 'setFallbackTokens',
      args: [appAddress, tokens],
    });
  }, [preferenceAddress, writeContract]);

  return {
    registerApp,
    updatePreferredToken,
    setFallbackTokens,
    isLoading: isPending || isConfirming,
    isSuccess,
    error: error?.message ?? null,
    hash,
  };
}

export function useAppPreference(preferenceAddress: Address | undefined, appAddress: Address | undefined) {
  const { data: preferenceData } = useReadContract({
    address: preferenceAddress,
    abi: APP_TOKEN_PREFERENCE_ABI,
    functionName: 'getAppPreference',
    args: appAddress ? [appAddress] : undefined,
  });

  const { data: fallbackTokens } = useReadContract({
    address: preferenceAddress,
    abi: APP_TOKEN_PREFERENCE_ABI,
    functionName: 'getAppFallbackTokens',
    args: appAddress ? [appAddress] : undefined,
  });

  const preference: AppPreference | null = preferenceData ? {
    appAddress: preferenceData[0] as Address,
    preferredToken: preferenceData[1] as Address,
    tokenSymbol: preferenceData[2] as string,
    tokenDecimals: preferenceData[3] as number,
    allowFallback: preferenceData[4] as boolean,
    minBalance: preferenceData[5] as bigint,
    isActive: preferenceData[6] as boolean,
    registrant: preferenceData[7] as Address,
    registrationTime: preferenceData[8] as bigint,
  } : null;

  return {
    preference,
    fallbackTokens: (fallbackTokens || []) as Address[],
  };
}

export function useBestGasToken(
  paymasterAddress: Address | undefined,
  appAddress: Address | undefined,
  user: Address | undefined,
  gasCostETH: bigint,
  userTokens: Address[],
  userBalances: bigint[]
) {
  const { data: result } = useReadContract({
    address: paymasterAddress,
    abi: CROSS_CHAIN_PAYMASTER_ABI,
    functionName: 'getBestPaymentTokenForApp',
    args: appAddress && user ? [appAddress, user, gasCostETH, userTokens, userBalances] : undefined,
  });

  return {
    bestToken: result?.[0] as Address | undefined,
    tokenCost: result?.[1] as bigint | undefined,
    reason: result?.[2] as string | undefined,
  };
}

export function useSwapFeeEstimate(
  _sourceChainId: number,
  _destinationChainId: number,
  amount: bigint
) {
  const xlpFee = amount * 5n / 10000n;

  return {
    networkFee: 0n,
    xlpFee,
    totalFee: xlpFee,
    estimatedTime: 0,
    isLoading: false,
    isEstimate: true,
  };
}
