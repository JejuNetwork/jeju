/**
 * Bug Bounty Routes - Elysia
 *
 * Security vulnerability submission and bounty management
 */

import { Elysia, t } from 'elysia'
import {
  type BountySeverity,
  type BountySubmissionDraft,
  type BountySubmissionStatus,
  toAddress,
  type ValidationResult,
  type VulnerabilityType,
} from '../../lib'
import { assessSubmission, getBugBountyService } from '../bug-bounty-service'
import { getSandboxStats } from '../sandbox-executor'
import {
  type ValidationContext,
  validateSubmission,
} from '../security-validation-agent'

const BountySubmissionDraftSchema = t.Object({
  title: t.String({ minLength: 1 }),
  summary: t.String({ minLength: 50 }),
  description: t.String({ minLength: 200 }),
  severity: t.Number({ minimum: 0, maximum: 3 }),
  vulnType: t.Number({ minimum: 0, maximum: 5 }),
  affectedComponents: t.Array(t.String()),
  stepsToReproduce: t.Array(t.String()),
  proofOfConcept: t.Optional(t.String()),
  suggestedFix: t.Optional(t.String()),
  impact: t.Optional(t.String()),
})

export const bugBountyRoutes = new Elysia({ prefix: '/api/v1/bug-bounty' })
  // Stats
  .get(
    '/stats',
    async () => {
      const service = getBugBountyService()
      const stats = await service.getPoolStats()
      const sandboxStats = getSandboxStats()

      return {
        totalPool: stats.totalPool.toString(),
        totalPaidOut: stats.totalPaidOut.toString(),
        pendingPayouts: stats.pendingPayouts.toString(),
        activeSubmissions: stats.activeSubmissions,
        guardianCount: stats.guardianCount,
        sandbox: sandboxStats,
      }
    },
    {
      detail: { tags: ['bug-bounty'], summary: 'Get bug bounty pool stats' },
    },
  )
  // Submissions
  .get(
    '/submissions',
    async ({ query }) => {
      const service = getBugBountyService()
      const status = query.status
        ? (parseInt(query.status, 10) as BountySubmissionStatus)
        : undefined
      const limit = query.limit ? parseInt(query.limit, 10) : 50
      const researcher = query.researcher
        ? toAddress(query.researcher)
        : undefined
      const submissions = await service.list(status, researcher, limit)

      return {
        submissions: submissions.map((s) => ({
          submissionId: s.submissionId,
          title: s.title,
          severity: s.severity,
          vulnType: s.vulnType,
          status: s.status,
          submittedAt: s.submittedAt,
          researcher: s.researcher,
          stake: s.stake.toString(),
          rewardAmount: s.rewardAmount.toString(),
          guardianApprovals: s.guardianApprovals,
          guardianRejections: s.guardianRejections,
        })),
        total: submissions.length,
      }
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        researcher: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { tags: ['bug-bounty'], summary: 'List bug bounty submissions' },
    },
  )
  .get(
    '/submissions/:id',
    async ({ params }) => {
      const service = getBugBountyService()
      const submission = await service.get(params.id)

      if (!submission) {
        throw new Error('Submission not found')
      }

      const votes = await service.getGuardianVotes(params.id)

      return {
        submission: {
          ...submission,
          stake: submission.stake.toString(),
          rewardAmount: submission.rewardAmount.toString(),
          researcherAgentId: submission.researcherAgentId.toString(),
        },
        guardianVotes: votes.map((v) => ({
          ...v,
          suggestedReward: v.suggestedReward.toString(),
          guardianAgentId: v.guardianAgentId.toString(),
        })),
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Get submission by ID' },
    },
  )
  // Assessment
  .post(
    '/assess',
    async ({ body }) => {
      const draft: BountySubmissionDraft = {
        title: body.title,
        summary: body.summary,
        description: body.description,
        severity: body.severity as BountySeverity,
        vulnType: body.vulnType as VulnerabilityType,
        affectedComponents: body.affectedComponents,
        stepsToReproduce: body.stepsToReproduce,
        proofOfConcept: body.proofOfConcept,
        suggestedFix: body.suggestedFix,
        impact: body.impact,
      }

      const assessment = assessSubmission(draft)

      return {
        severity: assessment.severity,
        estimatedReward: assessment.estimatedReward,
        qualityScore: assessment.qualityScore,
        issues: assessment.issues,
        readyToSubmit: assessment.readyToSubmit,
      }
    },
    {
      body: BountySubmissionDraftSchema,
      detail: { tags: ['bug-bounty'], summary: 'Assess submission quality' },
    },
  )
  // Submit
  .post(
    '/submit',
    async ({ body }) => {
      const service = getBugBountyService()

      const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
      if (!body.researcher || body.researcher === ZERO_ADDR) {
        throw new Error('Valid researcher address is required')
      }

      const draft: BountySubmissionDraft = {
        title: body.title,
        summary: body.summary,
        description: body.description,
        severity: body.severity as BountySeverity,
        vulnType: body.vulnType as VulnerabilityType,
        affectedComponents: body.affectedComponents,
        stepsToReproduce: body.stepsToReproduce,
        proofOfConcept: body.proofOfConcept,
        suggestedFix: body.suggestedFix,
        impact: body.impact,
      }

      const submission = await service.submit(
        draft,
        toAddress(body.researcher),
        BigInt(body.researcherAgentId ?? '0'),
      )

      return {
        submissionId: submission.submissionId,
        status: submission.status,
        message: 'Submission received. Validation will begin shortly.',
      }
    },
    {
      body: t.Intersect([
        BountySubmissionDraftSchema,
        t.Object({
          researcher: t.String(),
          researcherAgentId: t.Optional(t.String()),
        }),
      ]),
      detail: { tags: ['bug-bounty'], summary: 'Submit bug bounty report' },
    },
  )
  // Validation
  .post(
    '/validate/:id',
    async ({ params }) => {
      const service = getBugBountyService()
      const submission = await service.get(params.id)

      if (!submission) {
        throw new Error('Submission not found')
      }

      await service.triggerValidation(params.id)

      return {
        submissionId: params.id,
        status: 'validating',
        message: 'Validation started',
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Trigger validation' },
    },
  )
  .post(
    '/validate/:id/complete',
    async ({ params, body }) => {
      const service = getBugBountyService()

      const submission = await service.completeValidation(
        params.id,
        body.result as ValidationResult,
        body.notes ?? '',
      )

      return {
        submissionId: params.id,
        status: submission.status,
        validationResult: submission.validationResult,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        result: t.Number({ minimum: 0, maximum: 4 }),
        notes: t.Optional(t.String()),
      }),
      detail: { tags: ['bug-bounty'], summary: 'Complete validation' },
    },
  )
  // AI Validation
  .post(
    '/ai-validate/:id',
    async ({ params }) => {
      const service = getBugBountyService()
      const submission = await service.get(params.id)

      if (!submission) {
        throw new Error('Submission not found')
      }

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

      await service.completeValidation(
        params.id,
        report.result,
        report.securityNotes.join('\n'),
      )

      return {
        submissionId: params.id,
        result: report.result,
        confidence: report.confidence,
        exploitVerified: report.exploitVerified,
        severityAssessment: report.severityAssessment,
        impactAssessment: report.impactAssessment,
        suggestedReward: report.suggestedReward.toString(),
        notes: report.securityNotes,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'AI validation' },
    },
  )
  // Guardian Voting
  .post(
    '/vote/:id',
    async ({ params, body }) => {
      const service = getBugBountyService()

      await service.guardianVote(
        params.id,
        toAddress(body.guardian),
        BigInt(body.agentId),
        body.approved,
        BigInt(body.suggestedReward),
        body.feedback ?? '',
      )

      const submission = await service.get(params.id)
      if (!submission) {
        throw new Error('Submission not found')
      }

      return {
        submissionId: params.id,
        submissionStatus: submission.status,
        guardianApprovals: submission.guardianApprovals,
        guardianRejections: submission.guardianRejections,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        guardian: t.String(),
        agentId: t.String(),
        approved: t.Boolean(),
        suggestedReward: t.String(),
        feedback: t.Optional(t.String()),
      }),
      detail: { tags: ['bug-bounty'], summary: 'Guardian vote' },
    },
  )
  .get(
    '/votes/:id',
    async ({ params }) => {
      const service = getBugBountyService()
      const votes = await service.getGuardianVotes(params.id)

      return {
        votes: votes.map((v) => ({
          ...v,
          suggestedReward: v.suggestedReward.toString(),
          guardianAgentId: v.guardianAgentId.toString(),
        })),
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Get guardian votes' },
    },
  )
  // CEO Decision
  .post(
    '/ceo-decision/:id',
    async ({ params, body }) => {
      const service = getBugBountyService()

      const submission = await service.ceoDecision(
        params.id,
        body.approved,
        BigInt(body.rewardAmount),
        body.notes ?? '',
      )

      return {
        submissionId: params.id,
        status: submission.status,
        rewardAmount: submission.rewardAmount.toString(),
        approved: body.approved,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        approved: t.Boolean(),
        rewardAmount: t.String(),
        notes: t.Optional(t.String()),
      }),
      detail: { tags: ['bug-bounty'], summary: 'CEO decision' },
    },
  )
  // Payout
  .post(
    '/payout/:id',
    async ({ params }) => {
      const service = getBugBountyService()
      const result = await service.payReward(params.id)

      return {
        submissionId: params.id,
        txHash: result.txHash,
        amount: result.amount.toString(),
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Process payout' },
    },
  )
  // Fix & Disclosure
  .post(
    '/fix/:id',
    async ({ params, body }) => {
      const service = getBugBountyService()
      const submission = await service.recordFix(params.id, body.commitHash)

      return {
        submissionId: params.id,
        fixCommitHash: submission.fixCommitHash,
        disclosureDate: submission.disclosureDate,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ commitHash: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Record fix' },
    },
  )
  .post(
    '/disclose/:id',
    async ({ params, body }) => {
      const service = getBugBountyService()
      const submission = await service.researcherDisclose(
        params.id,
        toAddress(body.researcher),
      )

      return {
        submissionId: params.id,
        researcherDisclosed: submission.researcherDisclosed,
        disclosureDate: submission.disclosureDate,
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ researcher: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Researcher disclosure' },
    },
  )
  // Researcher Stats
  .get(
    '/researcher/:address',
    async ({ params }) => {
      const service = getBugBountyService()
      const stats = await service.getResearcherStats(toAddress(params.address))

      return {
        ...stats,
        totalEarned: stats.totalEarned.toString(),
        averageReward: stats.averageReward.toString(),
      }
    },
    {
      params: t.Object({ address: t.String() }),
      detail: { tags: ['bug-bounty'], summary: 'Get researcher stats' },
    },
  )
  // Sandbox Stats
  .get(
    '/sandbox/stats',
    () => {
      return getSandboxStats()
    },
    {
      detail: { tags: ['bug-bounty'], summary: 'Get sandbox stats' },
    },
  )
