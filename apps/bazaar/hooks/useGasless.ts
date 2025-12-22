/**
 * Gasless Transaction Hook for Hyperscape
 *
 * Uses the SponsoredPaymaster for free transactions.
 * Falls back to standard transactions if paymaster unavailable.
 *
 * Architecture:
 * 1. Check if SponsoredPaymaster is available and funded
 * 2. Check if user is within rate limits
 * 3. Build UserOperation with paymaster sponsorship
 * 4. Submit via bundler or direct execution
 */

import { AddressSchema } from '@jejunetwork/types'
import { useCallback, useEffect, useState } from 'react'
import {
  type Abi,
  type Address,
  encodeFunctionData,
  encodePacked,
  parseEther,
} from 'viem'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { getGameContracts } from '@/config/contracts'
import { expect } from '@/lib/validation'

// ============ Constants ============

const ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const
const BUNDLER_URL = process.env.NEXT_PUBLIC_BUNDLER_URL || null

// Client-side rate limiting to prevent abuse
const MIN_TX_INTERVAL_MS = 3000 // Minimum 3 seconds between transactions
const lastTxTimestamp = { value: 0 }

// ============ ABIs ============

const SPONSORED_PAYMASTER_ABI = [
  {
    name: 'canSponsor',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'target', type: 'address' },
      { name: 'gasCost', type: 'uint256' },
    ],
    outputs: [
      { name: 'sponsored', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    name: 'getRemainingTx',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'remaining', type: 'uint256' }],
  },
  {
    name: 'getStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'deposit', type: 'uint256' },
      { name: 'isPaused', type: 'bool' },
      { name: 'totalTx', type: 'uint256' },
      { name: 'totalGas', type: 'uint256' },
    ],
  },
  {
    name: 'maxGasCost',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'maxTxPerUserPerHour',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// ============ Types ============

export interface GaslessConfig {
  paymasterAddress: Address
  entryPointAddress?: Address
  bundlerUrl?: string | null
}

export interface SponsorshipStatus {
  isAvailable: boolean
  remainingTx: number
  maxTxPerHour: number
  reason: string
}

export interface GaslessWriteResult {
  hash: `0x${string}` | undefined
  isPending: boolean
  isSuccess: boolean
  error: Error | null
  isSponsored: boolean
}

// ============ Hook: Check Sponsorship Status ============

export function useSponsorshipStatus(): SponsorshipStatus & {
  isLoading: boolean
  refetch: () => void
} {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const [status, setStatus] = useState<SponsorshipStatus>({
    isAvailable: false,
    remainingTx: 0,
    maxTxPerHour: 100,
    reason: 'Not connected',
  })
  const [isLoading, setIsLoading] = useState(true)

  const gameContracts = getGameContracts(JEJU_CHAIN_ID)
  const paymasterAddress = gameContracts.sponsoredPaymaster

  const checkStatus = useCallback(async () => {
    if (!address || !publicClient || !paymasterAddress) {
      setStatus({
        isAvailable: false,
        remainingTx: 0,
        maxTxPerHour: 100,
        reason: !address ? 'Not connected' : 'Paymaster not configured',
      })
      setIsLoading(false)
      return
    }

    const validatedAddress = expect(address, 'Address is required')
    const validatedPublicClient = expect(
      publicClient,
      'Public client is required',
    )
    const validatedPaymasterAddress = expect(
      paymasterAddress,
      'Paymaster address is required',
    )

    setIsLoading(true)

    // Check paymaster status
    const [paymasterStatus, remaining, maxTx] = await Promise.all([
      validatedPublicClient
        .readContract({
          address: validatedPaymasterAddress,
          abi: SPONSORED_PAYMASTER_ABI,
          functionName: 'getStatus',
        })
        .catch(() => null),
      validatedPublicClient
        .readContract({
          address: validatedPaymasterAddress,
          abi: SPONSORED_PAYMASTER_ABI,
          functionName: 'getRemainingTx',
          args: [validatedAddress],
        })
        .catch(() => 0n),
      validatedPublicClient
        .readContract({
          address: validatedPaymasterAddress,
          abi: SPONSORED_PAYMASTER_ABI,
          functionName: 'maxTxPerUserPerHour',
        })
        .catch(() => 100n),
    ])

    if (!paymasterStatus) {
      setStatus({
        isAvailable: false,
        remainingTx: 0,
        maxTxPerHour: Number(maxTx),
        reason: 'Paymaster not deployed',
      })
      setIsLoading(false)
      setIsLoading(false)
      return
    }

    const [deposit, isPaused] = paymasterStatus as [
      bigint,
      boolean,
      bigint,
      bigint,
    ]

    if (isPaused) {
      setStatus({
        isAvailable: false,
        remainingTx: Number(remaining),
        maxTxPerHour: Number(maxTx),
        reason: 'Paymaster is paused',
      })
    } else if (deposit < parseEther('0.01')) {
      setStatus({
        isAvailable: false,
        remainingTx: Number(remaining),
        maxTxPerHour: Number(maxTx),
        reason: 'Paymaster low on funds',
      })
    } else if (Number(remaining) === 0) {
      setStatus({
        isAvailable: false,
        remainingTx: 0,
        maxTxPerHour: Number(maxTx),
        reason: 'Rate limit reached',
      })
    } else {
      setStatus({
        isAvailable: true,
        remainingTx: Number(remaining),
        maxTxPerHour: Number(maxTx),
        reason: '',
      })
    }

    setIsLoading(false)
  }, [address, publicClient, paymasterAddress])

  useEffect(() => {
    checkStatus()
    // Refresh every 30 seconds
    const interval = setInterval(checkStatus, 30000)
    return () => clearInterval(interval)
  }, [checkStatus])

  return { ...status, isLoading, refetch: checkStatus }
}

// ============ Hook: Gasless Contract Write ============

export function useGaslessWrite<TAbi extends Abi>(): {
  writeGasless: (params: {
    address: Address
    abi: TAbi
    functionName: string
    args?: readonly unknown[]
  }) => Promise<`0x${string}` | null>
  result: GaslessWriteResult
  sponsorship: SponsorshipStatus
} {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const sponsorship = useSponsorshipStatus()

  const [result, setResult] = useState<GaslessWriteResult>({
    hash: undefined,
    isPending: false,
    isSuccess: false,
    error: null,
    isSponsored: false,
  })

  const gameContracts = getGameContracts(JEJU_CHAIN_ID)
  const paymasterAddress = gameContracts.sponsoredPaymaster

  const writeGasless = useCallback(
    async (params: {
      address: Address
      abi: TAbi
      functionName: string
      args?: readonly unknown[]
    }): Promise<`0x${string}` | null> => {
      // Client-side rate limiting to prevent abuse
      const now = Date.now()
      const timeSinceLastTx = now - lastTxTimestamp.value
      if (timeSinceLastTx < MIN_TX_INTERVAL_MS) {
        const waitTime = Math.ceil(
          (MIN_TX_INTERVAL_MS - timeSinceLastTx) / 1000,
        )
        setResult({
          hash: undefined,
          isPending: false,
          isSuccess: false,
          error: new Error(`Please wait ${waitTime}s before next transaction`),
          isSponsored: false,
        })
        return null
      }
      lastTxTimestamp.value = now

      const validatedAddress = expect(address, 'Wallet not connected')
      const validatedPublicClient = expect(
        publicClient,
        'Public client not available',
      )
      const validatedWalletClient = expect(
        walletClient,
        'Wallet client not available',
      )
      AddressSchema.parse(params.address)

      setResult({
        hash: undefined,
        isPending: true,
        isSuccess: false,
        error: null,
        isSponsored: false,
      })

      // Encode the call data
      const callData = encodeFunctionData({
        abi: params.abi as Abi,
        functionName: params.functionName,
        args: params.args,
      })

      // Check if we can use gasless
      let canUseGasless = false
      if (sponsorship.isAvailable && paymasterAddress) {
        const validatedPaymasterAddress = expect(
          paymasterAddress,
          'Paymaster address is required',
        )
        const [canSponsor] = await validatedPublicClient
          .readContract({
            address: validatedPaymasterAddress,
            abi: SPONSORED_PAYMASTER_ABI,
            functionName: 'canSponsor',
            args: [validatedAddress, params.address, parseEther('0.005')], // Estimate ~0.005 ETH gas
          })
          .catch(() => [false, 'Error checking sponsorship'])

        canUseGasless = canSponsor as boolean
      }

      // If bundler is available and sponsorship works, use ERC-4337
      if (canUseGasless && BUNDLER_URL && paymasterAddress) {
        const validatedPaymasterAddress = expect(
          paymasterAddress,
          'Paymaster address is required',
        )
        const hash = await submitViaUserOperation(
          validatedAddress,
          params.address,
          callData,
          validatedPaymasterAddress,
          validatedPublicClient,
        )

        if (hash) {
          setResult({
            hash,
            isPending: false,
            isSuccess: true,
            error: null,
            isSponsored: true,
          })
          return hash
        }
        // Fall through to regular transaction if bundler fails
      }

      // Fallback: Regular transaction (user pays gas)
      const hash = await validatedWalletClient.sendTransaction({
        to: params.address,
        data: callData,
        account: validatedAddress,
      })

      // Wait for confirmation
      const receipt = await validatedPublicClient.waitForTransactionReceipt({
        hash,
      })

      setResult({
        hash,
        isPending: false,
        isSuccess: receipt.status === 'success',
        error:
          receipt.status !== 'success' ? new Error('Transaction failed') : null,
        isSponsored: false,
      })

      return hash
    },
    [
      address,
      publicClient,
      walletClient,
      sponsorship.isAvailable,
      paymasterAddress,
    ],
  )

  return { writeGasless, result, sponsorship }
}

// ============ Helper: Submit via ERC-4337 Bundler ============

async function submitViaUserOperation(
  sender: Address,
  _target: Address,
  callData: `0x${string}`,
  paymaster: Address,
  _publicClient: ReturnType<typeof usePublicClient>,
): Promise<`0x${string}` | null> {
  if (!BUNDLER_URL) return null

  // Build UserOperation
  const userOp = {
    sender,
    nonce: '0x0',
    initCode: '0x',
    callData,
    callGasLimit: '0x30D40', // 200000
    verificationGasLimit: '0x30D40', // 200000
    preVerificationGas: '0x5208', // 21000
    maxFeePerGas: '0x3B9ACA00', // 1 gwei
    maxPriorityFeePerGas: '0x3B9ACA00', // 1 gwei
    paymasterAndData: buildPaymasterData(paymaster),
    signature: '0x',
  }

  // Submit to bundler
  const response = await fetch(BUNDLER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendUserOperation',
      params: [userOp, ENTRYPOINT_V07],
    }),
  })

  const result = (await response.json()) as {
    result?: string
    error?: { message: string }
  }

  if (result.error) {
    console.error('Bundler error:', result.error.message)
    return null
  }

  // Get transaction hash from UserOperation hash
  if (result.result) {
    // Wait for the UserOperation to be mined
    const receipt = await waitForUserOpReceipt(result.result)
    return receipt
  }

  return null
}

function buildPaymasterData(paymaster: Address): `0x${string}` {
  // paymaster (20 bytes) + verificationGasLimit (16 bytes) + postOpGasLimit (16 bytes)
  return encodePacked(
    ['address', 'uint128', 'uint128'],
    [paymaster, 100000n, 50000n],
  )
}

async function waitForUserOpReceipt(
  userOpHash: string,
): Promise<`0x${string}` | null> {
  if (!BUNDLER_URL) return null

  const maxAttempts = 30
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(BUNDLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getUserOperationReceipt',
        params: [userOpHash],
      }),
    })

    const result = (await response.json()) as {
      result?: { receipt?: { transactionHash: `0x${string}` } }
    }

    if (result.result?.receipt?.transactionHash) {
      return result.result.receipt.transactionHash
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  return null
}

// ============ Export Convenience Hooks ============

export { ENTRYPOINT_V07, BUNDLER_URL }
