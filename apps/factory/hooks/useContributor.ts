'use client'

import type { Address } from 'viem'
import { keccak256, parseAbi, toBytes } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import type {
  ContributorProfile,
  ContributorType,
  DependencyClaim,
  RepositoryClaim,
  SocialLink,
  SocialPlatform,
} from '../types/funding'
import {
  getContributorTypeIndex,
  parseContributorType,
  parseVerificationStatus,
} from '../types/funding'

// ============ Contract ABI ============

const CONTRIBUTOR_REGISTRY_ABI = parseAbi([
  'function register(uint8 contributorType, string profileUri) external returns (bytes32 contributorId)',
  'function linkAgent(bytes32 contributorId, uint256 agentId) external',
  'function updateProfile(bytes32 contributorId, string profileUri) external',
  'function deactivate(bytes32 contributorId) external',
  'function reactivate(bytes32 contributorId) external',
  'function addSocialLink(bytes32 contributorId, bytes32 platform, string handle) external',
  'function claimRepository(bytes32 contributorId, string owner, string repo) external returns (bytes32 claimId)',
  'function claimDependency(bytes32 contributorId, string packageName, string registryType) external returns (bytes32 claimId)',
  'function getContributor(bytes32 contributorId) external view returns (tuple(bytes32 contributorId, address wallet, uint256 agentId, uint8 contributorType, string profileUri, uint256 totalEarned, uint256 registeredAt, uint256 lastActiveAt, bool active))',
  'function getContributorByWallet(address wallet) external view returns (tuple(bytes32 contributorId, address wallet, uint256 agentId, uint8 contributorType, string profileUri, uint256 totalEarned, uint256 registeredAt, uint256 lastActiveAt, bool active))',
  'function getSocialLinks(bytes32 contributorId) external view returns (tuple(bytes32 platform, string handle, bytes32 proofHash, uint8 status, uint256 verifiedAt, uint256 expiresAt)[])',
  'function getRepositoryClaims(bytes32 contributorId) external view returns (tuple(bytes32 claimId, bytes32 contributorId, string owner, string repo, bytes32 proofHash, uint8 status, uint256 claimedAt, uint256 verifiedAt)[])',
  'function getDependencyClaims(bytes32 contributorId) external view returns (tuple(bytes32 claimId, bytes32 contributorId, string packageName, string registryType, bytes32 proofHash, uint8 status, uint256 claimedAt, uint256 verifiedAt)[])',
  'function getDAOContribution(bytes32 contributorId, bytes32 daoId) external view returns (tuple(bytes32 daoId, uint256 totalEarned, uint256 bountyCount, uint256 paymentRequestCount, uint256 lastContributionAt))',
  'function isVerifiedGitHub(bytes32 contributorId) external view returns (bool)',
  'function getAllContributors() external view returns (bytes32[])',
  'function getContributorCount() external view returns (uint256)',
])

// ============ Platform Hash Helpers ============

const PLATFORM_HASHES: Record<SocialPlatform, `0x${string}`> = {
  github: keccak256(toBytes('github')),
  discord: keccak256(toBytes('discord')),
  twitter: keccak256(toBytes('twitter')),
  farcaster: keccak256(toBytes('farcaster')),
}

function parsePlatformFromHash(hash: string): SocialPlatform {
  for (const [platform, platformHash] of Object.entries(PLATFORM_HASHES)) {
    if (platformHash === hash) {
      return platform as SocialPlatform
    }
  }
  return 'github'
}

// ============ Config ============

import { addresses } from '../config/contracts'

function getAddress(): Address {
  return addresses.contributorRegistry
}

// ============ Read Hooks ============

export function useContributor(contributorId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: CONTRIBUTOR_REGISTRY_ABI,
    functionName: 'getContributor',
    args: contributorId ? [contributorId as `0x${string}`] : undefined,
    query: { enabled: !!contributorId },
  })

  const profile: ContributorProfile | null = data
    ? {
        contributorId: (data as [string])[0],
        wallet: (data as [string, Address])[1],
        agentId: (data as [string, Address, bigint])[2],
        contributorType: parseContributorType(
          (data as [string, Address, bigint, number])[3],
        ),
        profileUri: (data as [string, Address, bigint, number, string])[4],
        totalEarned: (
          data as [string, Address, bigint, number, string, bigint]
        )[5],
        registeredAt: Number(
          (
            data as [string, Address, bigint, number, string, bigint, bigint]
          )[6],
        ),
        lastActiveAt: Number(
          (
            data as [
              string,
              Address,
              bigint,
              number,
              string,
              bigint,
              bigint,
              bigint,
            ]
          )[7],
        ),
        active: (
          data as [
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
        )[8],
      }
    : null

  return { profile, isLoading, error, refetch }
}

export function useContributorByWallet(wallet: Address | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: CONTRIBUTOR_REGISTRY_ABI,
    functionName: 'getContributorByWallet',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!wallet },
  })

  const profile: ContributorProfile | null =
    data &&
    (data as [string, Address, bigint, number, string, bigint, bigint])[6] !==
      0n
      ? {
          contributorId: (data as [string])[0],
          wallet: (data as [string, Address])[1],
          agentId: (data as [string, Address, bigint])[2],
          contributorType: parseContributorType(
            (data as [string, Address, bigint, number])[3],
          ),
          profileUri: (data as [string, Address, bigint, number, string])[4],
          totalEarned: (
            data as [string, Address, bigint, number, string, bigint]
          )[5],
          registeredAt: Number(
            (
              data as [string, Address, bigint, number, string, bigint, bigint]
            )[6],
          ),
          lastActiveAt: Number(
            (
              data as [
                string,
                Address,
                bigint,
                number,
                string,
                bigint,
                bigint,
                bigint,
              ]
            )[7],
          ),
          active: (
            data as [
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
          )[8],
        }
      : null

  return { profile, isLoading, error, refetch }
}

export function useSocialLinks(contributorId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: CONTRIBUTOR_REGISTRY_ABI,
    functionName: 'getSocialLinks',
    args: contributorId ? [contributorId as `0x${string}`] : undefined,
    query: { enabled: !!contributorId },
  })

  const links: SocialLink[] = data
    ? (data as Array<[string, string, string, number, bigint, bigint]>).map(
        (link) => ({
          platform: parsePlatformFromHash(link[0]),
          handle: link[1],
          proofHash: link[2],
          status: parseVerificationStatus(link[3]),
          verifiedAt: Number(link[4]),
          expiresAt: Number(link[5]),
        }),
      )
    : []

  return { links, isLoading, error, refetch }
}

export function useRepositoryClaims(contributorId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: CONTRIBUTOR_REGISTRY_ABI,
    functionName: 'getRepositoryClaims',
    args: contributorId ? [contributorId as `0x${string}`] : undefined,
    query: { enabled: !!contributorId },
  })

  const claims: RepositoryClaim[] = data
    ? (
        data as Array<
          [string, string, string, string, string, number, bigint, bigint]
        >
      ).map((claim) => ({
        claimId: claim[0],
        contributorId: claim[1],
        owner: claim[2],
        repo: claim[3],
        proofHash: claim[4],
        status: parseVerificationStatus(claim[5]),
        claimedAt: Number(claim[6]),
        verifiedAt: Number(claim[7]),
      }))
    : []

  return { claims, isLoading, error, refetch }
}

export function useDependencyClaims(contributorId: string | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: CONTRIBUTOR_REGISTRY_ABI,
    functionName: 'getDependencyClaims',
    args: contributorId ? [contributorId as `0x${string}`] : undefined,
    query: { enabled: !!contributorId },
  })

  const claims: DependencyClaim[] = data
    ? (
        data as Array<
          [string, string, string, string, string, number, bigint, bigint]
        >
      ).map((claim) => ({
        claimId: claim[0],
        contributorId: claim[1],
        packageName: claim[2],
        registryType: claim[3] as DependencyClaim['registryType'],
        proofHash: claim[4],
        status: parseVerificationStatus(claim[5]),
        claimedAt: Number(claim[6]),
        verifiedAt: Number(claim[7]),
      }))
    : []

  return { claims, isLoading, error, refetch }
}

export function useContributorCount() {
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: CONTRIBUTOR_REGISTRY_ABI,
    functionName: 'getContributorCount',
  })

  return { count: data ? Number(data) : 0, isLoading, error }
}

export function useIsVerifiedGitHub(contributorId: string | undefined) {
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: CONTRIBUTOR_REGISTRY_ABI,
    functionName: 'isVerifiedGitHub',
    args: contributorId ? [contributorId as `0x${string}`] : undefined,
    query: { enabled: !!contributorId },
  })

  return { isVerified: !!data, isLoading, error }
}

// ============ Write Hooks ============

export function useRegisterContributor() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const register = (contributorType: ContributorType, profileUri: string) => {
    writeContract({
      address: getAddress(),
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'register',
      args: [getContributorTypeIndex(contributorType), profileUri],
    })
  }

  return { register, hash, isPending, isConfirming, isSuccess, error }
}

export function useAddSocialLink() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const addSocialLink = (
    contributorId: string,
    platform: SocialPlatform,
    handle: string,
  ) => {
    writeContract({
      address: getAddress(),
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'addSocialLink',
      args: [contributorId as `0x${string}`, PLATFORM_HASHES[platform], handle],
    })
  }

  return { addSocialLink, hash, isPending, isConfirming, isSuccess, error }
}

export function useClaimRepository() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const claimRepository = (
    contributorId: string,
    owner: string,
    repo: string,
  ) => {
    writeContract({
      address: getAddress(),
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'claimRepository',
      args: [contributorId as `0x${string}`, owner, repo],
    })
  }

  return { claimRepository, hash, isPending, isConfirming, isSuccess, error }
}

export function useClaimDependency() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const claimDependency = (
    contributorId: string,
    packageName: string,
    registryType: string,
  ) => {
    writeContract({
      address: getAddress(),
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'claimDependency',
      args: [contributorId as `0x${string}`, packageName, registryType],
    })
  }

  return { claimDependency, hash, isPending, isConfirming, isSuccess, error }
}

export function useLinkAgent() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const linkAgent = (contributorId: string, agentId: bigint) => {
    writeContract({
      address: getAddress(),
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'linkAgent',
      args: [contributorId as `0x${string}`, agentId],
    })
  }

  return { linkAgent, hash, isPending, isConfirming, isSuccess, error }
}

export function useUpdateProfile() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const updateProfile = (contributorId: string, profileUri: string) => {
    writeContract({
      address: getAddress(),
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'updateProfile',
      args: [contributorId as `0x${string}`, profileUri],
    })
  }

  return { updateProfile, hash, isPending, isConfirming, isSuccess, error }
}
