/**
 * Bug Bounty Service
 * 
 * Handles security vulnerability submissions, validation, and payouts
 * Integrates with DWS compute for sandbox testing and MPC KMS for encryption
 * 
 * FULLY DECENTRALIZED - All compute/storage goes through DWS network
 */

import { getDWSComputeUrl, getKMSUrl } from '@jejunetwork/config';
import { keccak256, stringToHex, parseEther, formatEther, type Address } from 'viem';
import {
  BountySeverity,
  VulnerabilityType,
  BountySubmissionStatus,
  ValidationResult,
  type BountySubmission,
  type BountySubmissionDraft,
  type BountyAssessment,
  type BountyGuardianVote,
  type ResearcherStats,
  type BountyPoolStats,
  SEVERITY_REWARDS,
} from './types';
import { expect, expectDefined } from './schemas';

// ============ Configuration (Network-Aware) ============

// DWS endpoints are resolved dynamically based on the current network
function getDWSEndpoint(): string {
  return process.env.DWS_URL ?? process.env.DWS_COMPUTE_URL ?? getDWSComputeUrl();
}

function getKMSEndpoint(): string {
  return process.env.KMS_URL ?? getKMSUrl();
}

// Test mode - ONLY for testing, never in production
// In test mode, encryption is simulated and DWS failures don't block validation
const TEST_MODE = process.env.NODE_ENV === 'test' || process.env.BUG_BOUNTY_TEST_MODE === 'true';

// ============ In-Memory Storage (would be on-chain + indexed in production) ============

const submissions = new Map<string, BountySubmission>();
const guardianVotes = new Map<string, BountyGuardianVote[]>();
const researcherStats = new Map<string, ResearcherStats>();
const vulnerabilityHashes = new Map<string, string>(); // hash -> submissionId for duplicate detection
const rateLimit = new Map<string, { count: number; windowStart: number }>(); // address -> rate limit state
let submissionCounter = 1;

// ============ Rate Limiting ============

const RATE_LIMIT_WINDOW = 3600 * 1000; // 1 hour
const MAX_SUBMISSIONS_PER_WINDOW = 5;

function checkRateLimit(researcher: Address): void {
  // Skip rate limiting in test mode
  if (TEST_MODE) return;

  const now = Date.now();
  const key = researcher.toLowerCase();
  const limit = rateLimit.get(key);

  if (!limit || now - limit.windowStart > RATE_LIMIT_WINDOW) {
    rateLimit.set(key, { count: 1, windowStart: now });
    return;
  }

  if (limit.count >= MAX_SUBMISSIONS_PER_WINDOW) {
    throw new Error(`Rate limit exceeded: max ${MAX_SUBMISSIONS_PER_WINDOW} submissions per hour`);
  }

  limit.count++;
  rateLimit.set(key, limit);
}

// ============ Duplicate Detection ============

function computeVulnerabilityHash(draft: BountySubmissionDraft): string {
  // Hash based on title + description + affected components
  const normalized = [
    draft.title.toLowerCase().trim(),
    draft.description.toLowerCase().trim().slice(0, 500),
    draft.affectedComponents.map(c => c.toLowerCase()).sort().join(','),
  ].join('|');
  return keccak256(stringToHex(normalized));
}

function checkDuplicate(hash: string): string | null {
  return vulnerabilityHashes.get(hash) ?? null;
}

// ============ Encryption Integration ============

interface EncryptedReport {
  cid: string;
  keyId: string;
  encryptedData: string;
}

async function encryptReport(report: string): Promise<EncryptedReport> {
  // In test mode, simulate encryption (reports are NOT actually encrypted)
  if (TEST_MODE) {
    const keyId = keccak256(stringToHex(`test-key-${Date.now()}`));
    const encryptedData = Buffer.from(report).toString('base64');
    console.log('[BugBounty] TEST MODE: Simulating encryption (NOT secure)');
    return {
      cid: keccak256(stringToHex(report)).slice(0, 34),
      keyId,
      encryptedData,
    };
  }

  // Production: MPC KMS is REQUIRED for encryption (decentralized)
  const kmsEndpoint = getKMSEndpoint();
  let response: Response;
  try {
    response = await fetch(`${kmsEndpoint}/api/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: report,
        keyType: 'mpc',
        threshold: 3,
        parties: 5,
      }),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`MPC KMS connection failed: ${errorMessage}`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown error');
    throw new Error(`MPC KMS encryption failed: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const result = await response.json() as { cid: string; keyId: string; encryptedData: string };
  if (!result.cid || !result.keyId || !result.encryptedData) {
    throw new Error('MPC KMS response missing required fields (cid, keyId, encryptedData)');
  }
  return result;
}

// ============ Assessment Logic ============

export function assessSubmission(draft: BountySubmissionDraft): BountyAssessment {
  const feedback: string[] = [];
  let readyToSubmit = true;

  // Validate required fields
  if (!draft.title || draft.title.length < 10) {
    feedback.push('Title must be at least 10 characters');
    readyToSubmit = false;
  }

  if (!draft.summary || draft.summary.length < 50) {
    feedback.push('Summary must be at least 50 characters');
    readyToSubmit = false;
  }

  if (!draft.description || draft.description.length < 200) {
    feedback.push('Description must be at least 200 characters');
    readyToSubmit = false;
  }

  if (!draft.stepsToReproduce || draft.stepsToReproduce.length < 2) {
    feedback.push('Provide at least 2 steps to reproduce');
    readyToSubmit = false;
  }

  if (!draft.affectedComponents || draft.affectedComponents.length === 0) {
    feedback.push('Specify at least one affected component');
    readyToSubmit = false;
  }

  // Calculate scores based on severity and type
  const severityMultiplier: Record<BountySeverity, number> = {
    [BountySeverity.LOW]: 1,
    [BountySeverity.MEDIUM]: 2,
    [BountySeverity.HIGH]: 3,
    [BountySeverity.CRITICAL]: 4,
  };

  const typeMultiplier: Record<VulnerabilityType, number> = {
    [VulnerabilityType.FUNDS_AT_RISK]: 10,
    [VulnerabilityType.WALLET_DRAIN]: 10,
    [VulnerabilityType.REMOTE_CODE_EXECUTION]: 9,
    [VulnerabilityType.TEE_BYPASS]: 9,
    [VulnerabilityType.CONSENSUS_ATTACK]: 8,
    [VulnerabilityType.MPC_KEY_EXPOSURE]: 8,
    [VulnerabilityType.PRIVILEGE_ESCALATION]: 7,
    [VulnerabilityType.DENIAL_OF_SERVICE]: 5,
    [VulnerabilityType.INFORMATION_DISCLOSURE]: 4,
    [VulnerabilityType.OTHER]: 3,
  };

  const severityScore = severityMultiplier[draft.severity] * 25;
  const impactScore = typeMultiplier[draft.vulnType] * 10;
  
  // Exploitability based on PoC presence
  const hasPoC = draft.proofOfConcept && draft.proofOfConcept.length > 100;
  const exploitabilityScore = hasPoC ? 90 : 50;

  // Immediate threat detection
  const isImmediateThreat = 
    draft.severity === BountySeverity.CRITICAL &&
    (draft.vulnType === VulnerabilityType.FUNDS_AT_RISK ||
     draft.vulnType === VulnerabilityType.WALLET_DRAIN ||
     draft.vulnType === VulnerabilityType.REMOTE_CODE_EXECUTION);

  // Estimate reward based on severity
  const rewardRange = SEVERITY_REWARDS[draft.severity];
  const minReward = parseFloat(rewardRange.min.replace(/[$,]/g, ''));
  const maxReward = parseFloat(rewardRange.max.replace(/[$,]/g, ''));
  const estimatedReward = parseEther(String((minReward + maxReward) / 2 / 2500)); // Rough ETH conversion

  // Validation priority
  let validationPriority: 'critical' | 'high' | 'medium' | 'low' = 'low';
  if (isImmediateThreat) {
    validationPriority = 'critical';
    feedback.unshift('CRITICAL: Immediate threat detected - fast-track review enabled');
  } else if (draft.severity === BountySeverity.CRITICAL) {
    validationPriority = 'critical';
  } else if (draft.severity === BountySeverity.HIGH) {
    validationPriority = 'high';
  } else if (draft.severity === BountySeverity.MEDIUM) {
    validationPriority = 'medium';
  }

  // Additional feedback
  if (!draft.suggestedFix) {
    feedback.push('Consider adding a suggested fix to increase reward');
  }

  if (hasPoC) {
    feedback.push('Proof of concept detected - will be validated in sandbox');
  }

  return {
    severityScore,
    impactScore,
    exploitabilityScore,
    isImmediateThreat,
    estimatedReward,
    validationPriority,
    feedback,
    readyToSubmit,
  };
}

// ============ Submission Management ============

export async function submitBounty(
  draft: BountySubmissionDraft,
  researcher: Address,
  researcherAgentId: bigint
): Promise<BountySubmission> {
  expectDefined(draft.title, 'Title is required');
  expectDefined(draft.summary, 'Summary is required');
  expectDefined(draft.description, 'Description is required');
  expect(draft.title.length >= 10, `Title must be at least 10 characters, got ${draft.title.length}`);
  expect(draft.summary.length >= 50, `Summary must be at least 50 characters, got ${draft.summary.length}`);
  expect(draft.description.length >= 200, `Description must be at least 200 characters, got ${draft.description.length}`);
  expect(draft.affectedComponents.length > 0, 'At least one affected component is required');
  expect(draft.stepsToReproduce.length >= 2, 'At least 2 steps to reproduce are required');
  expect(researcherAgentId >= 0n, `Researcher agent ID must be non-negative, got ${researcherAgentId.toString()}`);
  // Rate limiting - prevent spam
  checkRateLimit(researcher);

  // Duplicate detection - check if similar vulnerability already reported
  const vulnHash = computeVulnerabilityHash(draft);
  const existingId = checkDuplicate(vulnHash);
  if (existingId) {
    throw new Error(`Duplicate vulnerability: similar report already exists (${existingId.slice(0, 12)}...)`);
  }

  // Create full report for encryption
  const fullReport = JSON.stringify({
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    affectedComponents: draft.affectedComponents,
    stepsToReproduce: draft.stepsToReproduce,
    proofOfConcept: draft.proofOfConcept,
    suggestedFix: draft.suggestedFix,
    submittedAt: new Date().toISOString(),
  });

  // Encrypt the report - REQUIRED, no fallback
  const encrypted = await encryptReport(fullReport);

  // Create PoC hash
  const pocHash = draft.proofOfConcept 
    ? keccak256(stringToHex(draft.proofOfConcept))
    : '0x' + '0'.repeat(64);

  // Generate submission ID
  const submissionId = keccak256(
    stringToHex(`${submissionCounter++}-${researcher}-${Date.now()}`)
  );

  const stake = parseEther('0.01'); // Default stake amount

  const submission: BountySubmission = {
    submissionId,
    researcher,
    researcherAgentId,
    severity: draft.severity,
    vulnType: draft.vulnType,
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    encryptedReportCid: encrypted.cid,
    encryptionKeyId: encrypted.keyId,
    proofOfConceptHash: pocHash,
    affectedComponents: draft.affectedComponents,
    stepsToReproduce: draft.stepsToReproduce,
    suggestedFix: draft.suggestedFix,
    stake,
    submittedAt: Math.floor(Date.now() / 1000),
    validatedAt: 0,
    resolvedAt: 0,
    status: BountySubmissionStatus.PENDING,
    validationResult: ValidationResult.NEEDS_REVIEW,
    validationNotes: '',
    rewardAmount: 0n,
    guardianApprovals: 0,
    guardianRejections: 0,
    fixCommitHash: '',
    disclosureDate: 0,
    researcherDisclosed: false,
  };

  submissions.set(submissionId, submission);
  guardianVotes.set(submissionId, []);
  
  // Record vulnerability hash for duplicate detection
  vulnerabilityHashes.set(vulnHash, submissionId);

  // Update researcher stats
  const stats = researcherStats.get(researcher) ?? {
    address: researcher,
    totalSubmissions: 0,
    approvedSubmissions: 0,
    rejectedSubmissions: 0,
    totalEarned: 0n,
    averageReward: 0n,
    successRate: 0,
  };
  stats.totalSubmissions++;
  researcherStats.set(researcher, stats);

  console.log(`[BugBounty] Submission created: ${submissionId.slice(0, 12)}... (${draft.severity})`);

  // Trigger automated validation
  await triggerValidation(submissionId);

  return submission;
}

export function getSubmission(submissionId: string): BountySubmission | null {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  return submissions.get(submissionId) ?? null;
}

export function listSubmissions(filter?: {
  status?: BountySubmissionStatus;
  researcher?: Address;
  severity?: BountySeverity;
}): BountySubmission[] {
  let result = Array.from(submissions.values());

  if (filter?.status !== undefined) {
    result = result.filter(s => s.status === filter.status);
  }
  if (filter?.researcher) {
    result = result.filter(s => s.researcher.toLowerCase() === filter.researcher!.toLowerCase());
  }
  if (filter?.severity !== undefined) {
    result = result.filter(s => s.severity === filter.severity);
  }

  // Sort by priority: stake amount * severity
  return result.sort((a, b) => {
    const priorityA = Number(a.stake) * (a.severity + 1);
    const priorityB = Number(b.stake) * (b.severity + 1);
    return priorityB - priorityA;
  });
}

// ============ Validation (Decentralized via DWS) ============

export async function triggerValidation(submissionId: string): Promise<void> {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  const submission = submissions.get(submissionId);
  expect(submission !== null && submission !== undefined, `Submission ${submissionId} not found`);

  submission.status = BountySubmissionStatus.VALIDATING;
  submissions.set(submissionId, submission);

  // Trigger DWS compute sandbox job (decentralized container execution)
  const dwsEndpoint = getDWSEndpoint();
  let response: Response | null = null;
  let connectionError: string | null = null;
  
  try {
    response = await fetch(`${dwsEndpoint}/api/containers/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageRef: 'jeju/security-sandbox:latest',
        command: ['validate-vulnerability'],
        env: {
          SUBMISSION_ID: submissionId,
          POC_HASH: submission.proofOfConceptHash,
          SEVERITY: String(submission.severity),
          VULN_TYPE: String(submission.vulnType),
        },
        resources: {
          cpuCores: 2,
          memoryMb: 4096,
          storageMb: 1024,
        },
        mode: 'serverless',
        timeout: 3600, // 1 hour max
      }),
    });
  } catch (err) {
    connectionError = err instanceof Error ? err.message : String(err);
  }

  if (response?.ok) {
    const result = await response.json() as { executionId: string };
    if (!result.executionId) {
      console.warn(`[BugBounty] DWS returned success but missing executionId`);
    }
    console.log(`[BugBounty] Validation job started: ${result.executionId}`);
  } else if (TEST_MODE) {
    // Test mode: move to guardian review for testing
    console.log('[BugBounty] TEST MODE: Skipping DWS validation');
    submission.status = BountySubmissionStatus.GUARDIAN_REVIEW;
    submission.validationResult = ValidationResult.VALID;
    submission.validationNotes = 'TEST MODE: Validation skipped';
    submissions.set(submissionId, submission);
  } else {
    // Production: DWS unavailable - keep in VALIDATING status, require manual validation
    // NO automatic approval when infrastructure is down - fail safe
    const errorDetail = connectionError 
      ? `Connection error: ${connectionError}` 
      : response 
        ? `HTTP ${response.status}: ${response.statusText}` 
        : 'Unknown error';
    console.log(`[BugBounty] DWS unavailable (${errorDetail}) - submission pending manual validation`);
    submission.validationNotes = `Automated validation unavailable (${errorDetail}) - awaiting manual review`;
    submissions.set(submissionId, submission);
  }
}

export function completeValidation(
  submissionId: string,
  result: ValidationResult,
  notes: string
): BountySubmission {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  expectDefined(notes, 'Validation notes are required');
  const submission = submissions.get(submissionId);
  expect(submission !== null && submission !== undefined, `Submission ${submissionId} not found`);

  submission.validatedAt = Math.floor(Date.now() / 1000);
  submission.validationResult = result;
  submission.validationNotes = notes;

  if (result === ValidationResult.VALID) {
    submission.status = BountySubmissionStatus.GUARDIAN_REVIEW;
    console.log(`[BugBounty] Validation passed, moving to guardian review: ${submissionId.slice(0, 12)}...`);
  } else if (result === ValidationResult.INVALID) {
    submission.status = BountySubmissionStatus.REJECTED;
    submission.resolvedAt = Math.floor(Date.now() / 1000);
    console.log(`[BugBounty] Validation failed, rejected: ${submissionId.slice(0, 12)}...`);
  } else if (result === ValidationResult.NEEDS_REVIEW) {
    submission.status = BountySubmissionStatus.PENDING;
    console.log(`[BugBounty] Needs more review: ${submissionId.slice(0, 12)}...`);
  }

  submissions.set(submissionId, submission);
  return submission;
}

// ============ Guardian Review ============

export function submitGuardianVote(
  submissionId: string,
  guardian: Address,
  agentId: bigint,
  approved: boolean,
  suggestedReward: bigint,
  feedback: string
): BountyGuardianVote {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  expectDefined(feedback, 'Feedback is required');
  expect(feedback.length >= 10, `Feedback must be at least 10 characters, got ${feedback.length}`);
  expect(suggestedReward >= 0n, `Suggested reward must be non-negative, got ${suggestedReward.toString()}`);
  expect(agentId >= 0n, `Agent ID must be non-negative, got ${agentId.toString()}`);
  
  const submission = submissions.get(submissionId);
  expect(submission !== null && submission !== undefined, `Submission ${submissionId} not found`);
  expect(submission.status === BountySubmissionStatus.GUARDIAN_REVIEW, 'Submission not in guardian review');

  const existingVotes = guardianVotes.get(submissionId) ?? [];
  expect(!existingVotes.some(v => v.guardian.toLowerCase() === guardian.toLowerCase()), 'Guardian already voted');

  const vote: BountyGuardianVote = {
    submissionId,
    guardian,
    agentId,
    approved,
    suggestedReward,
    feedback,
    votedAt: Math.floor(Date.now() / 1000),
  };

  existingVotes.push(vote);
  guardianVotes.set(submissionId, existingVotes);

  if (approved) {
    submission.guardianApprovals++;
  } else {
    submission.guardianRejections++;
  }

  // Check quorum
  const requiredApprovals = getRequiredApprovals(submission.severity);
  
  if (submission.guardianApprovals >= requiredApprovals) {
    // Calculate average reward from approving guardians
    const approvingVotes = existingVotes.filter(v => v.approved);
    const totalSuggested = approvingVotes.reduce((sum, v) => sum + v.suggestedReward, 0n);
    submission.rewardAmount = totalSuggested / BigInt(approvingVotes.length);

    // Critical/High severity goes to CEO
    if (submission.severity === BountySeverity.CRITICAL || submission.severity === BountySeverity.HIGH) {
      submission.status = BountySubmissionStatus.CEO_REVIEW;
      console.log(`[BugBounty] Guardian approved, escalating to CEO: ${submissionId.slice(0, 12)}...`);
    } else {
      submission.status = BountySubmissionStatus.APPROVED;
      submission.resolvedAt = Math.floor(Date.now() / 1000);
      console.log(`[BugBounty] Guardian approved: ${submissionId.slice(0, 12)}...`);
    }
  } else if (submission.guardianRejections > 5) {
    submission.status = BountySubmissionStatus.REJECTED;
    submission.resolvedAt = Math.floor(Date.now() / 1000);
    console.log(`[BugBounty] Guardian rejected: ${submissionId.slice(0, 12)}...`);
  }

  submissions.set(submissionId, submission);
  return vote;
}

function getRequiredApprovals(severity: BountySeverity): number {
  switch (severity) {
    case BountySeverity.CRITICAL: return 5;
    case BountySeverity.HIGH: return 4;
    case BountySeverity.MEDIUM: return 3;
    case BountySeverity.LOW: return 2;
  }
}

export function getGuardianVotes(submissionId: string): BountyGuardianVote[] {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  return guardianVotes.get(submissionId) ?? [];
}

// ============ CEO Decision ============

export function ceoDecision(
  submissionId: string,
  approved: boolean,
  rewardAmount: bigint,
  notes: string
): BountySubmission {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  expectDefined(notes, 'CEO decision notes are required');
  expect(notes.length >= 10, `Notes must be at least 10 characters, got ${notes.length}`);
  expect(rewardAmount >= 0n, `Reward amount must be non-negative, got ${rewardAmount.toString()}`);
  
  const submission = submissions.get(submissionId);
  expect(submission !== null && submission !== undefined, `Submission ${submissionId} not found`);
  expect(submission.status === BountySubmissionStatus.CEO_REVIEW, 'Submission not in CEO review');

  if (approved) {
    submission.status = BountySubmissionStatus.APPROVED;
    submission.rewardAmount = rewardAmount;
    submission.validationNotes = notes;

    // Update researcher stats
    const stats = researcherStats.get(submission.researcher);
    if (stats) {
      stats.approvedSubmissions++;
      stats.totalSubmissions++;
      stats.successRate = Math.round((stats.approvedSubmissions / stats.totalSubmissions) * 100);
      researcherStats.set(submission.researcher, stats);
    }

    console.log(`[BugBounty] CEO approved: ${submissionId.slice(0, 12)}... for ${formatEther(rewardAmount)} ETH`);
  } else {
    submission.status = BountySubmissionStatus.REJECTED;
    submission.validationNotes = notes;
    console.log(`[BugBounty] CEO rejected: ${submissionId.slice(0, 12)}...`);
  }

  submission.resolvedAt = Math.floor(Date.now() / 1000);
  submissions.set(submissionId, submission);
  return submission;
}

// ============ Payout ============

export async function payReward(submissionId: string): Promise<{ txHash: string; amount: bigint }> {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  
  const submission = submissions.get(submissionId);
  expect(submission !== null && submission !== undefined, `Submission ${submissionId} not found`);
  expect(submission.status === BountySubmissionStatus.APPROVED, 'Submission not approved');
  expect(submission.rewardAmount > 0n, `Reward amount must be positive, got ${submission.rewardAmount.toString()}`);

  // In production, this would interact with the smart contract
  // For now, mark as paid
  submission.status = BountySubmissionStatus.PAID;
  submissions.set(submissionId, submission);

  // Update researcher stats
  const stats = researcherStats.get(submission.researcher);
  if (stats) {
    stats.totalEarned += submission.rewardAmount;
    researcherStats.set(submission.researcher, stats);
  }

  console.log(`[BugBounty] Reward paid: ${submissionId.slice(0, 12)}... - ${formatEther(submission.rewardAmount)} ETH`);

  return {
    txHash: keccak256(stringToHex(`payout-${submissionId}-${Date.now()}`)),
    amount: submission.rewardAmount,
  };
}

// ============ Disclosure ============

export function recordFix(submissionId: string, commitHash: string): BountySubmission {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  expectDefined(commitHash, 'Commit hash is required');
  expect(commitHash.match(/^[a-f0-9]{40}$/) !== null, `Invalid commit hash format: ${commitHash}`);
  
  const submission = submissions.get(submissionId);
  expect(submission !== null && submission !== undefined, `Submission ${submissionId} not found`);

  submission.fixCommitHash = commitHash;
  submission.disclosureDate = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days grace

  submissions.set(submissionId, submission);
  console.log(`[BugBounty] Fix recorded, disclosure scheduled: ${submissionId.slice(0, 12)}...`);

  return submission;
}

export function researcherDisclose(submissionId: string, researcher: Address): BountySubmission {
  expectDefined(submissionId, 'Submission ID is required');
  expect(submissionId.length > 0, `Submission ID cannot be empty`);
  
  const submission = submissions.get(submissionId);
  expect(submission !== null && submission !== undefined, `Submission ${submissionId} not found`);
  expect(submission.researcher.toLowerCase() === researcher.toLowerCase(), 'Not the researcher');

  submission.researcherDisclosed = true;
  if (submission.fixCommitHash) {
    submission.disclosureDate = Math.floor(Date.now() / 1000);
  }

  submissions.set(submissionId, submission);
  return submission;
}

// ============ Stats ============

export function getResearcherStats(address: Address): ResearcherStats {
  expectDefined(address, 'Researcher address is required');
  expect(address.match(/^0x[a-fA-F0-9]{40}$/) !== null, `Invalid address format: ${address}`);
  return researcherStats.get(address) ?? {
    address,
    totalSubmissions: 0,
    approvedSubmissions: 0,
    rejectedSubmissions: 0,
    totalEarned: 0n,
    averageReward: 0n,
    successRate: 0,
  };
}

export function getBountyPoolStats(): BountyPoolStats {
  const allSubmissions = Array.from(submissions.values());
  
  const pendingPayouts = allSubmissions
    .filter(s => s.status === BountySubmissionStatus.APPROVED)
    .reduce((sum, s) => sum + s.rewardAmount, 0n);

  const totalPaidOut = allSubmissions
    .filter(s => s.status === BountySubmissionStatus.PAID)
    .reduce((sum, s) => sum + s.rewardAmount, 0n);

  const activeSubmissions = allSubmissions.filter(s => 
    s.status !== BountySubmissionStatus.PAID &&
    s.status !== BountySubmissionStatus.REJECTED &&
    s.status !== BountySubmissionStatus.WITHDRAWN
  ).length;

  return {
    totalPool: parseEther('100'), // Would query contract
    totalPaidOut,
    pendingPayouts,
    activeSubmissions,
    guardianCount: 10, // Would query contract
  };
}

// ============ Singleton ============

let instance: BugBountyService | null = null;

export class BugBountyService {
  assess = assessSubmission;
  submit = submitBounty;
  get = getSubmission;
  list = listSubmissions;
  triggerValidation = triggerValidation;
  completeValidation = completeValidation;
  guardianVote = submitGuardianVote;
  getGuardianVotes = getGuardianVotes;
  ceoDecision = ceoDecision;
  payReward = payReward;
  recordFix = recordFix;
  researcherDisclose = researcherDisclose;
  getResearcherStats = getResearcherStats;
  getPoolStats = getBountyPoolStats;
}

export function getBugBountyService(): BugBountyService {
  return instance ??= new BugBountyService();
}

// Reset for testing - clears all in-memory state
export function resetBugBountyService(): void {
  submissions.clear();
  guardianVotes.clear();
  researcherStats.clear();
  vulnerabilityHashes.clear();
  rateLimit.clear();
  submissionCounter = 1;
  instance = null;
}
