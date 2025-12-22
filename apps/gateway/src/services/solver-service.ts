/**
 * Solver Service - Decentralized Solver Management
 * 
 * Persists solver data to CovenantSQL for decentralized storage.
 */

import type { Solver, SolverLeaderboardEntry, SolverLiquidity, SupportedChainId } from '@jejunetwork/types';
import * as chainService from './chain-service';
import { ZERO_ADDRESS } from '../lib/contracts.js';
import { solverState, initializeState } from './state.js';
import {
  ListSolversQuerySchema,
  SolverLeaderboardQuerySchema,
  SolverAddressSchema,
  expect,
  expectChainId,
  expectAddress,
  type ListSolversQuery,
  type SolverLeaderboardQuery,
} from '../lib/validation.js';

const KNOWN_SOLVER_ADDRESSES: string[] = (process.env.OIF_DEV_SOLVER_ADDRESSES || '')
  .split(',')
  .filter(addr => addr.startsWith('0x') && addr.length === 42);

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

  async listSolvers(params?: { chainId?: number; minReputation?: number; active?: boolean }): Promise<Solver[]> {
    const validated = params ? expect(params, ListSolversQuerySchema, 'listSolvers params') : undefined;
    if (!this.initialized) {
      await this.initialize();
    }

    let solvers = await solverState.list({
      status: validated?.active !== false ? 'active' : undefined,
      minReputation: validated?.minReputation,
    });

    if (validated?.chainId) {
      const chainId = validated.chainId;
      solvers = solvers.filter(s => s.supportedChains.includes(chainId));
    }

    return solvers.sort((a, b) => b.reputation - a.reputation);
  }

  async getSolver(address: string): Promise<Solver | null> {
    const validated = expectAddress(address, 'getSolver address');
    // Check CQL first
    const cached = await solverState.get(validated);
    if (cached) return cached;

    // Refresh from chain
    return this.refreshSolverFromChain(validated);
  }

  async getSolverLiquidity(address: string): Promise<SolverLiquidity[]> {
    const validated = expectAddress(address, 'getSolverLiquidity address');
    const solver = await this.getSolver(validated);
    return solver?.liquidity || [];
  }

  async getLeaderboard(params?: { limit?: number; sortBy?: 'volume' | 'fills' | 'reputation' | 'successRate' }): Promise<SolverLeaderboardEntry[]> {
    const validated = params ? expect(params, SolverLeaderboardQuerySchema, 'getLeaderboard params') : undefined;
    const solvers = await this.listSolvers();
    const limit = validated?.limit || 10;
    const sortBy = validated?.sortBy || 'volume';

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
    const validatedSourceChain = expectChainId(sourceChain, 'findSolversForRoute sourceChain');
    const validatedDestChain = expectChainId(destinationChain, 'findSolversForRoute destinationChain');
    const validatedToken = expectAddress(token, 'findSolversForRoute token');
    const allSolvers = await this.listSolvers({ active: true });
    const srcChain = validatedSourceChain;
    const destChain = validatedDestChain;
    
    return allSolvers.filter(solver => {
      const supportsSource = solver.supportedChains.includes(srcChain);
      const supportsDest = solver.supportedChains.includes(destChain);
      
      const sourceTokens = solver.supportedTokens[validatedSourceChain.toString()] || [];
      
      const supportsToken = sourceTokens.includes(validatedToken) || 
        validatedToken === ZERO_ADDRESS;
      
      return supportsSource && supportsDest && supportsToken;
    });
  }

  async updateSolverStats(address: string, stats: {
    totalFills?: number;
    successfulFills?: number;
    volumeUsd?: string;
    feesUsd?: string;
  }): Promise<void> {
    const validated = expectAddress(address, 'updateSolverStats address');
    const solver = await this.getSolver(validated);
    if (!solver) {
      throw new Error(`Solver not found: ${validated}`);
    }

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
