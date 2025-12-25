import { ZERO_ADDRESS } from '@jejunetwork/types'
import { ArrowLeft, CheckCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keccak256, parseEther, toHex } from 'viem'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { ProposalWizard } from '../components/ProposalWizard'
import {
  assessProposal,
  type FullQualityAssessment,
  type ProposalDraft,
  prepareSubmitProposal,
  type QualityAssessment,
} from '../config/api'
import { AUTOCRAT_ADDRESS } from '../config/env'

const PROPOSAL_BOND = parseEther('0.001')

const AUTOCRAT_ABI = [
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
  const navigate = useNavigate()
  const { isConnected } = useAccount()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [a2aAssessment, setA2aAssessment] = useState<QualityAssessment | null>(
    null,
  )
  const [prepareStatus, setPrepareStatus] = useState<string | null>(null)

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const handleComplete = async (
    draft: ProposalDraft,
    assessment: FullQualityAssessment,
  ) => {
    if (!isConnected) {
      setSubmitError('Please connect your wallet to submit a proposal')
      return
    }

    if (AUTOCRAT_ADDRESS === ZERO_ADDRESS) {
      setSubmitError(
        'Autocrat contract not configured. Set PUBLIC_AUTOCRAT_ADDRESS.',
      )
      return
    }

    if (assessment.overallScore < 90) {
      setSubmitError(
        `Quality score ${assessment.overallScore} is below minimum (90)`,
      )
      return
    }

    setSubmitError(null)
    setSubmitting(true)
    setPrepareStatus('Running A2A assessment...')

    // Run A2A assessment for additional validation
    const a2aResult = await assessProposal({
      title: draft.title,
      summary: draft.summary,
      description: draft.description,
      proposalType: String(draft.proposalType),
    }).catch(() => null)

    if (a2aResult) {
      setA2aAssessment(a2aResult)
    }

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

    // Prepare submission via backend
    setPrepareStatus('Preparing on-chain submission...')
    const prepareResult = await prepareSubmitProposal({
      proposalType: draft.proposalType,
      qualityScore: assessment.overallScore,
      contentHash,
      targetContract: draft.targetContract,
      callData: draft.calldata,
      value: draft.value,
    }).catch(() => null)

    if (prepareResult && !prepareResult.success) {
      setSubmitError(prepareResult.error ?? 'Failed to prepare submission')
      setSubmitting(false)
      setPrepareStatus(null)
      return
    }

    setPrepareStatus('Submitting to blockchain...')

    writeContract({
      address: AUTOCRAT_ADDRESS,
      abi: AUTOCRAT_ABI,
      functionName: 'submitProposal',
      args: [
        draft.proposalType,
        assessment.overallScore,
        contentHash,
        draft.targetContract ?? ZERO_ADDRESS,
        draft.calldata ?? '0x',
        draft.value ? parseEther(draft.value) : 0n,
      ],
      value: PROPOSAL_BOND,
    })
  }

  // Redirect on success
  if (isSuccess && txHash) {
    navigate(`/proposals?submitted=${txHash}`)
  }

  const handleCancel = () => {
    navigate('/')
  }

  const isLoading = isPending || isConfirming || submitting

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          to="/"
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
            {prepareStatus ??
              (isPending
                ? 'Confirm in wallet...'
                : 'Waiting for confirmation...')}
          </p>
        </div>
      )}

      {/* A2A Assessment Result */}
      {a2aAssessment && !isLoading && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="font-medium text-green-700 dark:text-green-300">
              A2A Assessment Complete
            </span>
          </div>
          <p className="text-sm text-green-600 dark:text-green-400">
            Score: {a2aAssessment.overallScore}/100 •{' '}
            {a2aAssessment.readyToSubmit ? 'Ready to submit' : 'Needs review'}
          </p>
        </div>
      )}

      {/* Wizard */}
      <ProposalWizard onComplete={handleComplete} onCancel={handleCancel} />
    </div>
  )
}
