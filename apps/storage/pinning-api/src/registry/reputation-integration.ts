/**
 * ERC-8004 Reputation Integration for Developer Infrastructure
 * 
 * Integrates JejuGit and JejuPkg with the ERC-8004 reputation system:
 * - Compute reputation scores for packages and repositories
 * - Link reputation to on-chain agents
 * - Enable Council proposals for deep funding
 */

import type { Address, Hex } from 'viem';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import type { PublicClient, WalletClient } from 'viem';

export interface ReputationConfig {
  rpcUrl: string;
  gitRegistryAddress: Address;
  packageRegistryAddress: Address;
  reputationRegistryAddress: Address;
  councilAddress: Address;
  privateKey?: Hex;
}

export interface ReputationScore {
  totalScore: number;
  components: {
    packageScore: number;
    repoScore: number;
    contributorScore: number;
    qualityScore: number;
    adoptionScore: number;
  };
  normalizedScore: number; // 0-100 for ERC-8004
  lastUpdated: number;
}

export interface PackageMetrics {
  downloadCount: number;
  dependentCount: number;
  starCount: number;
  forkCount: number;
  issueResolutionRate: number;
  securityScore: number;
  documentationScore: number;
  testCoverage: number;
}

export interface RepoMetrics {
  commitCount: number;
  contributorCount: number;
  prMergeRate: number;
  issueCloseRate: number;
  starCount: number;
  forkCount: number;
  codeQualityScore: number;
  documentationScore: number;
}

const REPUTATION_REGISTRY_ABI = parseAbi([
  'function getReputationScore(address agent) view returns (uint256)',
  'function updateReputationScore(address agent, uint256 score, bytes32 dataHash)',
  'function setValidator(address validator, bool enabled)',
  'event ReputationUpdated(address indexed agent, uint256 score, bytes32 dataHash)',
]);

const COUNCIL_ABI = parseAbi([
  'function createProposal(uint8 proposalType, string title, string description, bytes data) returns (uint256)',
  'function getProposal(uint256 proposalId) view returns (tuple(uint8 proposalType, string title, string description, address proposer, uint256 createdAt, uint256 votingEnds, uint256 yesVotes, uint256 noVotes, uint8 status))',
  'event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint8 proposalType)',
]);

export class ReputationIntegration {
  private config: ReputationConfig;
  private publicClient: PublicClient;
  private walletClient?: WalletClient;

  constructor(config: ReputationConfig) {
    this.config = config;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });

    if (config.privateKey) {
      this.walletClient = createWalletClient({
        transport: http(config.rpcUrl),
      });
    }
  }

  /**
   * Calculate reputation score for a package
   */
  calculatePackageScore(metrics: PackageMetrics): ReputationScore {
    const weights = {
      downloads: 0.20,
      dependents: 0.20,
      stars: 0.10,
      forks: 0.05,
      issueResolution: 0.15,
      security: 0.15,
      documentation: 0.10,
      tests: 0.05,
    };

    // Normalize metrics to 0-100 scale
    const normalized = {
      downloads: Math.min(100, Math.log10(metrics.downloadCount + 1) * 20),
      dependents: Math.min(100, Math.log10(metrics.dependentCount + 1) * 25),
      stars: Math.min(100, Math.log10(metrics.starCount + 1) * 30),
      forks: Math.min(100, Math.log10(metrics.forkCount + 1) * 35),
      issueResolution: metrics.issueResolutionRate * 100,
      security: metrics.securityScore,
      documentation: metrics.documentationScore,
      tests: metrics.testCoverage,
    };

    const packageScore = 
      normalized.downloads * weights.downloads +
      normalized.dependents * weights.dependents +
      normalized.stars * weights.stars +
      normalized.forks * weights.forks +
      normalized.issueResolution * weights.issueResolution +
      normalized.security * weights.security +
      normalized.documentation * weights.documentation +
      normalized.tests * weights.tests;

    return {
      totalScore: packageScore,
      components: {
        packageScore,
        repoScore: 0,
        contributorScore: 0,
        qualityScore: (normalized.security + normalized.documentation + normalized.tests) / 3,
        adoptionScore: (normalized.downloads + normalized.dependents) / 2,
      },
      normalizedScore: Math.round(packageScore),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Calculate reputation score for a repository
   */
  calculateRepoScore(metrics: RepoMetrics): ReputationScore {
    const weights = {
      commits: 0.15,
      contributors: 0.15,
      prMergeRate: 0.15,
      issueCloseRate: 0.15,
      stars: 0.15,
      forks: 0.10,
      codeQuality: 0.10,
      documentation: 0.05,
    };

    const normalized = {
      commits: Math.min(100, Math.log10(metrics.commitCount + 1) * 20),
      contributors: Math.min(100, Math.log10(metrics.contributorCount + 1) * 40),
      prMergeRate: metrics.prMergeRate * 100,
      issueCloseRate: metrics.issueCloseRate * 100,
      stars: Math.min(100, Math.log10(metrics.starCount + 1) * 30),
      forks: Math.min(100, Math.log10(metrics.forkCount + 1) * 35),
      codeQuality: metrics.codeQualityScore,
      documentation: metrics.documentationScore,
    };

    const repoScore = 
      normalized.commits * weights.commits +
      normalized.contributors * weights.contributors +
      normalized.prMergeRate * weights.prMergeRate +
      normalized.issueCloseRate * weights.issueCloseRate +
      normalized.stars * weights.stars +
      normalized.forks * weights.forks +
      normalized.codeQuality * weights.codeQuality +
      normalized.documentation * weights.documentation;

    return {
      totalScore: repoScore,
      components: {
        packageScore: 0,
        repoScore,
        contributorScore: normalized.contributors,
        qualityScore: (normalized.codeQuality + normalized.documentation) / 2,
        adoptionScore: (normalized.stars + normalized.forks) / 2,
      },
      normalizedScore: Math.round(repoScore),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Calculate combined reputation for a developer/organization
   */
  calculateDeveloperScore(
    packages: PackageMetrics[],
    repos: RepoMetrics[]
  ): ReputationScore {
    const packageScores = packages.map(p => this.calculatePackageScore(p));
    const repoScores = repos.map(r => this.calculateRepoScore(r));

    const avgPackageScore = packageScores.length > 0
      ? packageScores.reduce((sum, s) => sum + s.totalScore, 0) / packageScores.length
      : 0;

    const avgRepoScore = repoScores.length > 0
      ? repoScores.reduce((sum, s) => sum + s.totalScore, 0) / repoScores.length
      : 0;

    // Weight repos more than packages (code > distribution)
    const totalScore = avgRepoScore * 0.6 + avgPackageScore * 0.4;

    return {
      totalScore,
      components: {
        packageScore: avgPackageScore,
        repoScore: avgRepoScore,
        contributorScore: avgRepoScore * 0.3, // Derive from repo activity
        qualityScore: (avgPackageScore + avgRepoScore) / 2 * 0.8,
        adoptionScore: (avgPackageScore * 0.6 + avgRepoScore * 0.4),
      },
      normalizedScore: Math.round(totalScore),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Update reputation score on-chain
   */
  async updateOnChainReputation(
    agentAddress: Address,
    score: ReputationScore
  ): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet client required for on-chain updates');
    }

    // Create hash of the score data for verification
    const scoreData = JSON.stringify(score);
    const dataHash = await this.hashData(scoreData);

    const hash = await this.walletClient.writeContract({
      address: this.config.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'updateReputationScore',
      args: [agentAddress, BigInt(score.normalizedScore), dataHash as Hex],
    });

    return hash;
  }

  /**
   * Get current on-chain reputation score
   */
  async getOnChainReputation(agentAddress: Address): Promise<bigint> {
    const score = await this.publicClient.readContract({
      address: this.config.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'getReputationScore',
      args: [agentAddress],
    });

    return score as bigint;
  }

  /**
   * Create a Council proposal for deep funding
   */
  async createFundingProposal(
    title: string,
    description: string,
    resourceId: string, // Package name or repo ID
    resourceType: 'package' | 'repository',
    requestedAmount: bigint
  ): Promise<{ proposalId: bigint; txHash: Hex }> {
    if (!this.walletClient) {
      throw new Error('Wallet client required for proposal creation');
    }

    const proposalType = resourceType === 'package' ? 2 : 3; // Assuming 2=package, 3=repo

    const data = new TextEncoder().encode(JSON.stringify({
      resourceId,
      resourceType,
      requestedAmount: requestedAmount.toString(),
    }));

    const hash = await this.walletClient.writeContract({
      address: this.config.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'createProposal',
      args: [proposalType, title, description, `0x${Buffer.from(data).toString('hex')}` as Hex],
    });

    // For now, return a mock proposal ID
    // In production, would parse the ProposalCreated event
    return {
      proposalId: BigInt(Date.now()),
      txHash: hash,
    };
  }

  /**
   * Get proposal details
   */
  async getProposal(proposalId: bigint): Promise<{
    proposalType: number;
    title: string;
    description: string;
    proposer: Address;
    createdAt: bigint;
    votingEnds: bigint;
    yesVotes: bigint;
    noVotes: bigint;
    status: number;
  }> {
    const result = await this.publicClient.readContract({
      address: this.config.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'getProposal',
      args: [proposalId],
    });

    const proposal = result as [number, string, string, Address, bigint, bigint, bigint, bigint, number];
    
    return {
      proposalType: proposal[0],
      title: proposal[1],
      description: proposal[2],
      proposer: proposal[3],
      createdAt: proposal[4],
      votingEnds: proposal[5],
      yesVotes: proposal[6],
      noVotes: proposal[7],
      status: proposal[8],
    };
  }

  private async hashData(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

/**
 * Create reputation integration from environment
 */
export function createReputationIntegration(): ReputationIntegration {
  return new ReputationIntegration({
    rpcUrl: process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:9545',
    gitRegistryAddress: (process.env.GIT_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    packageRegistryAddress: (process.env.PACKAGE_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    reputationRegistryAddress: (process.env.REPUTATION_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    councilAddress: (process.env.COUNCIL_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address,
    privateKey: process.env.PRIVATE_KEY as Hex | undefined,
  });
}
