'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, keccak256, toHex } from 'viem'
import { ProposalWizard } from '@/components/ProposalWizard'
import type { ProposalDraft, FullQualityAssessment } from '@/config/api'

const COUNCIL_ADDRESS = (process.env.NEXT_PUBLIC_COUNCIL_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
const PROPOSAL_BOND = parseEther('0.001')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`

const COUNCIL_ABI = [
  {
    name: 'submitProposal',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'proposalType', type: 'uint8' },
      { name: 'qualityScore', type: 'uint8' },
      { name: 'contentHash', type: 'bytes32' },
      { name: 'targetContract', type: 'address' },
      { name: 'callData', type: 'bytes' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: 'proposalId', type: 'bytes32' }],
  },
] as const

export default function CreateProposalPage() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const handleComplete = async (draft: ProposalDraft, assessment: FullQualityAssessment) => {
    if (!isConnected) {
      setSubmitError('Please connect your wallet to submit a proposal')
      return
    }

    if (COUNCIL_ADDRESS === ZERO_ADDRESS) {
      setSubmitError('Council contract not configured. Set NEXT_PUBLIC_COUNCIL_ADDRESS.')
      return
    }

    if (assessment.overallScore < 90) {
      setSubmitError(`Quality score ${assessment.overallScore} is below minimum (90)`)
      return
    }

    setSubmitError(null)
    setSubmitting(true)

    // Compute content hash from draft content
    const contentString = JSON.stringify({
      title: draft.title,
      summary: draft.summary,
      description: draft.description,
      proposalType: draft.proposalType,
      tags: draft.tags,
      assessedAt: assessment.assessedAt,
    })
    const contentHash = keccak256(toHex(contentString))

    writeContract({
      address: COUNCIL_ADDRESS,
      abi: COUNCIL_ABI,
      functionName: 'submitProposal',
      args: [
        draft.proposalType,
        assessment.overallScore,
        contentHash,
        (draft.targetContract || ZERO_ADDRESS) as `0x${string}`,
        (draft.calldata || '0x') as `0x${string}`,
        draft.value ? parseEther(draft.value) : 0n,
      ],
      value: PROPOSAL_BOND,
    })
  }

  // Redirect on success
  if (isSuccess && txHash) {
    router.push(`/proposals?submitted=${txHash}`)
  }

  const handleCancel = () => {
    router.push('/')
  }

  const isLoading = isPending || isConfirming || submitting

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Link 
          href="/" 
          className="p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft size={18} className="sm:w-5 sm:h-5" />
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Create Proposal</h1>
      </div>

      {/* Error Display */}
      {submitError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-300">{submitError}</p>
        </div>
      )}

      {/* Transaction Status */}
      {isLoading && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <p className="text-blue-700 dark:text-blue-300">
            {isPending ? 'Confirm in wallet...' : 'Waiting for confirmation...'}
          </p>
        </div>
      )}

      {/* Wizard */}
      <ProposalWizard
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </div>
  )
}
