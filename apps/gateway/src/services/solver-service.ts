/**
 * Solver Service - Decentralized Solver Management
 * 
 * Persists solver data to CovenantSQL for decentralized storage.
 */

import type { Solver, SolverLeaderboardEntry, SolverLiquidity, SupportedChainId } from '@jejunetwork/types';
import * as chainService from './chain-service';
import { ZERO_ADDRESS } from '../lib/contracts.js';
import { solverState, initializeState } from './state.js';

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
  private initialized = false;
  
  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await initializeState();
    await this.syncKnownSolvers();
    this.initialized = true;
  }

  private async syncKnownSolvers(): Promise<void> {
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
      
      await solverState.save(solver);
      return solver;
    }
    
    // Return cached version if chain lookup fails
    return solverState.get(address);
  }

  async listSolvers(params?: ListSolversParams): Promise<Solver[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    let solvers = await solverState.list({
      status: params?.active !== false ? 'active' : undefined,
      minReputation: params?.minReputation,
    });

    if (params?.chainId) {
      const chainId = params.chainId as SupportedChainId;
      solvers = solvers.filter(s => s.supportedChains.includes(chainId));
    }

    return solvers.sort((a, b) => b.reputation - a.reputation);
  }

  async getSolver(address: string): Promise<Solver | null> {
    // Check CQL first
    const cached = await solverState.get(address);
    if (cached) return cached;

    // Refresh from chain
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

  async updateSolverStats(address: string, stats: {
    totalFills?: number;
    successfulFills?: number;
    volumeUsd?: string;
    feesUsd?: string;
  }): Promise<void> {
    const solver = await this.getSolver(address);
    if (!solver) return;

    if (stats.totalFills !== undefined) solver.totalFills = stats.totalFills;
    if (stats.successfulFills !== undefined) solver.successfulFills = stats.successfulFills;
    if (stats.volumeUsd !== undefined) solver.totalVolumeUsd = stats.volumeUsd;
    if (stats.feesUsd !== undefined) solver.totalFeesEarnedUsd = stats.feesUsd;
    
    solver.failedFills = solver.totalFills - solver.successfulFills;
    solver.successRate = solver.totalFills > 0 ? (solver.successfulFills / solver.totalFills) * 100 : 0;
    solver.reputation = Math.min(100, solver.successRate);
    solver.lastActiveAt = Date.now();

    await solverState.save(solver);
  }
}

export const solverService = new SolverService();
