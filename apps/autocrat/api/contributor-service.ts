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

import { contributorRegistryAbi } from '@jejunetwork/contracts'
import { expectValid } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  type Hash,
  keccak256,
  type PublicClient,
  toBytes,
  type WalletClient,
} from 'viem'
import {
  expectValidResponse,
  GitHubRepoPermissionsSchema,
  GitHubTokenResponseSchema,
  GitHubUserProfileSchema,
  NpmPackageResponseSchema,
  toHex,
} from '../lib'

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
const PLATFORM_HASHES: Record<SocialPlatform, `0x${string}`> = {
  github: keccak256(toBytes('github')),
  discord: keccak256(toBytes('discord')),
  twitter: keccak256(toBytes('twitter')),
  farcaster: keccak256(toBytes('farcaster')),
}
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
      abi: contributorRegistryAbi,
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
      abi: contributorRegistryAbi,
      functionName: 'linkAgent',
      args: [toHex(contributorId), agentId],
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
      abi: contributorRegistryAbi,
      functionName: 'updateProfile',
      args: [toHex(contributorId), profileUri],
    })

    return hash
  }
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
      abi: contributorRegistryAbi,
      functionName: 'addSocialLink',
      args: [toHex(contributorId), toHex(platformHash), handle],
    })

    return hash
  }
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
      abi: contributorRegistryAbi,
      functionName: 'claimRepository',
      args: [toHex(contributorId), owner, repo],
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
      abi: contributorRegistryAbi,
      functionName: 'claimDependency',
      args: [toHex(contributorId), packageName, registryType],
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
  async getContributor(
    contributorId: string,
  ): Promise<ContributorProfile | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getContributor',
      args: [toHex(contributorId)],
    })

    if (!result || result.registeredAt === 0n) return null

    return {
      contributorId: result.contributorId,
      wallet: result.wallet,
      agentId: result.agentId,
      contributorType: parseContributorType(result.contributorType),
      profileUri: result.profileUri,
      totalEarned: result.totalEarned,
      registeredAt: Number(result.registeredAt),
      lastActiveAt: Number(result.lastActiveAt),
      active: result.active,
    }
  }

  async getContributorByWallet(
    wallet: Address,
  ): Promise<ContributorProfile | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getContributorByWallet',
      args: [wallet],
    })

    if (!result || result.registeredAt === 0n) return null

    return {
      contributorId: result.contributorId,
      wallet: result.wallet,
      agentId: result.agentId,
      contributorType: parseContributorType(result.contributorType),
      profileUri: result.profileUri,
      totalEarned: result.totalEarned,
      registeredAt: Number(result.registeredAt),
      lastActiveAt: Number(result.lastActiveAt),
      active: result.active,
    }
  }

  async getSocialLinks(contributorId: string): Promise<SocialLink[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getSocialLinks',
      args: [toHex(contributorId)],
    })

    return result.map((link) => ({
      platform: parsePlatformFromHash(link.platform),
      handle: link.handle,
      proofHash: link.proofHash,
      status: parseVerificationStatus(link.status),
      verifiedAt: Number(link.verifiedAt),
      expiresAt: Number(link.expiresAt),
    }))
  }

  async getRepositoryClaims(contributorId: string): Promise<RepositoryClaim[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getRepositoryClaims',
      args: [toHex(contributorId)],
    })

    return result.map((claim) => ({
      claimId: claim.claimId,
      contributorId: claim.contributorId,
      owner: claim.owner,
      repo: claim.repo,
      proofHash: claim.proofHash,
      status: parseVerificationStatus(claim.status),
      claimedAt: Number(claim.claimedAt),
      verifiedAt: Number(claim.verifiedAt),
    }))
  }

  async getDependencyClaims(contributorId: string): Promise<DependencyClaim[]> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getDependencyClaims',
      args: [toHex(contributorId)],
    })

    return result.map((claim) => ({
      claimId: claim.claimId,
      contributorId: claim.contributorId,
      packageName: claim.packageName,
      registryType: claim.registryType,
      proofHash: claim.proofHash,
      status: parseVerificationStatus(claim.status),
      claimedAt: Number(claim.claimedAt),
      verifiedAt: Number(claim.verifiedAt),
    }))
  }

  async getDAOContribution(
    contributorId: string,
    daoId: string,
  ): Promise<DAOContribution> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getDAOContribution',
      args: [toHex(contributorId), toHex(daoId)],
    })

    return {
      daoId: result.daoId,
      totalEarned: result.totalEarned,
      bountyCount: Number(result.bountyCount),
      paymentRequestCount: Number(result.paymentRequestCount),
      lastContributionAt: Number(result.lastContributionAt),
    }
  }

  async isVerifiedGitHub(contributorId: string): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'isVerifiedGitHub',
      args: [toHex(contributorId)],
    })
  }

  async getContributorForRepo(
    owner: string,
    repo: string,
  ): Promise<`0x${string}` | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getContributorForRepo',
      args: [owner, repo],
    })

    if (result === `0x${'0'.repeat(64)}`) return null
    return result
  }

  async getContributorForDependency(
    packageName: string,
    registryType: string,
  ): Promise<`0x${string}` | null> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getContributorForDependency',
      args: [packageName, registryType],
    })

    if (result === `0x${'0'.repeat(64)}`) return null
    return result
  }

  async getAllContributors(): Promise<readonly `0x${string}`[]> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getAllContributors',
    })
  }

  async getContributorCount(): Promise<number> {
    const result = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: contributorRegistryAbi,
      functionName: 'getContributorCount',
    })

    return Number(result)
  }
  private async hashProof(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return `0x${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }
}
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
