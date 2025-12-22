import { AddressSchema } from '@jejunetwork/types'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { CONTRACTS } from '../../config'
import { expect } from '../../lib/validation'
import { NonEmptyStringSchema } from '../../schemas/common'

const PREDIMARKET_ADDRESS = CONTRACTS.predimarket

const PREDIMARKET_ABI = [
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'sessionId', type: 'bytes32' }],
    outputs: [{ name: 'payout', type: 'uint256' }],
  },
] as const

export function useClaim(sessionId: string) {
  const validatedSessionId = NonEmptyStringSchema.parse(sessionId)
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  useEffect(() => {
    if (isSuccess) {
      toast.success('Winnings claimed successfully!')
    }
  }, [isSuccess])

  useEffect(() => {
    if (error) {
      toast.error('Failed to claim winnings', {
        description: error.message,
      })
    }
  }, [error])

  const claim = () => {
    const validatedAddress = expect(
      PREDIMARKET_ADDRESS !== '0x0' ? PREDIMARKET_ADDRESS : null,
      'Predimarket contract not deployed',
    )
    AddressSchema.parse(validatedAddress)

    writeContract({
      address: validatedAddress,
      abi: PREDIMARKET_ABI,
      functionName: 'claim',
      args: [validatedSessionId as `0x${string}`],
    })
  }

  return {
    claim,
    isPending: isPending || isConfirming,
    isSuccess,
    error,
  }
}
