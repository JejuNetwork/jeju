import type { Solver, SolverLeaderboardEntry, SolverLiquidity, SupportedChainId } from '@jejunetwork/types/oif';
import * as chainService from './chain-service';
import { ZERO_ADDRESS } from '../lib/contracts.js';

const solverCache: Map<string, Solver> = new Map();

const KNOWN_SOLVER_ADDRESSES: string[] = (process.env.OIF_DEV_SOLVER_ADDRESSES || '')
  .split(',')
  .filter(addr => addr.startsWith('0x') && addr.length === 42);

interface ListSolversParams {
  chainId?: number;
  minReputation?: number;
  active?: boolean;
}

interface LeaderboardParams {
  limit?: number;
  sortBy?: 'volume' | 'fills' | 'reputation' | 'successRate';
}

export class SolverService {
  constructor() {
    this.initializeSolverCache();
  }

  private async initializeSolverCache(): Promise<void> {
    for (const address of KNOWN_SOLVER_ADDRESSES) {
      await this.refreshSolverFromChain(address as `0x${string}`);
    }
  }

  private async refreshSolverFromChain(address: `0x${string}`): Promise<Solver | null> {
    const chainInfo = await chainService.fetchSolverInfo(address);
    
    if (chainInfo && chainInfo.isActive) {
      const totalFills = Number(chainInfo.totalFills);
      const successfulFills = Number(chainInfo.successfulFills);
      const failedFills = totalFills - successfulFills;
      const successRate = totalFills > 0 ? (successfulFills / totalFills) * 100 : 0;
      const reputation = Math.min(100, successRate);

      const solver: Solver = {
        address,
        name: `Solver ${address.slice(0, 8)}`,
        endpoint: `http://solver-${address.slice(2, 8)}.local/a2a`,
        supportedChains: chainInfo.supportedChains.map(c => Number(c) as SupportedChainId),
        supportedTokens: {},
        liquidity: [],
        reputation,
        totalFills,
        successfulFills,
        failedFills,
        successRate,
        avgResponseMs: 0,
        avgFillTimeMs: 0,
        totalVolumeUsd: '0',
        totalFeesEarnedUsd: '0',
        status: 'active',
        stakedAmount: chainInfo.stakedAmount.toString(),
        registeredAt: Number(chainInfo.registeredAt) * 1000,
        lastActiveAt: Date.now(),
      };
      
      solverCache.set(address.toLowerCase(), solver);
      return solver;
    }
    
    return solverCache.get(address.toLowerCase()) || null;
  }

  async listSolvers(params?: ListSolversParams): Promise<Solver[]> {
    if (solverCache.size === 0) {
      await this.initializeSolverCache();
    }

    let solvers = Array.from(solverCache.values());

    if (params?.chainId) {
      const chainId = params.chainId as SupportedChainId;
      solvers = solvers.filter(s => s.supportedChains.includes(chainId));
    }
    if (params?.minReputation) {
      solvers = solvers.filter(s => s.reputation >= params.minReputation!);
    }
    if (params?.active !== false) {
      solvers = solvers.filter(s => s.status === 'active');
    }

    return solvers.sort((a, b) => b.reputation - a.reputation);
  }

  async getSolver(address: string): Promise<Solver | null> {
    const cached = solverCache.get(address.toLowerCase());
    if (cached) return cached;

    return this.refreshSolverFromChain(address as `0x${string}`);
  }

  async getSolverLiquidity(address: string): Promise<SolverLiquidity[]> {
    const solver = await this.getSolver(address);
    return solver?.liquidity || [];
  }

  async getLeaderboard(params?: LeaderboardParams): Promise<SolverLeaderboardEntry[]> {
    const solvers = await this.listSolvers();
    const limit = params?.limit || 10;
    const sortBy = params?.sortBy || 'volume';

    const sorted = [...solvers].sort((a, b) => {
      switch (sortBy) {
        case 'volume':
          return parseFloat(b.totalVolumeUsd) - parseFloat(a.totalVolumeUsd);
        case 'fills':
          return b.totalFills - a.totalFills;
        case 'reputation':
          return b.reputation - a.reputation;
        case 'successRate':
          return b.successRate - a.successRate;
        default:
          return 0;
      }
    });

    return sorted.slice(0, limit).map((s, index) => ({
      rank: index + 1,
      solver: s.address,
      name: s.name,
      totalFills: s.totalFills,
      successRate: s.successRate,
      totalVolume: s.totalVolumeUsd,
      totalFeesEarned: s.totalFeesEarnedUsd,
      reputation: s.reputation,
      avgFillTimeMs: s.avgFillTimeMs,
    }));
  }

  async findSolversForRoute(
    sourceChain: number,
    destinationChain: number,
    token: string
  ): Promise<Solver[]> {
    const allSolvers = await this.listSolvers({ active: true });
    const srcChain = sourceChain as SupportedChainId;
    const destChain = destinationChain as SupportedChainId;
    
    return allSolvers.filter(solver => {
      const supportsSource = solver.supportedChains.includes(srcChain);
      const supportsDest = solver.supportedChains.includes(destChain);
      
      const sourceTokens = solver.supportedTokens[sourceChain.toString()] || [];
      
      const supportsToken = sourceTokens.includes(token) || 
        token === ZERO_ADDRESS;
      
      return supportsSource && supportsDest && supportsToken;
    });
  }
}

export const solverService = new SolverService();



