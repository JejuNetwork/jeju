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
  type BountySubmissionDraft,
} from './types';

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
  
  const statusParam = c.req.query('status');
  const severity = c.req.query('severity');
  const researcher = c.req.query('researcher') as Address | undefined;
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const filter: {
    status?: BountySubmissionStatus;
    severity?: BountySeverity;
    researcher?: Address;
  } = {};

  if (statusParam !== undefined) {
    filter.status = parseInt(statusParam, 10) as BountySubmissionStatus;
  }
  if (severity !== undefined) {
    filter.severity = parseInt(severity, 10) as BountySeverity;
  }
  if (researcher) {
    filter.researcher = researcher;
  }

  const submissions = service.list(filter).slice(0, limit);

  return c.json({
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
  const id = c.req.param('id');
  
  const submission = service.get(id);
  if (!submission) {
    return c.json({ error: 'Submission not found' }, 404);
  }

  const votes = service.getGuardianVotes(id);

  const { stake, rewardAmount, researcherAgentId, ...submissionRest } = submission;

  return c.json({
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
  const draft = await c.req.json() as BountySubmissionDraft;
  
  const assessment = assessSubmission(draft);

  return c.json({
    ...assessment,
    estimatedReward: assessment.estimatedReward.toString(),
  });
});

// ============ Submission ============

router.post('/submit', async (c) => {
  const service = getBugBountyService();
  const body = await c.req.json() as BountySubmissionDraft & {
    researcher?: Address;
    researcherAgentId?: string;
  };

  // Validate required fields
  if (!body.title || !body.summary || !body.description) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  if (body.severity === undefined || body.vulnType === undefined) {
    return c.json({ error: 'Severity and vulnerability type required' }, 400);
  }

  // Use placeholder if no wallet connected (would be handled by frontend)
  const researcher = body.researcher ?? '0x0000000000000000000000000000000000000000' as Address;
  const researcherAgentId = BigInt(body.researcherAgentId ?? '0');

  const submission = await service.submit(body, researcher, researcherAgentId);

  return c.json({
    submissionId: submission.submissionId,
    status: submission.status,
    message: 'Submission received. Validation will begin shortly.',
  });
});

// ============ Validation ============

router.post('/validate/:id', async (c) => {
  const service = getBugBountyService();
  const id = c.req.param('id');
  
  const submission = service.get(id);
  if (!submission) {
    return c.json({ error: 'Submission not found' }, 404);
  }

  // Trigger validation
  await service.triggerValidation(id);

  return c.json({
    submissionId: id,
    status: 'validating',
    message: 'Validation started',
  });
});

router.post('/validate/:id/complete', async (c) => {
  const service = getBugBountyService();
  const id = c.req.param('id');
  const body = await c.req.json() as {
    result: number;
    notes: string;
  };

  const submission = service.completeValidation(id, body.result, body.notes);

  return c.json({
    submissionId: id,
    status: submission.status,
    validationResult: submission.validationResult,
  });
});

// ============ Guardian Voting ============

router.post('/vote/:id', async (c) => {
  const service = getBugBountyService();
  const id = c.req.param('id');
  const body = await c.req.json() as {
    guardian: Address;
    agentId: string;
    approved: boolean;
    suggestedReward: string;
    feedback: string;
  };

  const vote = service.guardianVote(
    id,
    body.guardian,
    BigInt(body.agentId),
    body.approved,
    BigInt(body.suggestedReward),
    body.feedback
  );

  const submission = service.get(id);

  return c.json({
    vote: {
      ...vote,
      suggestedReward: vote.suggestedReward.toString(),
    },
    submissionStatus: submission?.status,
    guardianApprovals: submission?.guardianApprovals,
    guardianRejections: submission?.guardianRejections,
  });
});

router.get('/votes/:id', async (c) => {
  const service = getBugBountyService();
  const id = c.req.param('id');
  
  const votes = service.getGuardianVotes(id);

  return c.json({
    votes: votes.map(v => ({
      ...v,
      suggestedReward: v.suggestedReward.toString(),
    })),
  });
});

// ============ CEO Decision ============

router.post('/ceo-decision/:id', async (c) => {
  const service = getBugBountyService();
  const id = c.req.param('id');
  const body = await c.req.json() as {
    approved: boolean;
    rewardAmount: string;
    notes: string;
  };

  const submission = service.ceoDecision(
    id,
    body.approved,
    BigInt(body.rewardAmount),
    body.notes
  );

  return c.json({
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
  const id = c.req.param('id');
  const body = await c.req.json() as { commitHash: string };

  const submission = service.recordFix(id, body.commitHash);

  return c.json({
    submissionId: id,
    fixCommitHash: submission.fixCommitHash,
    disclosureDate: submission.disclosureDate,
  });
});

router.post('/disclose/:id', async (c) => {
  const service = getBugBountyService();
  const id = c.req.param('id');
  const body = await c.req.json() as { researcher: Address };

  const submission = service.researcherDisclose(id, body.researcher);

  return c.json({
    submissionId: id,
    researcherDisclosed: submission.researcherDisclosed,
    disclosureDate: submission.disclosureDate,
  });
});

// ============ Researcher Stats ============

router.get('/researcher/:address', async (c) => {
  const service = getBugBountyService();
  const address = c.req.param('address') as Address;

  const stats = service.getResearcherStats(address);

  return c.json({
    ...stats,
    totalEarned: stats.totalEarned.toString(),
  });
});

// ============ AI Validation Endpoint ============

router.post('/ai-validate/:id', async (c) => {
  const service = getBugBountyService();
  const id = c.req.param('id');
  
  const submission = service.get(id);
  if (!submission) {
    return c.json({ error: 'Submission not found' }, 404);
  }

  const context: ValidationContext = {
    submissionId: submission.submissionId,
    severity: submission.severity,
    vulnType: submission.vulnType,
    title: submission.title,
    description: submission.description,
    affectedComponents: submission.affectedComponents,
    stepsToReproduce: submission.stepsToReproduce,
    proofOfConcept: '', // Would be decrypted from encryptedReportCid
    suggestedFix: submission.suggestedFix,
  };

  const report = await validateSubmission(context);

  // Update submission with validation result
  service.completeValidation(id, report.result, report.securityNotes.join('\n'));

  return c.json({
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

