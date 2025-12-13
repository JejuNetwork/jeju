/** Futarchy - Prediction market escalation for vetoed proposals */

import { Contract, JsonRpcProvider, Wallet, formatEther } from 'ethers';

const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO32 = '0x' + '0'.repeat(64);

const COUNCIL_ABI = [
  'function escalateToFutarchy(bytes32 proposalId) external',
  'function resolveFutarchy(bytes32 proposalId) external',
  'function executeFutarchyApproved(bytes32 proposalId) external',
  'function getVetoedProposals() external view returns (bytes32[])',
  'function getFutarchyPendingProposals() external view returns (bytes32[])',
  'function getFutarchyMarket(bytes32 proposalId) external view returns (bytes32 marketId, uint256 deadline, bool canResolve)',
  'function futarchyVotingPeriod() external view returns (uint256)',
  'function futarchyLiquidity() external view returns (uint256)',
] as const;

const MARKET_ABI = [
  'function getMarket(bytes32 sessionId) external view returns (bytes32, string, uint256, uint256, uint256, uint256, uint256, bool, bool, uint8, address, uint8)',
  'function getMarketPrices(bytes32 sessionId) external view returns (uint256 yesPrice, uint256 noPrice)',
  'function buyYes(bytes32 sessionId, uint256 amount) external',
  'function buyNo(bytes32 sessionId, uint256 amount) external',
] as const;

export interface FutarchyMarket {
  proposalId: string; marketId: string; question: string;
  yesPrice: number; noPrice: number; yesShares: string; noShares: string;
  totalVolume: string; deadline: number; canResolve: boolean; resolved: boolean;
  outcome: boolean | null; createdAt: number;
}

export interface FutarchyConfig { rpcUrl: string; councilAddress: string; predimarketAddress: string; operatorKey?: string }

type TxResult = { success: boolean; txHash?: string; error?: string; approved?: boolean };

export class FutarchyClient {
  private readonly provider: JsonRpcProvider;
  private readonly council: Contract;
  private readonly market: Contract;
  private wallet: Wallet | null = null;

  readonly councilDeployed: boolean;
  readonly predimarketDeployed: boolean;

  constructor(config: FutarchyConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.councilDeployed = config.councilAddress !== ZERO;
    this.predimarketDeployed = config.predimarketAddress !== ZERO;

    if (config.operatorKey) this.wallet = new Wallet(config.operatorKey, this.provider);

    const signer = this.wallet ?? this.provider;
    this.council = new Contract(config.councilAddress, COUNCIL_ABI, signer);
    this.market = new Contract(config.predimarketAddress, MARKET_ABI, signer);
  }

  async getVetoedProposals(): Promise<string[]> {
    return this.councilDeployed ? this.council.getVetoedProposals() : [];
  }

  async getPendingFutarchyProposals(): Promise<string[]> {
    return this.councilDeployed ? this.council.getFutarchyPendingProposals() : [];
  }

  async getFutarchyMarket(proposalId: string): Promise<FutarchyMarket | null> {
    if (!this.councilDeployed || !this.predimarketDeployed) return null;

    const [marketId, deadline, canResolve] = await this.council.getFutarchyMarket(proposalId) as [string, bigint, boolean];
    if (marketId === ZERO32) return null;

    const [, question, yesShares, noShares, , totalVolume, createdAt, resolved, outcome] = await this.market.getMarket(marketId) as [string, string, bigint, bigint, bigint, bigint, bigint, boolean, boolean, number, string, number];
    const [yesPrice, noPrice] = await this.market.getMarketPrices(marketId) as [bigint, bigint];

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
    if (!this.wallet) return { success: false, error: 'Wallet required' };

    const tx = await this.council.escalateToFutarchy(proposalId);
    return { success: true, txHash: (await tx.wait()).hash };
  }

  async resolveFutarchy(proposalId: string): Promise<TxResult> {
    if (!this.councilDeployed) return { success: false, error: 'Council not deployed' };
    if (!this.wallet) return { success: false, error: 'Wallet required' };

    const m = await this.getFutarchyMarket(proposalId);
    if (!m) return { success: false, error: 'No market for proposal' };
    if (!m.canResolve) return { success: false, error: `Cannot resolve yet. Deadline: ${new Date(m.deadline * 1000).toISOString()}` };

    const tx = await this.council.resolveFutarchy(proposalId);
    return { success: true, approved: m.yesPrice > m.noPrice, txHash: (await tx.wait()).hash };
  }

  async executeFutarchyApproved(proposalId: string): Promise<TxResult> {
    if (!this.councilDeployed) return { success: false, error: 'Council not deployed' };
    if (!this.wallet) return { success: false, error: 'Wallet required' };

    const tx = await this.council.executeFutarchyApproved(proposalId);
    return { success: true, txHash: (await tx.wait()).hash };
  }

  async getFutarchyParameters(): Promise<{ votingPeriod: number; liquidity: string } | null> {
    if (!this.councilDeployed) return null;

    const [period, liq] = await Promise.all([
      this.council.futarchyVotingPeriod() as Promise<bigint>,
      this.council.futarchyLiquidity() as Promise<bigint>,
    ]);
    return { votingPeriod: Number(period), liquidity: formatEther(liq) };
  }

  async buyPosition(marketId: string, position: 'yes' | 'no', amount: bigint): Promise<string> {
    if (!this.predimarketDeployed) throw new Error('Predimarket not deployed');
    if (!this.wallet) throw new Error('Wallet required');

    const tx = position === 'yes' ? await this.market.buyYes(marketId, amount) : await this.market.buyNo(marketId, amount);
    return (await tx.wait()).hash;
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
