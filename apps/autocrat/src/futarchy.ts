/** Futarchy - Prediction market escalation for vetoed proposals */

import { createPublicClient, createWalletClient, http, formatEther, zeroAddress, zeroHash, type Address, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { readContract, waitForTransactionReceipt } from 'viem/actions';
import { parseAbi } from 'viem';
import { base, baseSepolia, localhost } from 'viem/chains';

function inferChainFromRpcUrl(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia;
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base;
  }
  return localhost;
}

const ZERO = zeroAddress;
const ZERO32 = zeroHash;

const COUNCIL_ABI = parseAbi([
  'function escalateToFutarchy(bytes32 proposalId) external',
  'function resolveFutarchy(bytes32 proposalId) external',
  'function executeFutarchyApproved(bytes32 proposalId) external',
  'function getVetoedProposals() external view returns (bytes32[])',
  'function getFutarchyPendingProposals() external view returns (bytes32[])',
  'function getFutarchyMarket(bytes32 proposalId) external view returns (bytes32 marketId, uint256 deadline, bool canResolve)',
  'function futarchyVotingPeriod() external view returns (uint256)',
  'function futarchyLiquidity() external view returns (uint256)',
]);

const MARKET_ABI = parseAbi([
  'function getMarket(bytes32 sessionId) external view returns (bytes32, string, uint256, uint256, uint256, uint256, uint256, bool, bool, uint8, address, uint8)',
  'function getMarketPrices(bytes32 sessionId) external view returns (uint256 yesPrice, uint256 noPrice)',
  'function buyYes(bytes32 sessionId, uint256 amount) external',
  'function buyNo(bytes32 sessionId, uint256 amount) external',
]);

export interface FutarchyMarket {
  proposalId: string; marketId: string; question: string;
  yesPrice: number; noPrice: number; yesShares: string; noShares: string;
  totalVolume: string; deadline: number; canResolve: boolean; resolved: boolean;
  outcome: boolean | null; createdAt: number;
}

export interface FutarchyConfig { rpcUrl: string; councilAddress: string; predimarketAddress: string; operatorKey?: string }

type TxResult = { success: boolean; txHash?: string; error?: string; approved?: boolean };

export class FutarchyClient {
  private readonly client: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount | null;
  private readonly councilAddress: Address;
  private readonly marketAddress: Address;

  readonly councilDeployed: boolean;
  readonly predimarketDeployed: boolean;

  constructor(config: FutarchyConfig) {
    const chain = inferChainFromRpcUrl(config.rpcUrl);
    // @ts-expect-error viem version type mismatch in monorepo
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
    this.walletClient = createWalletClient({
      chain,
      transport: http(config.rpcUrl),
    });
    
    this.councilAddress = config.councilAddress as Address;
    this.marketAddress = config.predimarketAddress as Address;
    
    this.councilDeployed = config.councilAddress !== ZERO;
    this.predimarketDeployed = config.predimarketAddress !== ZERO;

    if (config.operatorKey) {
      this.account = privateKeyToAccount(config.operatorKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(config.rpcUrl),
      });
    } else {
      this.account = null;
    }
  }

  async getVetoedProposals(): Promise<`0x${string}`[]> {
    if (!this.councilDeployed) return [];
    return readContract(this.client, {
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'getVetoedProposals',
    }) as Promise<`0x${string}`[]>;
  }

  async getPendingFutarchyProposals(): Promise<`0x${string}`[]> {
    if (!this.councilDeployed) return [];
    return readContract(this.client, {
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'getFutarchyPendingProposals',
    }) as Promise<`0x${string}`[]>;
  }

  async getFutarchyMarket(proposalId: string): Promise<FutarchyMarket | null> {
    if (!this.councilDeployed || !this.predimarketDeployed) return null;

    const result = await readContract(this.client, {
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'getFutarchyMarket',
      args: [proposalId as `0x${string}`],
    }) as [`0x${string}`, bigint, boolean];
    const [marketId, deadline, canResolve] = result;
    if (marketId === ZERO32) return null;

    const marketResult = await readContract(this.client, {
      address: this.marketAddress,
      abi: MARKET_ABI,
      functionName: 'getMarket',
      args: [marketId],
    }) as [`0x${string}`, string, bigint, bigint, bigint, bigint, bigint, boolean, boolean, number, Address, number];
    const [, question, yesShares, noShares, , totalVolume, createdAt, resolved, outcome] = marketResult;
    
    const prices = await readContract(this.client, {
      address: this.marketAddress,
      abi: MARKET_ABI,
      functionName: 'getMarketPrices',
      args: [marketId],
    }) as [bigint, bigint];
    const [yesPrice, noPrice] = prices;

    return {
      proposalId, marketId, question,
      yesPrice: Number(yesPrice) / 100, noPrice: Number(noPrice) / 100,
      yesShares: formatEther(yesShares), noShares: formatEther(noShares),
      totalVolume: formatEther(totalVolume), deadline: Number(deadline),
      canResolve, resolved, outcome: resolved ? outcome : null, createdAt: Number(createdAt),
    };
  }

  async escalateToFutarchy(proposalId: string): Promise<TxResult> {
    if (!this.councilDeployed) return { success: false, error: 'Council not deployed' };
    if (!this.account) return { success: false, error: 'Wallet required' };

    // @ts-expect-error viem ABI type inference
    const hash = await this.walletClient.writeContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'escalateToFutarchy',
      args: [proposalId as `0x${string}`],
      account: this.account,
    });
    await waitForTransactionReceipt(this.client, { hash });
    return { success: true, txHash: hash };
  }

  async resolveFutarchy(proposalId: string): Promise<TxResult> {
    if (!this.councilDeployed) return { success: false, error: 'Council not deployed' };
    if (!this.account) return { success: false, error: 'Wallet required' };

    const m = await this.getFutarchyMarket(proposalId);
    if (!m) return { success: false, error: 'No market for proposal' };
    if (!m.canResolve) return { success: false, error: `Cannot resolve yet. Deadline: ${new Date(m.deadline * 1000).toISOString()}` };

    // @ts-expect-error viem ABI type inference
    const hash = await this.walletClient.writeContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'resolveFutarchy',
      args: [proposalId as `0x${string}`],
      account: this.account,
    });
    await waitForTransactionReceipt(this.client, { hash });
    return { success: true, approved: m.yesPrice > m.noPrice, txHash: hash };
  }

  async executeFutarchyApproved(proposalId: string): Promise<TxResult> {
    if (!this.councilDeployed) return { success: false, error: 'Council not deployed' };
    if (!this.account) return { success: false, error: 'Wallet required' };

    // @ts-expect-error viem ABI type inference
    const hash = await this.walletClient.writeContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'executeFutarchyApproved',
      args: [proposalId as `0x${string}`],
      account: this.account,
    });
    await waitForTransactionReceipt(this.client, { hash });
    return { success: true, txHash: hash };
  }

  async getFutarchyParameters(): Promise<{ votingPeriod: number; liquidity: string } | null> {
    if (!this.councilDeployed) return null;

    const [period, liq] = await Promise.all([
      readContract(this.client, {
        address: this.councilAddress,
        abi: COUNCIL_ABI,
        functionName: 'futarchyVotingPeriod',
      }) as Promise<bigint>,
      readContract(this.client, {
        address: this.councilAddress,
        abi: COUNCIL_ABI,
        functionName: 'futarchyLiquidity',
      }) as Promise<bigint>,
    ]);
    return { votingPeriod: Number(period), liquidity: formatEther(liq) };
  }

  async buyPosition(marketId: `0x${string}`, position: 'yes' | 'no', amount: bigint): Promise<`0x${string}`> {
    if (!this.predimarketDeployed) throw new Error('Predimarket not deployed');
    if (!this.account) throw new Error('Wallet required');

    // @ts-expect-error viem version type mismatch in monorepo
    const hash = await this.walletClient.writeContract({
      address: this.marketAddress,
      abi: MARKET_ABI,
      functionName: position === 'yes' ? 'buyYes' : 'buyNo',
      args: [marketId, amount],
      account: this.account,
    });
    await waitForTransactionReceipt(this.client, { hash });
    return hash;
  }

  async getMarketSentiment(proposalId: string): Promise<{ sentiment: 'bullish' | 'bearish' | 'neutral'; confidence: number } | null> {
    const m = await this.getFutarchyMarket(proposalId);
    if (!m) return null;

    const diff = m.yesPrice - m.noPrice;
    return diff > 5 ? { sentiment: 'bullish', confidence: Math.abs(diff) * 100 }
         : diff < -5 ? { sentiment: 'bearish', confidence: Math.abs(diff) * 100 }
         : { sentiment: 'neutral', confidence: Math.abs(diff) * 100 };
  }
}

let instance: FutarchyClient | null = null;
export const getFutarchyClient = (config: FutarchyConfig) => instance ??= new FutarchyClient(config);
