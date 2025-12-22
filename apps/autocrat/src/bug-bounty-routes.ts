/**
 * Bug Bounty API Routes
 * 
 * REST API for bug bounty submissions, validation, and management
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type Address } from 'viem';
import {
  getBugBountyService,
  assessSubmission,
} from './bug-bounty-service';
import {
  validateSubmission,
  type ValidationContext,
} from './security-validation-agent';
import {
  getSandboxStats,
} from './sandbox-executor';
import {
  BountySeverity,
  BountySubmissionStatus,
} from './types';
import {
  BountySubmissionDraftSchema,
  BugBountySubmitRequestSchema,
  BugBountyVoteRequestSchema,
  BugBountyCEODecisionRequestSchema,
  BugBountyFixRequestSchema,
  BugBountyDiscloseRequestSchema,
  BugBountyCompleteValidationRequestSchema,
  BugBountyListQuerySchema,
} from './schemas';
import {
  parseAndValidateBody,
  parseAndValidateQuery,
  parseAndValidateParam,
  parseBigInt,
  successResponse,
} from './validation';
import { expect } from './schemas';
import { z } from 'zod';

// ============ Router ============

const router = new Hono();
router.use('/*', cors());

// ============ Stats ============

router.get('/stats', async (c) => {
  const service = getBugBountyService();
  const stats = service.getPoolStats();
  const sandboxStats = getSandboxStats();

  return c.json({
    totalPool: stats.totalPool.toString(),
    totalPaidOut: stats.totalPaidOut.toString(),
    pendingPayouts: stats.pendingPayouts.toString(),
    activeSubmissions: stats.activeSubmissions,
    guardianCount: stats.guardianCount,
    sandbox: sandboxStats,
  });
});

// ============ Submissions ============

router.get('/submissions', async (c) => {
  const service = getBugBountyService();
  const query = parseAndValidateQuery(c, BugBountyListQuerySchema, 'Bug bounty submissions query');
  
  const filter: {
    status?: BountySubmissionStatus;
    severity?: BountySeverity;
    researcher?: Address;
  } = {};

  if (query.status !== undefined) {
    filter.status = parseInt(query.status, 10) as BountySubmissionStatus;
  }
  if (query.severity !== undefined) {
    filter.severity = parseInt(query.severity, 10) as BountySeverity;
  }
  if (query.researcher) {
    filter.researcher = query.researcher;
  }

  const limit = query.limit ?? 50;
  const submissions = service.list(filter).slice(0, limit);

  return successResponse(c, {
    submissions: submissions.map(s => {
      const { stake, rewardAmount, researcherAgentId, ...rest } = s;
      return {
        ...rest,
        stake: stake.toString(),
        rewardAmount: rewardAmount.toString(),
        researcherAgentId: researcherAgentId.toString(),
      };
    }),
    total: submissions.length,
  });
});

router.get('/submissions/:id', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  
  const submission = service.get(id);
  expect(submission !== null && submission !== undefined, 'Submission not found');

  const votes = service.getGuardianVotes(id);

  const { stake, rewardAmount, researcherAgentId, ...submissionRest } = submission;

  return successResponse(c, {
    submission: {
      ...submissionRest,
      stake: stake.toString(),
      rewardAmount: rewardAmount.toString(),
      researcherAgentId: researcherAgentId.toString(),
    },
    guardianVotes: votes.map(v => {
      const { suggestedReward, agentId, ...voteRest } = v;
      return {
        ...voteRest,
        suggestedReward: suggestedReward.toString(),
        agentId: agentId.toString(),
      };
    }),
  });
});

// ============ Assessment ============

router.post('/assess', async (c) => {
  const draft = await parseAndValidateBody(c, BountySubmissionDraftSchema, 'Bounty submission assessment request');
  const assessment = assessSubmission(draft);
  return successResponse(c, {
    ...assessment,
    estimatedReward: assessment.estimatedReward.toString(),
  });
});

// ============ Submission ============

router.post('/submit', async (c) => {
  const service = getBugBountyService();
  const body = await parseAndValidateBody(c, BugBountySubmitRequestSchema, 'Bounty submission request');

  // Use placeholder if no wallet connected (would be handled by frontend)
  const researcher = (body.researcher ?? '0x0000000000000000000000000000000000000000') as Address;
  const researcherAgentId = parseBigInt(body.researcherAgentId ?? '0', 'Researcher agent ID');

  const submission = await service.submit(body, researcher, researcherAgentId);

  return successResponse(c, {
    submissionId: submission.submissionId,
    status: submission.status,
    message: 'Submission received. Validation will begin shortly.',
  });
});

// ============ Validation ============

router.post('/validate/:id', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  
  const submission = service.get(id);
  expect(submission !== null && submission !== undefined, 'Submission not found');

  // Trigger validation
  await service.triggerValidation(id);

  return successResponse(c, {
    submissionId: id,
    status: 'validating',
    message: 'Validation started',
  });
});

router.post('/validate/:id/complete', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  const body = await parseAndValidateBody(c, BugBountyCompleteValidationRequestSchema, 'Complete validation request');

  const submission = service.completeValidation(id, body.result, body.notes);

  return successResponse(c, {
    submissionId: id,
    status: submission.status,
    validationResult: submission.validationResult,
  });
});

// ============ Guardian Voting ============

router.post('/vote/:id', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  const body = await parseAndValidateBody(c, BugBountyVoteRequestSchema, 'Guardian vote request');

  const vote = service.guardianVote(
    id,
    body.guardian as Address,
    parseBigInt(body.agentId, 'Agent ID'),
    body.approved,
    parseBigInt(body.suggestedReward, 'Suggested reward'),
    body.feedback
  );

  const submission = service.get(id);
  expect(submission !== null && submission !== undefined, 'Submission not found');

  return successResponse(c, {
    vote: {
      ...vote,
      suggestedReward: vote.suggestedReward.toString(),
    },
    submissionStatus: submission.status,
    guardianApprovals: submission.guardianApprovals,
    guardianRejections: submission.guardianRejections,
  });
});

router.get('/votes/:id', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  
  const votes = service.getGuardianVotes(id);

  return successResponse(c, {
    votes: votes.map(v => ({
      ...v,
      suggestedReward: v.suggestedReward.toString(),
    })),
  });
});

// ============ CEO Decision ============

router.post('/ceo-decision/:id', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  const body = await parseAndValidateBody(c, BugBountyCEODecisionRequestSchema, 'CEO decision request');

  const submission = service.ceoDecision(
    id,
    body.approved,
    parseBigInt(body.rewardAmount, 'Reward amount'),
    body.notes
  );

  return successResponse(c, {
    submissionId: id,
    status: submission.status,
    rewardAmount: submission.rewardAmount.toString(),
    approved: body.approved,
  });
});

// ============ Payout ============

router.post('/payout/:id', async (c) => {
  const service = getBugBountyService();
  const id = c.req.param('id');

  const result = await service.payReward(id);

  return c.json({
    submissionId: id,
    txHash: result.txHash,
    amount: result.amount.toString(),
  });
});

// ============ Fix & Disclosure ============

router.post('/fix/:id', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  const body = await parseAndValidateBody(c, BugBountyFixRequestSchema, 'Fix record request');

  const submission = service.recordFix(id, body.commitHash);

  return successResponse(c, {
    submissionId: id,
    fixCommitHash: submission.fixCommitHash,
    disclosureDate: submission.disclosureDate,
  });
});

router.post('/disclose/:id', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  const body = await parseAndValidateBody(c, BugBountyDiscloseRequestSchema, 'Disclosure request');

  const submission = service.researcherDisclose(id, body.researcher as Address);

  return successResponse(c, {
    submissionId: id,
    researcherDisclosed: submission.researcherDisclosed,
    disclosureDate: submission.disclosureDate,
  });
});

// ============ Researcher Stats ============

router.get('/researcher/:address', async (c) => {
  const service = getBugBountyService();
  const address = parseAndValidateParam(c, 'address', z.string().regex(/^0x[a-fA-F0-9]{40}$/), 'Researcher address');

  const stats = service.getResearcherStats(address as Address);

  return successResponse(c, {
    ...stats,
    totalEarned: stats.totalEarned.toString(),
  });
});

// ============ AI Validation Endpoint ============

router.post('/ai-validate/:id', async (c) => {
  const service = getBugBountyService();
  const id = parseAndValidateParam(c, 'id', z.string().min(1), 'Submission ID');
  
  const submission = service.get(id);
  expect(submission !== null && submission !== undefined, 'Submission not found');

  const context: ValidationContext = {
    submissionId: submission.submissionId,
    severity: submission.severity,
    vulnType: submission.vulnType,
    title: submission.title,
    description: submission.description,
    affectedComponents: submission.affectedComponents,
    stepsToReproduce: submission.stepsToReproduce,
    proofOfConcept: submission.proofOfConcept ?? '', // Would be decrypted from encryptedReportCid
    suggestedFix: submission.suggestedFix ?? '',
  };

  const report = await validateSubmission(context);

  // Update submission with validation result
  service.completeValidation(id, report.result, report.securityNotes.join('\n'));

  return successResponse(c, {
    submissionId: id,
    result: report.result,
    confidence: report.confidence,
    exploitVerified: report.exploitVerified,
    severityAssessment: report.severityAssessment,
    impactAssessment: report.impactAssessment,
    suggestedReward: report.suggestedReward.toString(),
    notes: report.securityNotes,
  });
});

// ============ Sandbox Stats ============

router.get('/sandbox/stats', async (c) => {
  const stats = getSandboxStats();
  return c.json(stats);
});

// ============ Export ============

export { router as bugBountyRouter };

export function createBugBountyServer(): Hono {
  return router;
}

