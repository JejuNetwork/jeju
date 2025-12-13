import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import {
  FEED_REGISTRY_ABI,
  REPORT_VERIFIER_ABI,
  COMMITTEE_MANAGER_ABI,
  FEE_ROUTER_ABI,
  getOracleAddresses,
  type FeedSpec,
  type ConsensusPrice,
  type Committee,
  type Subscription,
  type FeeConfig,
} from '../lib/oracleNetwork';
import type { Address } from 'viem';

export function useFeedRegistry() {
  const { feedRegistry } = getOracleAddresses();

  const { data: allFeedIds, refetch: refetchFeeds } = useReadContract({
    address: feedRegistry,
    abi: FEED_REGISTRY_ABI,
    functionName: 'getAllFeeds',
  });

  const { data: activeFeedIds } = useReadContract({
    address: feedRegistry,
    abi: FEED_REGISTRY_ABI,
    functionName: 'getActiveFeeds',
  });

  const { data: totalFeeds } = useReadContract({
    address: feedRegistry,
    abi: FEED_REGISTRY_ABI,
    functionName: 'totalFeeds',
  });

  return {
    allFeedIds: (allFeedIds as `0x${string}`[]) || [],
    activeFeedIds: (activeFeedIds as `0x${string}`[]) || [],
    totalFeeds: totalFeeds as bigint | undefined,
    refetchFeeds,
  };
}

export function useFeedDetails(feedId: `0x${string}` | undefined) {
  const { feedRegistry, reportVerifier } = getOracleAddresses();

  const { data: feedSpec, refetch } = useReadContract({
    address: feedRegistry,
    abi: FEED_REGISTRY_ABI,
    functionName: 'getFeed',
    args: feedId ? [feedId] : undefined,
    query: { enabled: !!feedId },
  });

  const { data: latestPrice } = useReadContract({
    address: reportVerifier,
    abi: REPORT_VERIFIER_ABI,
    functionName: 'getLatestPrice',
    args: feedId ? [feedId] : undefined,
    query: { enabled: !!feedId },
  });

  const { data: consensusPrice } = useReadContract({
    address: reportVerifier,
    abi: REPORT_VERIFIER_ABI,
    functionName: 'getConsensusPrice',
    args: feedId ? [feedId] : undefined,
    query: { enabled: !!feedId },
  });

  const { data: currentRound } = useReadContract({
    address: reportVerifier,
    abi: REPORT_VERIFIER_ABI,
    functionName: 'getCurrentRound',
    args: feedId ? [feedId] : undefined,
    query: { enabled: !!feedId },
  });

  const { data: isActive } = useReadContract({
    address: feedRegistry,
    abi: FEED_REGISTRY_ABI,
    functionName: 'isFeedActive',
    args: feedId ? [feedId] : undefined,
    query: { enabled: !!feedId },
  });

  // latestPrice returns [price, confidence, timestamp, isValid]
  const priceData = latestPrice as [bigint, bigint, bigint, boolean] | undefined;

  return {
    feedSpec: feedSpec as FeedSpec | undefined,
    price: priceData?.[0],
    confidence: priceData?.[1],
    timestamp: priceData?.[2],
    isValid: priceData?.[3],
    consensusPrice: consensusPrice as ConsensusPrice | undefined,
    currentRound: currentRound as bigint | undefined,
    isActive: isActive as boolean | undefined,
    refetch,
  };
}

export function useFeedBySymbol(symbol: string | undefined) {
  const { feedRegistry } = getOracleAddresses();

  const { data: feedSpec } = useReadContract({
    address: feedRegistry,
    abi: FEED_REGISTRY_ABI,
    functionName: 'getFeedBySymbol',
    args: symbol ? [symbol] : undefined,
    query: { enabled: !!symbol },
  });

  return { feedSpec: feedSpec as FeedSpec | undefined };
}

export function useCommittee(feedId: `0x${string}` | undefined) {
  const { committeeManager } = getOracleAddresses();

  const { data: committee } = useReadContract({
    address: committeeManager,
    abi: COMMITTEE_MANAGER_ABI,
    functionName: 'getCommittee',
    args: feedId ? [feedId] : undefined,
    query: { enabled: !!feedId },
  });

  const { data: canRotate } = useReadContract({
    address: committeeManager,
    abi: COMMITTEE_MANAGER_ABI,
    functionName: 'canRotate',
    args: feedId ? [feedId] : undefined,
    query: { enabled: !!feedId },
  });

  const { data: nextRotationTime } = useReadContract({
    address: committeeManager,
    abi: COMMITTEE_MANAGER_ABI,
    functionName: 'getNextRotationTime',
    args: feedId ? [feedId] : undefined,
    query: { enabled: !!feedId },
  });

  return {
    committee: committee as Committee | undefined,
    canRotate: canRotate as boolean | undefined,
    nextRotationTime: nextRotationTime as bigint | undefined,
  };
}

export function useOperatorCommittees(operator: Address | undefined) {
  const { committeeManager } = getOracleAddresses();

  const { data: feedIds, refetch } = useReadContract({
    address: committeeManager,
    abi: COMMITTEE_MANAGER_ABI,
    functionName: 'getOperatorFeeds',
    args: operator ? [operator] : undefined,
    query: { enabled: !!operator },
  });

  return {
    assignedFeeds: (feedIds as `0x${string}`[]) || [],
    feedIds: (feedIds as `0x${string}`[]) || [],
    refetch,
  };
}

export function useOracleSubscriptions() {
  const { address } = useAccount();
  const { feeRouter } = getOracleAddresses();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: subscriptionIds, refetch: refetchSubscription } = useReadContract({
    address: feeRouter,
    abi: FEE_ROUTER_ABI,
    functionName: 'getSubscriptionsByAccount',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: feeConfig } = useReadContract({
    address: feeRouter,
    abi: FEE_ROUTER_ABI,
    functionName: 'getFeeConfig',
  });

  const subscribe = async (feedIds: `0x${string}`[], months: number, value: bigint) => {
    writeContract({
      address: feeRouter,
      abi: FEE_ROUTER_ABI,
      functionName: 'subscribe',
      args: [feedIds, BigInt(months)],
      value,
    });
  };

  return {
    subscriptionIds: (subscriptionIds as `0x${string}`[]) || [],
    feeConfig: feeConfig as FeeConfig | undefined,
    subscribe,
    isSubscribing: isPending || isConfirming,
    isSubscribeSuccess: isSuccess,
    refetchSubscription,
  };
}

export function useSubscriptionDetails(subscriptionId: `0x${string}` | undefined) {
  const { feeRouter } = getOracleAddresses();

  const { data: subscription } = useReadContract({
    address: feeRouter,
    abi: FEE_ROUTER_ABI,
    functionName: 'getSubscription',
    args: subscriptionId ? [subscriptionId] : undefined,
    query: { enabled: !!subscriptionId },
  });

  return { subscription: subscription as Subscription | undefined };
}

export function useFeedSubscriptionStatus(feedId: `0x${string}` | undefined) {
  const { address } = useAccount();
  const { feeRouter } = getOracleAddresses();

  const { data: isSubscribed } = useReadContract({
    address: feeRouter,
    abi: FEE_ROUTER_ABI,
    functionName: 'isSubscribed',
    args: feedId && address ? [address, feedId] : undefined,
    query: { enabled: !!feedId && !!address },
  });

  return { isSubscribed: isSubscribed as boolean | undefined };
}

export function useSubscriptionPrice(feedIds: `0x${string}`[], months: number) {
  const { feeRouter } = getOracleAddresses();

  const { data: price } = useReadContract({
    address: feeRouter,
    abi: FEE_ROUTER_ABI,
    functionName: 'getSubscriptionPrice',
    args: feedIds.length > 0 ? [feedIds, BigInt(months)] : undefined,
    query: { enabled: feedIds.length > 0 && months > 0 },
  });

  return { price: price as bigint | undefined };
}

export function useOracleNetworkStats() {
  const { feedRegistry, feeRouter } = getOracleAddresses();

  const { data: totalFeeds } = useReadContract({
    address: feedRegistry,
    abi: FEED_REGISTRY_ABI,
    functionName: 'totalFeeds',
  });

  const { data: activeFeedIds } = useReadContract({
    address: feedRegistry,
    abi: FEED_REGISTRY_ABI,
    functionName: 'getActiveFeeds',
  });

  const { data: totalFeesCollected } = useReadContract({
    address: feeRouter,
    abi: FEE_ROUTER_ABI,
    functionName: 'getTotalFeesCollected',
  });

  const { data: currentEpoch } = useReadContract({
    address: feeRouter,
    abi: FEE_ROUTER_ABI,
    functionName: 'getCurrentEpoch',
  });

  return {
    totalFeeds: totalFeeds as bigint | undefined,
    activeFeeds: (activeFeedIds as `0x${string}`[] | undefined)?.length ?? 0,
    totalFeesCollected: totalFeesCollected as bigint | undefined,
    currentEpoch: currentEpoch as bigint | undefined,
  };
}

export function useOracleNetwork() {
  const { feedRegistry, reportVerifier, committeeManager, feeRouter } = getOracleAddresses();
  const feedRegistryHook = useFeedRegistry();
  const subscriptionHook = useOracleSubscriptions();
  const statsHook = useOracleNetworkStats();

  return {
    addresses: { feedRegistry, reportVerifier, committeeManager, feeRouter },
    ...feedRegistryHook,
    ...subscriptionHook,
    ...statsHook,
  };
}
