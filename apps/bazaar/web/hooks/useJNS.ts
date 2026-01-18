/**
 * JNS (Jeju Name Service) Hook
 *
 * Provides real contract integration for:
 * - Name availability checking
 * - Name registration
 * - Name renewal
 * - User's owned names
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { type Address, keccak256, toBytes } from 'viem'
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CONTRACTS } from '../../config'
import {
  calculateRegistrationPriceWei,
  formatFullName,
  normalizeName,
  SECONDS_PER_DAY,
  validateName,
} from '../../lib/jns'

const JNS_REGISTRAR_ABI = [
  {
    inputs: [{ name: 'name', type: 'string' }],
    name: 'available',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'rentPrice',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'name', type: 'string' }],
    name: 'nameExpires',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'name', type: 'string' }],
    name: 'ownerOf',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'register',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'renew',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'labelhash', type: 'bytes32' }],
    name: 'getName',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export interface JNSName {
  name: string
  fullName: string
  labelhash: `0x${string}`
  owner: Address
  expiresAt: number
  isExpired: boolean
}

export function useJNSRegistrarAddress(): Address | null {
  return CONTRACTS.jnsRegistrar !== '0x0000000000000000000000000000000000000000'
    ? CONTRACTS.jnsRegistrar
    : null
}

/**
 * Check if a name is available for registration
 */
export function useNameAvailability(name: string) {
  const publicClient = usePublicClient()
  const registrarAddress = useJNSRegistrarAddress()
  const normalized = normalizeName(name)
  const validation = validateName(normalized)

  return useQuery({
    queryKey: ['jns-availability', normalized],
    queryFn: async () => {
      if (!publicClient || !registrarAddress) {
        throw new Error('JNS not available')
      }
      if (!validation.valid) {
        return { available: false, reason: validation.error }
      }

      const isAvailable = await publicClient.readContract({
        address: registrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'available',
        args: [normalized],
      })

      if (!isAvailable) {
        // Check who owns it
        const owner = await publicClient.readContract({
          address: registrarAddress,
          abi: JNS_REGISTRAR_ABI,
          functionName: 'ownerOf',
          args: [normalized],
        })
        return {
          available: false,
          reason: 'Name is already registered',
          owner: owner as Address,
        }
      }

      return { available: true, reason: null }
    },
    enabled: normalized.length >= 3 && !!registrarAddress,
    staleTime: 10000,
  })
}

/**
 * Get registration price for a name
 */
export function useRegistrationPrice(name: string, durationDays: number) {
  const publicClient = usePublicClient()
  const registrarAddress = useJNSRegistrarAddress()
  const normalized = normalizeName(name)
  const durationSeconds = BigInt(durationDays * SECONDS_PER_DAY)

  return useQuery({
    queryKey: ['jns-price', normalized, durationDays],
    queryFn: async () => {
      if (!publicClient || !registrarAddress) {
        // Fallback to local calculation
        return calculateRegistrationPriceWei(normalized, durationDays)
      }

      const price = await publicClient.readContract({
        address: registrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'rentPrice',
        args: [normalized, durationSeconds],
      })

      return price
    },
    enabled: normalized.length >= 3,
    staleTime: 60000,
  })
}

/**
 * Register a JNS name
 */
export function useRegisterName() {
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const registrarAddress = useJNSRegistrarAddress()
  const { writeContractAsync } = useWriteContract()
  const [pendingTxHash, setPendingTxHash] = useState<
    `0x${string}` | undefined
  >()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  const register = useCallback(
    async (name: string, durationDays: number) => {
      if (!address || !publicClient || !registrarAddress) {
        throw new Error('Wallet not connected or JNS not available')
      }

      const normalized = normalizeName(name)
      const validation = validateName(normalized)
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      const durationSeconds = BigInt(durationDays * SECONDS_PER_DAY)

      // Get the price
      const price = await publicClient.readContract({
        address: registrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'rentPrice',
        args: [normalized, durationSeconds],
      })

      // Register the name
      const hash = await writeContractAsync({
        address: registrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'register',
        args: [normalized, address, durationSeconds],
        value: price,
      })

      setPendingTxHash(hash)

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      // Invalidate queries
      queryClient.invalidateQueries({
        queryKey: ['jns-availability', normalized],
      })
      queryClient.invalidateQueries({ queryKey: ['jns-user-names', address] })

      toast.success(`Successfully registered ${formatFullName(normalized)}`)

      return { hash, receipt }
    },
    [address, publicClient, registrarAddress, writeContractAsync, queryClient],
  )

  return {
    register,
    isLoading: isConfirming,
    isSuccess,
    pendingTxHash,
  }
}

/**
 * Renew a JNS name
 */
export function useRenewName() {
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const registrarAddress = useJNSRegistrarAddress()
  const { writeContractAsync } = useWriteContract()
  const [pendingTxHash, setPendingTxHash] = useState<
    `0x${string}` | undefined
  >()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  })

  const renew = useCallback(
    async (name: string, durationDays: number) => {
      if (!address || !publicClient || !registrarAddress) {
        throw new Error('Wallet not connected or JNS not available')
      }

      const normalized = normalizeName(name)
      const durationSeconds = BigInt(durationDays * SECONDS_PER_DAY)

      const price = await publicClient.readContract({
        address: registrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'rentPrice',
        args: [normalized, durationSeconds],
      })

      const hash = await writeContractAsync({
        address: registrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'renew',
        args: [normalized, durationSeconds],
        value: price,
      })

      setPendingTxHash(hash)

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      queryClient.invalidateQueries({ queryKey: ['jns-user-names', address] })

      toast.success(`Successfully renewed ${formatFullName(normalized)}`)

      return { hash, receipt }
    },
    [address, publicClient, registrarAddress, writeContractAsync, queryClient],
  )

  return {
    renew,
    isLoading: isConfirming,
    isSuccess,
    pendingTxHash,
  }
}

/**
 * Get all names owned by an address
 */
export function useUserNames(userAddress?: Address) {
  const publicClient = usePublicClient()
  const registrarAddress = useJNSRegistrarAddress()

  return useQuery({
    queryKey: ['jns-user-names', userAddress],
    queryFn: async (): Promise<JNSName[]> => {
      if (!publicClient || !registrarAddress || !userAddress) {
        return []
      }

      // Get balance (number of names owned)
      const balance = await publicClient.readContract({
        address: registrarAddress,
        abi: JNS_REGISTRAR_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      })

      const names: JNSName[] = []
      const now = Math.floor(Date.now() / 1000)

      for (let i = 0n; i < balance; i++) {
        // Get token ID at index
        const tokenId = await publicClient.readContract({
          address: registrarAddress,
          abi: JNS_REGISTRAR_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [userAddress, i],
        })

        // Get name from labelhash
        const name = await publicClient.readContract({
          address: registrarAddress,
          abi: JNS_REGISTRAR_ABI,
          functionName: 'getName',
          args: [
            `0x${tokenId.toString(16).padStart(64, '0')}` as `0x${string}`,
          ],
        })

        // Get expiration
        const expiresAt = await publicClient.readContract({
          address: registrarAddress,
          abi: JNS_REGISTRAR_ABI,
          functionName: 'nameExpires',
          args: [name],
        })

        const labelhash = keccak256(toBytes(name))

        names.push({
          name,
          fullName: formatFullName(name),
          labelhash,
          owner: userAddress,
          expiresAt: Number(expiresAt),
          isExpired: Number(expiresAt) <= now,
        })
      }

      return names
    },
    enabled: !!userAddress && !!registrarAddress,
    staleTime: 30000,
  })
}
