/**
 * @module ContributorService
 * @description Service for managing contributors and their verified identities
 *
 * Features:
 * - Contributor registration and profile management
 * - OAuth3 GitHub verification flow
 * - Repository and dependency claims
 * - Integration with ContributorRegistry contract
 * - ERC-8004 agent linking
 */

import {
  type Address,
  type Chain,
  type Hash,
  keccak256,
  type PublicClient,
  parseAbi,
  toBytes,
  type WalletClient,
} from 'viem'
import {
  expectValid,
  expectValidResponse,
  GitHubRepoPermissionsSchema,
  GitHubTokenResponseSchema,
  GitHubUserProfileSchema,
  NpmPackageResponseSchema,
} from './schemas'

// ============ GitHub OAuth Types (local implementation) ============

interface GitHubOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
}

interface GitHubOAuthToken {
  accessToken: string
  tokenType: string
  scope: string
}

interface GitHubUserProfile {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string
}

class GitHubOAuthProvider {
  private static AUTH_URL = 'https://github.com/login/oauth/authorize'
  private static TOKEN_URL = 'https://github.com/login/oauth/access_token'
  private static PROFILE_URL = 'https://api.github.com/user'

  constructor(private config: GitHubOAuthConfig) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state,
    })
    return `${GitHubOAuthProvider.AUTH_URL}?${params}`
  }

  async exchangeCode(code: string): Promise<GitHubOAuthToken> {
    const response = await fetch(GitHubOAuthProvider.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
    })

    const data = await expectValidResponse(
      response,
      GitHubTokenResponseSchema,
      'GitHub token exchange',
    )

    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      scope: data.scope ?? '',
    }
  }

  async getProfile(token: GitHubOAuthToken): Promise<GitHubUserProfile> {
    const response = await fetch(GitHubOAuthProvider.PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    })

    return expectValidResponse(
      response,
      GitHubUserProfileSchema,
      'GitHub profile fetch',
    )
  }
}

// ============ Types ============

export type ContributorType = 'INDIVIDUAL' | 'ORGANIZATION' | 'PROJECT'
export type VerificationStatus =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'VERIFIED'
  | 'REVOKED'
export type SocialPlatform = 'github' | 'discord' | 'twitter' | 'farcaster'

export interface ContributorProfile {
  contributorId: string
  wallet: Address
  agentId: bigint
  contributorType: ContributorType
  profileUri: string
  totalEarned: bigint
  registeredAt: number
  lastActiveAt: number
  active: boolean
}

export interface SocialLink {
  platform: SocialPlatform
  handle: string
  proofHash: string
  status: VerificationStatus
  verifiedAt: number
  expiresAt: number
}

export interface RepositoryClaim {
  claimId: string
  contributorId: string
  owner: string
  repo: string
  proofHash: string
  status: VerificationStatus
  claimedAt: number
  verifiedAt: number
}

export interface DependencyClaim {
  claimId: string
  contributorId: string
  packageName: string
  registryType: string
  proofHash: string
  status: VerificationStatus
  claimedAt: number
  verifiedAt: number
}

export interface DAOContribution {
  daoId: string
  totalEarned: bigint
  bountyCount: number
  paymentRequestCount: number
  lastContributionAt: number
}

export interface ContributorServiceConfig {
  publicClient: PublicClient
  walletClient?: WalletClient
  chain: Chain
  registryAddress: Address
  oauth3Config: {
    github: {
      clientId: string
      clientSecret: string
      redirectUri: string
    }
  }
}

// ============ Contract ABI ============

const CONTRIBUTOR_REGISTRY_ABI = parseAbi([
  // Registration
  'function register(uint8 contributorType, string profileUri) external returns (bytes32 contributorId)',
  'function linkAgent(bytes32 contributorId, uint256 agentId) external',
  'function updateProfile(bytes32 contributorId, string profileUri) external',
  'function deactivate(bytes32 contributorId) external',
  'function reactivate(bytes32 contributorId) external',

  // Social Links
  'function addSocialLink(bytes32 contributorId, bytes32 platform, string handle) external',
  'function verifySocialLink(bytes32 contributorId, bytes32 platform, bytes32 proofHash) external',
  'function revokeSocialLink(bytes32 contributorId, bytes32 platform) external',

  // Repository Claims
  'function claimRepository(bytes32 contributorId, string owner, string repo) external returns (bytes32 claimId)',
  'function verifyRepository(bytes32 claimId, bytes32 proofHash) external',
  'function revokeRepositoryClaim(bytes32 claimId) external',

  // Dependency Claims
  'function claimDependency(bytes32 contributorId, string packageName, string registryType) external returns (bytes32 claimId)',
  'function verifyDependency(bytes32 claimId, bytes32 proofHash) external',
  'function revokeDependencyClaim(bytes32 claimId) external',

  // View Functions
  'function getContributor(bytes32 contributorId) external view returns (tuple(bytes32 contributorId, address wallet, uint256 agentId, uint8 contributorType, string profileUri, uint256 totalEarned, uint256 registeredAt, uint256 lastActiveAt, bool active))',
  'function getContributorByWallet(address wallet) external view returns (tuple(bytes32 contributorId, address wallet, uint256 agentId, uint8 contributorType, string profileUri, uint256 totalEarned, uint256 registeredAt, uint256 lastActiveAt, bool active))',
  'function getSocialLinks(bytes32 contributorId) external view returns (tuple(bytes32 platform, string handle, bytes32 proofHash, uint8 status, uint256 verifiedAt, uint256 expiresAt)[])',
  'function getRepositoryClaims(bytes32 contributorId) external view returns (tuple(bytes32 claimId, bytes32 contributorId, string owner, string repo, bytes32 proofHash, uint8 status, uint256 claimedAt, uint256 verifiedAt)[])',
  'function getDependencyClaims(bytes32 contributorId) external view returns (tuple(bytes32 claimId, bytes32 contributorId, string packageName, string registryType, bytes32 proofHash, uint8 status, uint256 claimedAt, uint256 verifiedAt)[])',
  'function getDAOContribution(bytes32 contributorId, bytes32 daoId) external view returns (tuple(bytes32 daoId, uint256 totalEarned, uint256 bountyCount, uint256 paymentRequestCount, uint256 lastContributionAt))',
  'function getContributorForRepo(string owner, string repo) external view returns (bytes32)',
  'function getContributorForDependency(string packageName, string registryType) external view returns (bytes32)',
  'function isVerifiedGitHub(bytes32 contributorId) external view returns (bool)',
  'function getAllContributors() external view returns (bytes32[])',
  'function getContributorCount() external view returns (uint256)',

  // Events
  'event ContributorRegistered(bytes32 indexed contributorId, address indexed wallet, uint8 contributorType)',
  'event SocialLinkVerified(bytes32 indexed contributorId, bytes32 indexed platform)',
  'event RepositoryVerified(bytes32 indexed claimId)',
  'event DependencyVerified(bytes32 indexed claimId)',
])

// ============ Platform Hashes ============

const PLATFORM_HASHES: Record<SocialPlatform, `0x${string}`> = {
  github: keccak256(toBytes('github')),
  discord: keccak256(toBytes('discord')),
  twitter: keccak256(toBytes('twitter')),
  farcaster: keccak256(toBytes('farcaster')),
}

// ============ Type Converters ============

function parseContributorType(value: number): ContributorType {
  const types: ContributorType[] = ['INDIVIDUAL', 'ORGANIZATION', 'PROJECT']
  return types[value] || 'INDIVIDUAL'
}

function parseVerificationStatus(value: number): VerificationStatus {
  const statuses: VerificationStatus[] = [
    'UNVERIFIED',
    'PENDING',
    'VERIFIED',
    'REVOKED',
  ]
  return statuses[value] || 'UNVERIFIED'
}

function parsePlatformFromHash(hash: string): SocialPlatform {
  for (const [platform, platformHash] of Object.entries(PLATFORM_HASHES)) {
    if (platformHash === hash) {
      return platform as SocialPlatform
    }
  }
  return 'github'
}

// ============ Service Class ============

export class ContributorService {
  private publicClient: PublicClient
  private walletClient: WalletClient | null
  private chain: Chain
  private registryAddress: Address
  private githubProvider: GitHubOAuthProvider

  constructor(config: ContributorServiceConfig) {
    this.publicClient = config.publicClient
    this.walletClient = config.walletClient || null
    this.chain = config.chain
    this.registryAddress = config.registryAddress

    this.githubProvider = new GitHubOAuthProvider({
      clientId: config.oauth3Config.github.clientId,
      clientSecret: config.oauth3Config.github.clientSecret,
      redirectUri: config.oauth3Config.github.redirectUri,
      scopes: ['read:user', 'repo'],
    })
  }

  // ============ Registration ============

  async register(
    contributorType: ContributorType,
    profileUri: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const typeIndex = ['INDIVIDUAL', 'ORGANIZATION', 'PROJECT'].indexOf(
      contributorType,
    )

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'register',
      args: [typeIndex, profileUri],
    })

    return hash
  }

  async linkAgent(contributorId: string, agentId: bigint): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'linkAgent',
      args: [contributorId as `0x${string}`, agentId],
    })

    return hash
  }

  async updateProfile(
    contributorId: string,
    profileUri: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'updateProfile',
      args: [contributorId as `0x${string}`, profileUri],
    })

    return hash
  }

  // ============ Social Link Verification ============

  getGitHubAuthUrl(state: string): string {
    return this.githubProvider.getAuthorizationUrl(state)
  }

  async verifyGitHubCallback(
    _contributorId: string,
    code: string,
  ): Promise<{ handle: string; proofHash: string }> {
    const token = await this.githubProvider.exchangeCode(code)
    const profile = await this.githubProvider.getProfile(token)

    const proofData = JSON.stringify({
      platform: 'github',
      userId: profile.id,
      username: profile.login,
      verifiedAt: Date.now(),
    })

    const proofHash = await this.hashProof(proofData)

    return {
      handle: profile.login,
      proofHash,
    }
  }

  async addSocialLink(
    contributorId: string,
    platform: SocialPlatform,
    handle: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const platformHash = PLATFORM_HASHES[platform]

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'addSocialLink',
      args: [
        contributorId as `0x${string}`,
        platformHash as `0x${string}`,
        handle,
      ],
    })

    return hash
  }

  // ============ Repository Claims ============

  async claimRepository(
    contributorId: string,
    owner: string,
    repo: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'claimRepository',
      args: [contributorId as `0x${string}`, owner, repo],
    })

    return hash
  }

  async verifyRepositoryOwnership(
    contributorId: string,
    owner: string,
    repo: string,
    githubToken: string,
  ): Promise<{ verified: boolean; proofHash: string }> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    )

    if (!response.ok) {
      return { verified: false, proofHash: '' }
    }

    const data = expectValid(
      GitHubRepoPermissionsSchema,
      await response.json(),
      'GitHub repo permissions',
    )

    const hasPermission =
      data.permissions?.admin ||
      data.permissions?.push ||
      data.permissions?.maintain

    if (!hasPermission) {
      return { verified: false, proofHash: '' }
    }

    const proofData = JSON.stringify({
      repo: `${owner}/${repo}`,
      contributorId,
      permissions: data.permissions,
      verifiedAt: Date.now(),
    })

    const proofHash = await this.hashProof(proofData)

    return { verified: true, proofHash }
  }

  // ============ Dependency Claims ============

  async claimDependency(
    contributorId: string,
    packageName: string,
    registryType: string,
  ): Promise<Hash> {
    if (!this.walletClient) throw new Error('Wallet client required')

    const hash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account ?? null,
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'claimDependency',
      args: [contributorId as `0x${string}`, packageName, registryType],
    })

    return hash
  }

  async verifyDependencyOwnership(
    packageName: string,
    registryType: string,
    githubToken: string,
  ): Promise<{ verified: boolean; proofHash: string; repo?: string }> {
    if (registryType === 'npm') {
      const npmResponse = await fetch(
        `https://registry.npmjs.org/${packageName}`,
      )
      if (!npmResponse.ok) {
        return { verified: false, proofHash: '' }
      }

      const npmData = expectValid(
        NpmPackageResponseSchema,
        await npmResponse.json(),
        'npm package data',
      )
      const repoUrl =
        typeof npmData.repository === 'string'
          ? npmData.repository
          : npmData.repository?.url

      if (!repoUrl) {
        return { verified: false, proofHash: '' }
      }

      const match = repoUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+)/)
      if (!match) {
        return { verified: false, proofHash: '' }
      }

      const [, owner, repo] = match

      const result = await this.verifyRepositoryOwnership(
        '',
        owner,
        repo.replace('.git', ''),
        githubToken,
      )

      if (result.verified) {
        return {
          verified: true,
          proofHash: result.proofHash,
          repo: `${owner}/${repo.replace('.git', '')}`,
        }
      }
    }

    return { verified: false, proofHash: '' }
  }

  // ============ View Functions ============

  async getContributor(
    contributorId: string,
  ): Promise<ContributorProfile | null> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributor',
      args: [contributorId as `0x${string}`],
    })) as [
      string,
      Address,
      bigint,
      number,
      string,
      bigint,
      bigint,
      bigint,
      boolean,
    ]

    if (!result || result[6] === 0n) return null

    return {
      contributorId: result[0],
      wallet: result[1],
      agentId: result[2],
      contributorType: parseContributorType(result[3]),
      profileUri: result[4],
      totalEarned: result[5],
      registeredAt: Number(result[6]),
      lastActiveAt: Number(result[7]),
      active: result[8],
    }
  }

  async getContributorByWallet(
    wallet: Address,
  ): Promise<ContributorProfile | null> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributorByWallet',
      args: [wallet],
    })) as [
      string,
      Address,
      bigint,
      number,
      string,
      bigint,
      bigint,
      bigint,
      boolean,
    ]

    if (!result || result[6] === 0n) return null

    return {
      contributorId: result[0],
      wallet: result[1],
      agentId: result[2],
      contributorType: parseContributorType(result[3]),
      profileUri: result[4],
      totalEarned: result[5],
      registeredAt: Number(result[6]),
      lastActiveAt: Number(result[7]),
      active: result[8],
    }
  }

  async getSocialLinks(contributorId: string): Promise<SocialLink[]> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getSocialLinks',
      args: [contributorId as `0x${string}`],
    })) as Array<[string, string, string, number, bigint, bigint]>

    return result.map((link) => ({
      platform: parsePlatformFromHash(link[0]),
      handle: link[1],
      proofHash: link[2],
      status: parseVerificationStatus(link[3]),
      verifiedAt: Number(link[4]),
      expiresAt: Number(link[5]),
    }))
  }

  async getRepositoryClaims(contributorId: string): Promise<RepositoryClaim[]> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getRepositoryClaims',
      args: [contributorId as `0x${string}`],
    })) as Array<
      [string, string, string, string, string, number, bigint, bigint]
    >

    return result.map((claim) => ({
      claimId: claim[0],
      contributorId: claim[1],
      owner: claim[2],
      repo: claim[3],
      proofHash: claim[4],
      status: parseVerificationStatus(claim[5]),
      claimedAt: Number(claim[6]),
      verifiedAt: Number(claim[7]),
    }))
  }

  async getDependencyClaims(contributorId: string): Promise<DependencyClaim[]> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getDependencyClaims',
      args: [contributorId as `0x${string}`],
    })) as Array<
      [string, string, string, string, string, number, bigint, bigint]
    >

    return result.map((claim) => ({
      claimId: claim[0],
      contributorId: claim[1],
      packageName: claim[2],
      registryType: claim[3],
      proofHash: claim[4],
      status: parseVerificationStatus(claim[5]),
      claimedAt: Number(claim[6]),
      verifiedAt: Number(claim[7]),
    }))
  }

  async getDAOContribution(
    contributorId: string,
    daoId: string,
  ): Promise<DAOContribution> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getDAOContribution',
      args: [contributorId as `0x${string}`, daoId as `0x${string}`],
    })) as [string, bigint, bigint, bigint, bigint]

    return {
      daoId: result[0],
      totalEarned: result[1],
      bountyCount: Number(result[2]),
      paymentRequestCount: Number(result[3]),
      lastContributionAt: Number(result[4]),
    }
  }

  async isVerifiedGitHub(contributorId: string): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'isVerifiedGitHub',
      args: [contributorId as `0x${string}`],
    })) as boolean
  }

  async getContributorForRepo(
    owner: string,
    repo: string,
  ): Promise<string | null> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributorForRepo',
      args: [owner, repo],
    })) as string

    if (result === `0x${'0'.repeat(64)}`) return null
    return result
  }

  async getContributorForDependency(
    packageName: string,
    registryType: string,
  ): Promise<string | null> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributorForDependency',
      args: [packageName, registryType],
    })) as string

    if (result === `0x${'0'.repeat(64)}`) return null
    return result
  }

  async getAllContributors(): Promise<string[]> {
    return (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getAllContributors',
    })) as string[]
  }

  async getContributorCount(): Promise<number> {
    const result = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'getContributorCount',
    })) as bigint

    return Number(result)
  }

  // ============ Helpers ============

  private async hashProof(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return `0x${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }
}

// ============ Singleton Export ============

let service: ContributorService | null = null

export function getContributorService(
  config?: ContributorServiceConfig,
): ContributorService {
  if (!service && config) {
    service = new ContributorService(config)
  }
  if (!service) {
    throw new Error('ContributorService not initialized')
  }
  return service
}

export function resetContributorService(): void {
  service = null
}
