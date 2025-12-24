/**
 * @module CEOFundingActions
 * @description CEO-initiated funding actions for hiring and one-off payments
 *
 * This module provides the integration between the AI CEO and the funding system,
 * enabling the CEO to:
 * - Create work agreements to "hire" contributors
 * - Approve one-off payment requests
 * - Set up bounties for specific tasks
 * - Configure contributor weights for deep funding
 *
 * All actions go through proper governance channels:
 * - Small amounts: CEO can approve directly
 * - Large amounts: Requires council approval
 * - Retroactive: Requires supermajority council vote
 */

import {
  bountyRegistryAbi,
  paymentRequestRegistryAbi,
  workAgreementRegistryAbi,
} from '@jejunetwork/contracts'
import {
  getAddress,
  getOptionalAddress,
  getString,
  getStringArray,
} from '@jejunetwork/types'
import {
  type Address,
  type createPublicClient,
  type createWalletClient,
  decodeEventLog,
  type Hash,
} from 'viem'
import { getDeepFundingService } from './deep-funding-service'
import {
  getPaymentRequestService,
  type PaymentCategory,
  type SubmitPaymentRequestParams,
} from './payment-request-service'
import {
  type AgreementType,
  getWorkAgreementService,
} from './work-agreement-service'

export interface CEOHireRequest {
  daoId: string
  contributorAddress: Address
  contributorId: string
  agreementType: AgreementType
  title: string
  scopeUri: string
  paymentToken: Address
  compensationAmount: bigint
  paymentPeriod: number // Seconds (0 for one-time)
  duration: number // Seconds (0 for ongoing)
  startDate?: number
  milestones?: Array<{
    title: string
    description: string
    dueDate: number
    payment: bigint
  }>
}

export interface CEOPaymentRequest {
  daoId: string
  contributorId: string
  category: PaymentCategory
  title: string
  description: string
  evidenceUri: string
  amount: bigint
  reason: string
}

export interface CEOBountyRequest {
  daoId: string
  title: string
  description: string
  scopeUri: string
  rewardAmount: bigint
  rewardToken: Address
  deadline: number
  requiredSkills?: string[]
  milestoneTitles?: string[]
  milestoneDescriptions?: string[]
  milestonePercentages?: bigint[]
}

export interface CEOFundingAdjustment {
  daoId: string
  contributorId: string
  newWeight: number
  reason: string
}
/**
 * CEO initiates a work agreement to "hire" a contributor
 * This creates a formal agreement that requires contributor signature
 */
export async function ceoHire(
  request: CEOHireRequest,
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<{ agreementHash: Hash; agreementId: string }> {
  const workAgreementService = getWorkAgreementService()

  // Create the agreement
  const hash = await workAgreementService.createAgreement(
    request.daoId,
    request.contributorAddress,
    request.contributorId,
    request.agreementType,
    request.title,
    request.scopeUri,
    request.paymentToken,
    request.compensationAmount,
    request.paymentPeriod,
    request.duration,
    request.startDate,
  )

  // Wait for transaction and extract agreementId from event logs
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  let agreementId = ''

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: workAgreementRegistryAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'AgreementCreated') {
        agreementId = decoded.args.agreementId
        break
      }
    } catch {
      // Not our event, skip
    }
  }

  if (!agreementId) {
    throw new Error('Failed to extract agreementId from transaction receipt')
  }

  // Add milestones if specified
  if (request.milestones) {
    for (const milestone of request.milestones) {
      await workAgreementService.addMilestone(
        agreementId,
        milestone.title,
        milestone.description,
        milestone.dueDate,
        milestone.payment,
      )
    }
  }

  return { agreementHash: hash, agreementId }
}

/**
 * CEO approves or creates a one-off payment request
 * If amount is below threshold, auto-approved
 * If above threshold, escalates to council
 */
export async function ceoOneOffPayment(
  request: CEOPaymentRequest,
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<{ requestHash: Hash; requestId: string }> {
  const paymentRequestService = getPaymentRequestService()

  // Check DAO config for auto-approve threshold
  const config = await paymentRequestService.getDAOConfig(request.daoId)

  // Submit the request on behalf of CEO (will be auto-routed based on amount)
  const submitParams: SubmitPaymentRequestParams = {
    daoId: request.daoId,
    contributorId: request.contributorId,
    category: request.category,
    title: request.title,
    description: request.description,
    evidenceUri: request.evidenceUri,
    requestedAmount: request.amount,
    isRetroactive: false,
    workStartDate: Math.floor(Date.now() / 1000),
    workEndDate: Math.floor(Date.now() / 1000),
  }

  const hash = await paymentRequestService.submitRequest(submitParams)

  // Wait for transaction and extract requestId from event logs
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  let requestId = ''

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: paymentRequestRegistryAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'PaymentRequestSubmitted') {
        requestId = decoded.args.requestId
        break
      }
    } catch {
      // Not our event, skip
    }
  }

  if (!requestId) {
    throw new Error('Failed to extract requestId from transaction receipt')
  }

  // If below threshold and CEO can auto-approve, approve immediately
  if (request.amount <= config.maxAutoApproveAmount && config.ceoCanOverride) {
    await paymentRequestService.ceoDecision(
      requestId,
      true,
      request.amount,
      request.reason,
    )
  }

  return { requestHash: hash, requestId }
}

/**
 * CEO creates a bounty for a specific task
 * Bounties are open for anyone to claim
 */
export async function ceoCreateBounty(
  request: CEOBountyRequest,
  walletClient: ReturnType<typeof createWalletClient>,
  bountyRegistryAddress: Address,
): Promise<Hash> {
  const hash = await walletClient.writeContract({
    chain: walletClient.chain,
    account: walletClient.account ?? null,
    address: bountyRegistryAddress,
    abi: bountyRegistryAbi,
    functionName: 'createBounty',
    args: [
      {
        title: request.title,
        description: request.description,
        specUri: request.scopeUri,
        deadline: BigInt(request.deadline),
      },
      [{ token: request.rewardToken, amount: request.rewardAmount }],
      request.milestoneTitles ?? [],
      request.milestoneDescriptions ?? [],
      request.milestonePercentages ?? [],
      request.requiredSkills ?? [],
    ],
  })

  return hash
}

/**
 * CEO adjusts a contributor's funding weight
 * This affects their share of deep funding distributions
 */
export async function ceoAdjustFundingWeight(
  adjustment: CEOFundingAdjustment,
): Promise<Hash> {
  const fundingService = getDeepFundingService()

  const hash = await fundingService.setContributorWeight(
    adjustment.daoId,
    adjustment.contributorId,
    adjustment.newWeight,
  )

  return hash
}

/**
 * CEO processes pending payment requests
 * Fetches all pending requests and makes decisions
 */
export async function ceoProcessPendingPayments(
  daoId: string,
  decisionMaker: (request: {
    title: string
    amount: bigint
    category: PaymentCategory
  }) => Promise<{ approved: boolean; reason: string; modifiedAmount?: bigint }>,
): Promise<{ processed: number; approved: number; rejected: number }> {
  const paymentRequestService = getPaymentRequestService()

  const pendingRequests = await paymentRequestService.getPendingRequests(daoId)
  const ceoReviewRequests = pendingRequests.filter(
    (r) => r.status === 'CEO_REVIEW',
  )

  let approved = 0
  let rejected = 0

  for (const request of ceoReviewRequests) {
    const decision = await decisionMaker({
      title: request.title,
      amount: request.requestedAmount,
      category: request.category,
    })

    await paymentRequestService.ceoDecision(
      request.requestId,
      decision.approved,
      decision.modifiedAmount || request.requestedAmount,
      decision.reason,
    )

    if (decision.approved) {
      approved++
    } else {
      rejected++
    }
  }

  return { processed: ceoReviewRequests.length, approved, rejected }
}
/**
 * Skills that the CEO agent can use for funding operations
 */
export const ceoFundingSkills = [
  {
    id: 'hire-contributor',
    description: 'Create a work agreement to hire a contributor',
    parameters: {
      contributorAddress: 'Address of the contributor to hire',
      agreementType:
        'FULL_TIME | PART_TIME | CONTRACT | BOUNTY_BASED | RETAINER',
      title: 'Title of the work agreement',
      scopeUri: 'IPFS URI with detailed scope',
      compensationAmount: 'Payment amount per period',
      paymentPeriod: 'Payment frequency in seconds (0 for one-time)',
      duration: 'Total duration in seconds (0 for ongoing)',
    },
  },
  {
    id: 'create-payment',
    description: 'Create a one-off payment for work done',
    parameters: {
      contributorId: 'ID of the contributor to pay',
      category: 'MARKETING | COMMUNITY_MANAGEMENT | OPERATIONS | etc.',
      title: 'Title of the payment',
      amount: 'Payment amount',
      reason: 'Reason for payment',
    },
  },
  {
    id: 'create-bounty',
    description: 'Create a bounty for a specific task',
    parameters: {
      title: 'Title of the bounty',
      description: 'Description of the work',
      rewardAmount: 'Reward amount',
      deadline: 'Deadline timestamp',
    },
  },
  {
    id: 'adjust-weight',
    description: "Adjust a contributor's funding weight",
    parameters: {
      contributorId: 'ID of the contributor',
      newWeight: 'New weight (0-10000 basis points)',
      reason: 'Reason for adjustment',
    },
  },
  {
    id: 'process-payments',
    description: 'Process all pending payment requests',
    parameters: {},
  },
]

// Get optional string with default value fallback
function getStringOr(
  params: Record<string, unknown>,
  key: string,
  defaultVal: string,
): string {
  const val = params[key]
  return typeof val === 'string' ? val : defaultVal
}

/**
 * Execute a CEO funding skill
 */
export async function executeCEOFundingSkill(
  daoId: string,
  skillId: string,
  params: Record<string, unknown>,
  config: {
    publicClient: ReturnType<typeof createPublicClient>
    walletClient: ReturnType<typeof createWalletClient>
    bountyRegistryAddress: Address
  },
): Promise<{
  success: boolean
  result: Record<string, unknown> | null
  error?: string
}> {
  try {
    switch (skillId) {
      case 'hire-contributor': {
        const hireResult = await ceoHire(
          {
            daoId,
            contributorAddress: getAddress(params, 'contributorAddress'),
            contributorId: getStringOr(
              params,
              'contributorId',
              `0x${'0'.repeat(64)}`,
            ),
            agreementType: getString(params, 'agreementType') as AgreementType,
            title: getString(params, 'title'),
            scopeUri: getString(params, 'scopeUri'),
            paymentToken: getOptionalAddress(params, 'paymentToken'),
            compensationAmount: BigInt(getString(params, 'compensationAmount')),
            paymentPeriod: Number(params.paymentPeriod || 0),
            duration: Number(params.duration || 0),
            startDate: params.startDate ? Number(params.startDate) : undefined,
          },
          config.publicClient,
        )
        return { success: true, result: hireResult }
      }

      case 'create-payment': {
        const paymentResult = await ceoOneOffPayment(
          {
            daoId,
            contributorId: getString(params, 'contributorId'),
            category: getString(params, 'category') as PaymentCategory,
            title: getString(params, 'title'),
            description: getStringOr(params, 'description', ''),
            evidenceUri: getStringOr(params, 'evidenceUri', ''),
            amount: BigInt(getString(params, 'amount')),
            reason: getString(params, 'reason'),
          },
          config.publicClient,
        )
        return { success: true, result: paymentResult }
      }

      case 'create-bounty': {
        const bountyHash = await ceoCreateBounty(
          {
            daoId,
            title: getString(params, 'title'),
            description: getString(params, 'description'),
            scopeUri: getStringOr(params, 'scopeUri', ''),
            rewardAmount: BigInt(getString(params, 'rewardAmount')),
            rewardToken: getOptionalAddress(params, 'rewardToken'),
            deadline: Number(params.deadline),
            requiredSkills: getStringArray(params, 'requiredSkills'),
          },
          config.walletClient,
          config.bountyRegistryAddress,
        )
        return { success: true, result: { txHash: bountyHash } }
      }

      case 'adjust-weight': {
        const weightHash = await ceoAdjustFundingWeight({
          daoId,
          contributorId: getString(params, 'contributorId'),
          newWeight: Number(params.newWeight),
          reason: getString(params, 'reason'),
        })
        return { success: true, result: { txHash: weightHash } }
      }

      case 'process-payments': {
        // Simple auto-approve logic for demo
        const processResult = await ceoProcessPendingPayments(
          daoId,
          async () => ({
            approved: true,
            reason: 'CEO auto-approval',
          }),
        )
        return { success: true, result: processResult }
      }

      default:
        return {
          success: false,
          result: null,
          error: `Unknown skill: ${skillId}`,
        }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, result: null, error: message }
  }
}
