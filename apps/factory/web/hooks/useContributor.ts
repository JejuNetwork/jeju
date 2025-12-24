import { contributorRegistryAbi } from '@jejunetwork/contracts'
import { isRecord } from '@jejunetwork/types'
import type { Address } from 'viem'
import { keccak256, toBytes } from 'viem'
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { type Hex, toHex } from '../lib/contract-types'
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

const PLATFORM_HASHES: Record<SocialPlatform, Hex> = {
  github: keccak256(toBytes('github')),
  discord: keccak256(toBytes('discord')),
  twitter: keccak256(toBytes('twitter')),
  farcaster: keccak256(toBytes('farcaster')),
}

const PLATFORM_FROM_HASH: Record<Hex, SocialPlatform> = {
  [PLATFORM_HASHES.github]: 'github',
  [PLATFORM_HASHES.discord]: 'discord',
  [PLATFORM_HASHES.twitter]: 'twitter',
  [PLATFORM_HASHES.farcaster]: 'farcaster',
}

function parsePlatformFromHash(hash: Hex): SocialPlatform {
  return PLATFORM_FROM_HASH[hash] ?? 'github'
}

// Typed return from contract
interface RawContributor {
  contributorId: Hex
  wallet: Address
  agentId: bigint
  contributorType: number
  profileUri: string
  totalEarned: bigint
  registeredAt: bigint
  lastActiveAt: bigint
  active: boolean
}

interface RawSocialLink {
  platform: Hex
  handle: string
  proofHash: Hex
  status: number
  verifiedAt: bigint
  expiresAt: bigint
}

interface RawRepositoryClaim {
  claimId: Hex
  contributorId: Hex
  owner: string
  repo: string
  proofHash: Hex
  status: number
  claimedAt: bigint
  verifiedAt: bigint
}

interface RawDependencyClaim {
  claimId: Hex
  contributorId: Hex
  packageName: string
  registryType: string
  proofHash: Hex
  status: number
  claimedAt: bigint
  verifiedAt: bigint
}

function parseContributor(data: RawContributor): ContributorProfile {
  return {
    contributorId: data.contributorId,
    wallet: data.wallet,
    agentId: data.agentId,
    contributorType: parseContributorType(data.contributorType),
    profileUri: data.profileUri,
    totalEarned: data.totalEarned,
    registeredAt: Number(data.registeredAt),
    lastActiveAt: Number(data.lastActiveAt),
    active: data.active,
  }
}

function parseSocialLink(data: RawSocialLink): SocialLink {
  return {
    platform: parsePlatformFromHash(data.platform),
    handle: data.handle,
    proofHash: data.proofHash,
    status: parseVerificationStatus(data.status),
    verifiedAt: Number(data.verifiedAt),
    expiresAt: Number(data.expiresAt),
  }
}

function parseRepositoryClaim(data: RawRepositoryClaim): RepositoryClaim {
  return {
    claimId: data.claimId,
    contributorId: data.contributorId,
    owner: data.owner,
    repo: data.repo,
    proofHash: data.proofHash,
    status: parseVerificationStatus(data.status),
    claimedAt: Number(data.claimedAt),
    verifiedAt: Number(data.verifiedAt),
  }
}

type RegistryType = DependencyClaim['registryType']

function isValidRegistryType(value: string): value is RegistryType {
  return ['npm', 'pypi', 'crates', 'maven', 'go'].includes(value)
}

function parseDependencyClaim(data: RawDependencyClaim): DependencyClaim {
  return {
    claimId: data.claimId,
    contributorId: data.contributorId,
    packageName: data.packageName,
    registryType: isValidRegistryType(data.registryType)
      ? data.registryType
      : 'npm',
    proofHash: data.proofHash,
    status: parseVerificationStatus(data.status),
    claimedAt: Number(data.claimedAt),
    verifiedAt: Number(data.verifiedAt),
  }
}

import { addresses } from '../config/contracts'

function getAddress(): Address {
  return addresses.contributorRegistry
}

function isRawContributor(data: unknown): data is RawContributor {
  return (
    isRecord(data) &&
    typeof data.contributorId === 'string' &&
    typeof data.wallet === 'string'
  )
}

function isRawSocialLinkArray(data: unknown): data is RawSocialLink[] {
  return Array.isArray(data)
}

function isRawRepositoryClaimArray(
  data: unknown,
): data is RawRepositoryClaim[] {
  return Array.isArray(data)
}

function isRawDependencyClaimArray(
  data: unknown,
): data is RawDependencyClaim[] {
  return Array.isArray(data)
}

export function useContributor(contributorId: string | undefined) {
  const contributorIdHex = contributorId ? toHex(contributorId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: contributorRegistryAbi,
    functionName: 'getContributor',
    args: contributorIdHex ? [contributorIdHex] : undefined,
    query: { enabled: !!contributorIdHex },
  })

  const profile: ContributorProfile | null = isRawContributor(data)
    ? parseContributor(data)
    : null

  return { profile, isLoading, error, refetch }
}

export function useContributorByWallet(wallet: Address | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: contributorRegistryAbi,
    functionName: 'getContributorByWallet',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!wallet },
  })

  const profile: ContributorProfile | null =
    isRawContributor(data) && data.registeredAt !== 0n
      ? parseContributor(data)
      : null

  return { profile, isLoading, error, refetch }
}

export function useSocialLinks(contributorId: string | undefined) {
  const contributorIdHex = contributorId ? toHex(contributorId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: contributorRegistryAbi,
    functionName: 'getSocialLinks',
    args: contributorIdHex ? [contributorIdHex] : undefined,
    query: { enabled: !!contributorIdHex },
  })

  const links: SocialLink[] = isRawSocialLinkArray(data)
    ? data.map(parseSocialLink)
    : []

  return { links, isLoading, error, refetch }
}

export function useRepositoryClaims(contributorId: string | undefined) {
  const contributorIdHex = contributorId ? toHex(contributorId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: contributorRegistryAbi,
    functionName: 'getRepositoryClaims',
    args: contributorIdHex ? [contributorIdHex] : undefined,
    query: { enabled: !!contributorIdHex },
  })

  const claims: RepositoryClaim[] = isRawRepositoryClaimArray(data)
    ? data.map(parseRepositoryClaim)
    : []

  return { claims, isLoading, error, refetch }
}

export function useDependencyClaims(contributorId: string | undefined) {
  const contributorIdHex = contributorId ? toHex(contributorId) : undefined
  const { data, isLoading, error, refetch } = useReadContract({
    address: getAddress(),
    abi: contributorRegistryAbi,
    functionName: 'getDependencyClaims',
    args: contributorIdHex ? [contributorIdHex] : undefined,
    query: { enabled: !!contributorIdHex },
  })

  const claims: DependencyClaim[] = isRawDependencyClaimArray(data)
    ? data.map(parseDependencyClaim)
    : []

  return { claims, isLoading, error, refetch }
}

export function useContributorCount() {
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: contributorRegistryAbi,
    functionName: 'getContributorCount',
  })

  return { count: data ? Number(data) : 0, isLoading, error }
}

export function useIsVerifiedGitHub(contributorId: string | undefined) {
  const contributorIdHex = contributorId ? toHex(contributorId) : undefined
  const { data, isLoading, error } = useReadContract({
    address: getAddress(),
    abi: contributorRegistryAbi,
    functionName: 'isVerifiedGitHub',
    args: contributorIdHex ? [contributorIdHex] : undefined,
    query: { enabled: !!contributorIdHex },
  })

  return { isVerified: !!data, isLoading, error }
}

export function useRegisterContributor() {
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  const register = (contributorType: ContributorType, profileUri: string) => {
    writeContract({
      address: getAddress(),
      abi: contributorRegistryAbi,
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
      abi: contributorRegistryAbi,
      functionName: 'addSocialLink',
      args: [toHex(contributorId), PLATFORM_HASHES[platform], handle],
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
      abi: contributorRegistryAbi,
      functionName: 'claimRepository',
      args: [toHex(contributorId), owner, repo],
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
      abi: contributorRegistryAbi,
      functionName: 'claimDependency',
      args: [toHex(contributorId), packageName, registryType],
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
      abi: contributorRegistryAbi,
      functionName: 'linkAgent',
      args: [toHex(contributorId), agentId],
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
      abi: contributorRegistryAbi,
      functionName: 'updateProfile',
      args: [toHex(contributorId), profileUri],
    })
  }

  return { updateProfile, hash, isPending, isConfirming, isSuccess, error }
}
