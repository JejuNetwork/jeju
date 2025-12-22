/**
 * Bug Bounty API Routes
 *
 * REST API for bug bounty submissions, validation, and management
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Address } from 'viem'
import { z } from 'zod'
import { assessSubmission, getBugBountyService } from './bug-bounty-service'
import { getSandboxStats } from './sandbox-executor'
import {
  BountySubmissionDraftSchema,
  BugBountyCEODecisionRequestSchema,
  BugBountyCompleteValidationRequestSchema,
  BugBountyDiscloseRequestSchema,
  BugBountyFixRequestSchema,
  BugBountyListQuerySchema,
  BugBountySubmitRequestSchema,
  BugBountyVoteRequestSchema,
  expect,
} from './schemas'
import {
  type ValidationContext,
  validateSubmission,
} from './security-validation-agent'
import type {
  BountyGuardianVote,
  BountySubmission,
  BountySubmissionStatus,
} from './types'
import {
  parseAndValidateBody,
  parseAndValidateParam,
  parseAndValidateQuery,
  parseBigInt,
  successResponse,
} from './validation'

// ============ Router ============

const router = new Hono()
router.use('/*', cors())

// ============ Stats ============

router.get('/stats', async (c) => {
  const service = getBugBountyService()
  const stats = await service.getPoolStats()
  const sandboxStats = getSandboxStats()

  return c.json({
    totalPool: stats.totalPool.toString(),
    totalPaidOut: stats.totalPaidOut.toString(),
    pendingPayouts: stats.pendingPayouts.toString(),
    activeSubmissions: stats.activeSubmissions,
    guardianCount: stats.guardianCount,
    sandbox: sandboxStats,
  })
})

// ============ Submissions ============

router.get('/submissions', async (c) => {
  const service = getBugBountyService()
  const query = parseAndValidateQuery(
    c,
    BugBountyListQuerySchema,
    'Bug bounty submissions query',
  )

  let status: BountySubmissionStatus | undefined
  if (query.status !== undefined) {
    status = parseInt(query.status, 10) as BountySubmissionStatus
  }

  const limit = query.limit ?? 50
  const submissions = await service.list(status, query.researcher, limit)

  return successResponse(c, {
    submissions: submissions.map((s: BountySubmission) => {
      const { stake, rewardAmount, researcherAgentId, ...rest } = s
      return {
        ...rest,
        stake: stake.toString(),
        rewardAmount: rewardAmount.toString(),
        researcherAgentId: researcherAgentId.toString(),
      }
    }),
    total: submissions.length,
  })
})

router.get('/submissions/:id', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')

  const submission = await service.get(id)
  expect(
    submission !== null && submission !== undefined,
    'Submission not found',
  )

  const votes = await service.getGuardianVotes(id)

  const { stake, rewardAmount, researcherAgentId, ...submissionRest } =
    submission

  return successResponse(c, {
    submission: {
      ...submissionRest,
      stake: stake.toString(),
      rewardAmount: rewardAmount.toString(),
      researcherAgentId: researcherAgentId.toString(),
    },
    guardianVotes: votes.map((v: BountyGuardianVote) => {
      const { suggestedReward, guardianAgentId, ...voteRest } = v
      return {
        ...voteRest,
        suggestedReward: suggestedReward.toString(),
        guardianAgentId: guardianAgentId.toString(),
      }
    }),
  })
})

// ============ Assessment ============

router.post('/assess', async (c) => {
  const draft = await parseAndValidateBody(
    c,
    BountySubmissionDraftSchema,
    'Bounty submission assessment request',
  )
  const assessment = assessSubmission(draft)
  return successResponse(c, {
    severity: assessment.severity,
    estimatedReward: assessment.estimatedReward, // Already an object with { min, max, currency }
    qualityScore: assessment.qualityScore,
    issues: assessment.issues,
    readyToSubmit: assessment.readyToSubmit,
  })
})

// ============ Submission ============

router.post('/submit', async (c) => {
  const service = getBugBountyService()
  const body = await parseAndValidateBody(
    c,
    BugBountySubmitRequestSchema,
    'Bounty submission request',
  )

  // Require valid researcher address - placeholder addresses are security risk
  // as they could allow reward claims by unauthorized parties
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
  expect(
    body.researcher !== undefined && body.researcher !== ZERO_ADDR,
    'Valid researcher address is required for bounty submissions',
  )
  const researcher = body.researcher as Address
  const researcherAgentId = parseBigInt(
    body.researcherAgentId ?? '0',
    'Researcher agent ID',
  )

  const submission = await service.submit(body, researcher, researcherAgentId)

  return successResponse(c, {
    submissionId: submission.submissionId,
    status: submission.status,
    message: 'Submission received. Validation will begin shortly.',
  })
})

// ============ Validation ============

router.post('/validate/:id', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')

  const submission = await service.get(id)
  expect(
    submission !== null && submission !== undefined,
    'Submission not found',
  )

  // Trigger validation
  await service.triggerValidation(id)

  return successResponse(c, {
    submissionId: id,
    status: 'validating',
    message: 'Validation started',
  })
})

router.post('/validate/:id/complete', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')
  const body = await parseAndValidateBody(
    c,
    BugBountyCompleteValidationRequestSchema,
    'Complete validation request',
  )

  const submission = await service.completeValidation(
    id,
    body.result,
    body.notes,
  )

  return successResponse(c, {
    submissionId: id,
    status: submission.status,
    validationResult: submission.validationResult,
  })
})

// ============ Guardian Voting ============

router.post('/vote/:id', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')
  const body = await parseAndValidateBody(
    c,
    BugBountyVoteRequestSchema,
    'Guardian vote request',
  )

  await service.guardianVote(
    id,
    body.guardian as Address,
    parseBigInt(body.agentId, 'Agent ID'),
    body.approved,
    parseBigInt(body.suggestedReward, 'Suggested reward'),
    body.feedback,
  )

  const submission = await service.get(id)
  expect(
    submission !== null && submission !== undefined,
    'Submission not found',
  )

  return successResponse(c, {
    submissionId: id,
    submissionStatus: submission.status,
    guardianApprovals: submission.guardianApprovals,
    guardianRejections: submission.guardianRejections,
  })
})

router.get('/votes/:id', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')

  const votes = await service.getGuardianVotes(id)

  return successResponse(c, {
    votes: votes.map((v: BountyGuardianVote) => ({
      ...v,
      suggestedReward: v.suggestedReward.toString(),
      guardianAgentId: v.guardianAgentId.toString(),
    })),
  })
})

// ============ CEO Decision ============

router.post('/ceo-decision/:id', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')
  const body = await parseAndValidateBody(
    c,
    BugBountyCEODecisionRequestSchema,
    'CEO decision request',
  )

  const submission = await service.ceoDecision(
    id,
    body.approved,
    parseBigInt(body.rewardAmount, 'Reward amount'),
    body.notes,
  )

  return successResponse(c, {
    submissionId: id,
    status: submission.status,
    rewardAmount: submission.rewardAmount.toString(),
    approved: body.approved,
  })
})

// ============ Payout ============

router.post('/payout/:id', async (c) => {
  const service = getBugBountyService()
  const id = c.req.param('id')

  const result = await service.payReward(id)

  return c.json({
    submissionId: id,
    txHash: result.txHash,
    amount: result.amount.toString(),
  })
})

// ============ Fix & Disclosure ============

router.post('/fix/:id', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')
  const body = await parseAndValidateBody(
    c,
    BugBountyFixRequestSchema,
    'Fix record request',
  )

  const submission = await service.recordFix(id, body.commitHash)

  return successResponse(c, {
    submissionId: id,
    fixCommitHash: submission.fixCommitHash,
    disclosureDate: submission.disclosureDate,
  })
})

router.post('/disclose/:id', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')
  const body = await parseAndValidateBody(
    c,
    BugBountyDiscloseRequestSchema,
    'Disclosure request',
  )

  const submission = await service.researcherDisclose(
    id,
    body.researcher as Address,
  )

  return successResponse(c, {
    submissionId: id,
    researcherDisclosed: submission.researcherDisclosed,
    disclosureDate: submission.disclosureDate,
  })
})

// ============ Researcher Stats ============

router.get('/researcher/:address', async (c) => {
  const service = getBugBountyService()
  const address = parseAndValidateParam(
    c,
    'address',
    z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    'Researcher address',
  )

  const stats = await service.getResearcherStats(address as Address)

  return successResponse(c, {
    ...stats,
    totalEarned: stats.totalEarned.toString(),
    averageReward: stats.averageReward.toString(),
  })
})

// ============ AI Validation Endpoint ============

router.post('/ai-validate/:id', async (c) => {
  const service = getBugBountyService()
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID')

  const submission = await service.get(id)
  expect(
    submission !== null && submission !== undefined,
    'Submission not found',
  )

  const context: ValidationContext = {
    submissionId: submission.submissionId,
    severity: submission.severity,
    vulnType: submission.vulnType,
    title: submission.title,
    description: submission.description,
    affectedComponents: submission.affectedComponents,
    stepsToReproduce: submission.stepsToReproduce,
    proofOfConcept: submission.proofOfConcept ?? '',
    suggestedFix: submission.suggestedFix ?? '',
  }

  const report = await validateSubmission(context)

  // Update submission with validation result
  await service.completeValidation(
    id,
    report.result,
    report.securityNotes.join('\n'),
  )

  return successResponse(c, {
    submissionId: id,
    result: report.result,
    confidence: report.confidence,
    exploitVerified: report.exploitVerified,
    severityAssessment: report.severityAssessment,
    impactAssessment: report.impactAssessment,
    suggestedReward: report.suggestedReward.toString(),
    notes: report.securityNotes,
  })
})

// ============ Sandbox Stats ============

router.get('/sandbox/stats', async (c) => {
  const stats = getSandboxStats()
  return c.json(stats)
})

// ============ Export ============

export { router as bugBountyRouter }

export function createBugBountyServer(): Hono {
  return router
}
