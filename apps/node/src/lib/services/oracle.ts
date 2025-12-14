/**
 * Oracle service - Real contract integration
 */

import { type Address, keccak256, toBytes } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { ORACLE_STAKING_MANAGER_ABI } from '../abis';

export interface OracleServiceConfig {
  agentId: bigint;
  stakeAmount: bigint;
  markets: string[]; // Market identifiers to provide prices for
}

export interface OracleServiceState {
  isRegistered: boolean;
  stake: bigint;
  reputation: bigint;
  accuracy: bigint;
  submissionsCount: bigint;
}

export interface PriceSubmission {
  market: string;
  price: bigint;
  timestamp: number;
}

export class OracleService {
  private client: NodeClient;
  private submissionHistory: PriceSubmission[] = [];

  constructor(client: NodeClient) {
    this.client = client;
  }

  async getState(address: Address): Promise<OracleServiceState> {
    const info = await this.client.publicClient.readContract({
      address: this.client.addresses.oracleStakingManager,
      abi: ORACLE_STAKING_MANAGER_ABI,
      functionName: 'getOracleInfo',
      args: [address],
    });

    return {
      isRegistered: info[0] > 0n,
      stake: info[0],
      reputation: info[1],
      accuracy: info[2],
      submissionsCount: info[3],
    };
  }

  async register(config: OracleServiceConfig): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.oracleStakingManager,
      abi: ORACLE_STAKING_MANAGER_ABI,
      functionName: 'registerOracle',
      args: [config.agentId],
      value: config.stakeAmount,
    });

    return hash;
  }

  async submitPrice(market: string, price: bigint): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const marketHash = keccak256(toBytes(market));

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.oracleStakingManager,
      abi: ORACLE_STAKING_MANAGER_ABI,
      functionName: 'submitPrice',
      args: [marketHash, price],
    });

    this.submissionHistory.push({
      market,
      price,
      timestamp: Date.now(),
    });

    return hash;
  }

  getSubmissionHistory(): PriceSubmission[] {
    return [...this.submissionHistory];
  }
}

export function createOracleService(client: NodeClient): OracleService {
  return new OracleService(client);
}

