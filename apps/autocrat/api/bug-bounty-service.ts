/**
 * Bug Bounty Service - Decentralized Security Vulnerability Management
 *
 * Fully integrated with:
 * - EQLite for persistent state
 * - SecurityBountyRegistry smart contract for on-chain operations
 * - DWS compute for sandbox validation
 * - dstack TEE for secure execution (simulator in local dev)
 */

import {
  getCurrentNetwork,
  getDWSComputeUrl,
  getKMSUrl,
  getRpcUrl,
  getSecurityBountyRegistryAddress,
} from '@jejunetwork/config'
import { type EQLiteClient, getEQLite, type QueryParam } from '@jejunetwork/db'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import { expectDefined, expectValid } from '@jejunetwork/types'
import { writeContract } from '@jejunetwork/contracts'
import {
  type Address,
  createPublicClient,
  http,
  isAddress,
  isHex,
  keccak256,
  stringToHex,
} from 'viem'
import { base, baseSepolia, localhost } from 'viem/chains'
import {
  type BountyAssessment,
  type BountyGuardianVote,
  type BountyPoolStats,
  BountySeverity,
  BountySeveritySchema,
  type BountySubmission,
  type BountySubmissionDraft,
  BountySubmissionSchema,
  BountySubmissionStatus,
  BountySubmissionStatusSchema,
  KMSEncryptResponseSchema,
  type ResearcherStats,
  rowAddress,
  rowBigInt,
  rowNumber,
  rowOptionalNumber,
  rowOptionalString,
  rowString,
  type SandboxResult,
  SandboxResultSchema,
  SEVERITY_REWARDS,
  StringArraySchema,
  toHex,
  ValidationResult,
  ValidationResultSchema,
  VulnerabilityType,
  VulnerabilityTypeName,
  VulnerabilityTypeSchema,
} from '../lib'
import { config } from './config'
import { createKMSHttpWalletClient, getOperatorConfig } from './kms-signer'

const EQLITE_DATABASE_ID = config.eqliteDatabaseId

// KMS wallet client instance (initialized lazily)
let kmsWalletClient: Awaited<ReturnType<typeof createKMSWalletClient>> | null = null

// Config handles env overrides
function getDWSEndpoint(): string {
  return getDWSComputeUrl()
}

function getKMSEndpoint(): string {
  return getKMSUrl()
}

function getChain() {
  const network = getCurrentNetwork()
  switch (network) {
    case 'mainnet':
      return base
    case 'testnet':
      return baseSepolia
    default:
      return localhost
  }
}
let eqliteClient: EQLiteClient | null = null
let cacheClient: CacheClient | null = null
let initialized = false

async function getEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite({
      databaseId: EQLITE_DATABASE_ID,
      timeout: 30000,
      debug: !config.isProduction,
    })

    const healthy = await eqliteClient.isHealthy()
    if (!healthy) {
      throw new Error(
        `Bug Bounty requires EQLite (network: ${getCurrentNetwork()}).\n` +
          'Ensure EQLite is running: docker compose up -d eqlite',
      )
    }

    await ensureTablesExist()
  }
  return eqliteClient
}

function getCache(): CacheClient {
  if (!cacheClient) {
    cacheClient = getCacheClient('bug-bounty')
  }
  return cacheClient
}

async function ensureTablesExist(): Promise<void> {
  if (!eqliteClient) return

  await eqliteClient.exec(
    `
    CREATE TABLE IF NOT EXISTS bounty_submissions (
      submission_id TEXT PRIMARY KEY,
      researcher TEXT NOT NULL,
      researcher_agent_id TEXT,
      severity INTEGER NOT NULL,
      vuln_type INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT NOT NULL,
      affected_components TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      proof_of_concept TEXT,
      suggested_fix TEXT,
      encrypted_report_cid TEXT,
      encryption_key_id TEXT,
      poc_hash TEXT,
      stake TEXT NOT NULL DEFAULT '0',
      status INTEGER NOT NULL DEFAULT 0,
      validation_result INTEGER DEFAULT 0,
      validation_notes TEXT,
      reward_amount TEXT DEFAULT '0',
      guardian_approvals INTEGER DEFAULT 0,
      guardian_rejections INTEGER DEFAULT 0,
      fix_commit_hash TEXT,
      disclosure_date INTEGER,
      researcher_disclosed INTEGER DEFAULT 0,
      submitted_at INTEGER NOT NULL,
      validated_at INTEGER,
      resolved_at INTEGER,
      vuln_hash TEXT UNIQUE
    )
  `,
    [],
    EQLITE_DATABASE_ID,
  )

  await eqliteClient.exec(
    `
    CREATE TABLE IF NOT EXISTS bounty_guardian_votes (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      guardian TEXT NOT NULL,
      guardian_agent_id TEXT,
      approved INTEGER NOT NULL,
      suggested_reward TEXT,
      feedback TEXT,
      voted_at INTEGER NOT NULL,
      UNIQUE(submission_id, guardian)
    )
  `,
    [],
    EQLITE_DATABASE_ID,
  )

  await eqliteClient.exec(
    `
    CREATE TABLE IF NOT EXISTS bounty_researcher_stats (
      researcher TEXT PRIMARY KEY,
      total_submissions INTEGER DEFAULT 0,
      approved_submissions INTEGER DEFAULT 0,
      rejected_submissions INTEGER DEFAULT 0,
      total_earned TEXT DEFAULT '0',
      average_reward TEXT DEFAULT '0',
      success_rate REAL DEFAULT 0
    )
  `,
    [],
    EQLITE_DATABASE_ID,
  )

  await eqliteClient.exec(
    `
    CREATE TABLE IF NOT EXISTS bounty_rate_limits (
      researcher TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      window_start INTEGER NOT NULL
    )
  `,
    [],
    EQLITE_DATABASE_ID,
  )

  // Indexes
  await eqliteClient.exec(
    `CREATE INDEX IF NOT EXISTS idx_submissions_status ON bounty_submissions(status)`,
    [],
    EQLITE_DATABASE_ID,
  )
  await eqliteClient.exec(
    `CREATE INDEX IF NOT EXISTS idx_submissions_researcher ON bounty_submissions(researcher)`,
    [],
    EQLITE_DATABASE_ID,
  )
  await eqliteClient.exec(
    `CREATE INDEX IF NOT EXISTS idx_submissions_severity ON bounty_submissions(severity)`,
    [],
    EQLITE_DATABASE_ID,
  )
  await eqliteClient.exec(
    `CREATE INDEX IF NOT EXISTS idx_votes_submission ON bounty_guardian_votes(submission_id)`,
    [],
    EQLITE_DATABASE_ID,
  )
}
const SECURITY_BOUNTY_REGISTRY_ABI = [
  'function submitVulnerability(uint8 severity, uint8 vulnType, bytes32 encryptedReportCid, bytes32 encryptionKeyId, bytes32 proofOfConceptHash) external payable returns (bytes32)',
  'function completeValidation(bytes32 submissionId, uint8 result, string memory notes) external',
  'function submitGuardianVote(bytes32 submissionId, bool approved, uint256 suggestedReward, string memory feedback) external',
  'function ceoDecision(bytes32 submissionId, bool approved, uint256 rewardAmount, string memory reasoning) external',
  'function payReward(bytes32 submissionId) external',
  'function getSubmission(bytes32 submissionId) external view returns (tuple(bytes32 submissionId, address researcher, uint256 researcherAgentId, uint8 severity, uint8 vulnType, bytes32 encryptedReportCid, bytes32 encryptionKeyId, bytes32 proofOfConceptHash, uint256 stake, uint256 submittedAt, uint256 validatedAt, uint256 resolvedAt, uint8 status, uint8 validationResult, string validationNotes, uint256 rewardAmount, uint256 guardianApprovals, uint256 guardianRejections, bytes32 fixCommitHash, uint256 disclosureDate, bool researcherDisclosed))',
  'function getTotalPool() external view returns (uint256)',
  'function getGuardianCount() external view returns (uint256)',
  'event VulnerabilitySubmitted(bytes32 indexed submissionId, address indexed researcher, uint8 severity)',
  'event ValidationCompleted(bytes32 indexed submissionId, uint8 result)',
  'event RewardPaid(bytes32 indexed submissionId, address indexed researcher, uint256 amount)',
] as const

function getPublicClient() {
  return createPublicClient({
    chain: getChain(),
    transport: http(getRpcUrl()),
  })
}

async function getKMSWalletClientInstance() {
  if (!kmsWalletClient) {
    const operatorConfig = getOperatorConfig()
    if (!operatorConfig) {
      throw new Error(
        'OPERATOR_KEY or OPERATOR_PRIVATE_KEY required for contract operations',
      )
    }
kmsWalletClient = await createKMSWalletClient(operatorConfig, getChain(), getRpcUrl())
  }
  return kmsWalletClient
}

function getContractAddressOrThrow(): Address {
  // Config handles env overrides (SECURITY_BOUNTY_REGISTRY_ADDRESS)
  const addr = getSecurityBountyRegistryAddress()
  if (!addr || addr === '0x0000000000000000000000000000000000000000') {
    throw new Error(
      `SecurityBountyRegistry not deployed on ${getCurrentNetwork()}`,
    )
  }
  if (!isAddress(addr)) {
    throw new Error(
      `Invalid SecurityBountyRegistry address from config: ${addr}`,
    )
  }
  return addr
}
const RATE_LIMIT_WINDOW = 3600 * 1000 // 1 hour
const MAX_SUBMISSIONS_PER_WINDOW = 5

async function checkRateLimit(researcher: Address): Promise<void> {
  const client = await getEQLiteClient()
  const now = Date.now()
  const key = researcher.toLowerCase()

  const result = await client.query<{ count: number; window_start: number }>(
    'SELECT count, window_start FROM bounty_rate_limits WHERE researcher = ?',
    [key],
    EQLITE_DATABASE_ID,
  )

  if (
    result.rows.length === 0 ||
    now - result.rows[0].window_start > RATE_LIMIT_WINDOW
  ) {
    await client.exec(
      `INSERT INTO bounty_rate_limits (researcher, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(researcher) DO UPDATE SET count = 1, window_start = ?`,
      [key, now, now],
      EQLITE_DATABASE_ID,
    )
    return
  }

  const limit = result.rows[0]
  if (limit.count >= MAX_SUBMISSIONS_PER_WINDOW) {
    throw new Error(
      `Rate limit exceeded: max ${MAX_SUBMISSIONS_PER_WINDOW} submissions per hour`,
    )
  }

  await client.exec(
    'UPDATE bounty_rate_limits SET count = count + 1 WHERE researcher = ?',
    [key],
    EQLITE_DATABASE_ID,
  )
}
function computeVulnerabilityHash(draft: BountySubmissionDraft): string {
  const content = [
    draft.title.toLowerCase().trim(),
    draft.description.toLowerCase().trim(),
    draft.affectedComponents
      .map((c) => c.toLowerCase().trim())
      .sort()
      .join(','),
    draft.vulnType.toString(),
  ].join('|')
  return keccak256(stringToHex(content))
}

async function checkDuplicate(hash: string): Promise<string | null> {
  const client = await getEQLiteClient()
  const result = await client.query<{ submission_id: string }>(
    'SELECT submission_id FROM bounty_submissions WHERE vuln_hash = ?',
    [hash],
    EQLITE_DATABASE_ID,
  )
  return result.rows[0].submission_id ?? null
}
interface EncryptedReport {
  cid: string
  keyId: string
  encryptedData: string
}

async function encryptReport(report: string): Promise<EncryptedReport> {
  const kmsEndpoint = getKMSEndpoint()

  const response = await fetch(`${kmsEndpoint}/encrypt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: report,
      policy: 'bug-bounty-report',
      threshold: 3,
      shares: 5,
    }),
  })

  if (!response.ok) {
    throw new Error(`KMS encryption failed: ${response.statusText}`)
  }

  const result = expectValid(
    KMSEncryptResponseSchema,
    await response.json(),
    'KMS encryption',
  )
  return {
    cid: result.cid,
    keyId: result.keyId,
    encryptedData: result.encrypted,
  }
}
async function executePoCInSandbox(
  poc: string,
  vulnType: VulnerabilityType,
): Promise<SandboxResult> {
  const dwsEndpoint = getDWSEndpoint()
  const network = getCurrentNetwork()

  // Use dstack TEE in simulator mode for local dev
  const teeMode = network === 'localnet' ? 'simulator' : 'hardware'

  const response = await fetch(`${dwsEndpoint}/compute/container/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: getSandboxImage(vulnType),
      command: ['node', '/sandbox/run.js'],
      env: {
        POC_CODE: poc,
        VULN_TYPE: VulnerabilityTypeName[vulnType],
        NETWORK: network,
      },
      resources: {
        cpu: '500m',
        memory: '256Mi',
        timeout: 60000,
      },
      isolation: {
        mode: 'dedicated',
        tee: {
          enabled: true,
          platform: teeMode,
          attestationRequired: network !== 'localnet',
        },
        networking: {
          allowExternalFetch: false,
          denyHosts: ['*'],
        },
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Sandbox execution failed: ${error}`)
  }

  return expectValid(
    SandboxResultSchema,
    await response.json(),
    'Sandbox execution',
  )
}

function getSandboxImage(vulnType: VulnerabilityType): string {
  switch (vulnType) {
    case VulnerabilityType.FUNDS_AT_RISK:
    case VulnerabilityType.WALLET_DRAIN:
      return 'ghcr.io/jejunetwork/sandbox-evm:latest'
    case VulnerabilityType.REMOTE_CODE_EXECUTION:
      return 'ghcr.io/jejunetwork/sandbox-rce:latest'
    case VulnerabilityType.TEE_BYPASS:
      return 'ghcr.io/jejunetwork/sandbox-tee:latest'
    case VulnerabilityType.CONSENSUS_ATTACK:
      return 'ghcr.io/jejunetwork/sandbox-consensus:latest'
    default:
      return 'ghcr.io/jejunetwork/sandbox-general:latest'
  }
}
export function assessSubmission(
  draft: BountySubmissionDraft,
): BountyAssessment {
  const issues: string[] = []
  let qualityScore = 100

  // Title check
  if (!draft.title || draft.title.length < 10) {
    issues.push('Title too short (min 10 characters)')
    qualityScore -= 20
  }
  if (draft.title && draft.title.length > 200) {
    issues.push('Title too long (max 200 characters)')
    qualityScore -= 10
  }

  // Description check
  if (!draft.description || draft.description.length < 50) {
    issues.push('Description too short (min 50 characters)')
    qualityScore -= 25
  }

  // Affected components
  if (!draft.affectedComponents || draft.affectedComponents.length === 0) {
    issues.push('Must specify affected components')
    qualityScore -= 15
  }

  // Steps to reproduce
  if (!draft.stepsToReproduce || draft.stepsToReproduce.length < 20) {
    issues.push('Steps to reproduce too short')
    qualityScore -= 20
  }

  // Severity validation
  const severity = draft.severity ?? BountySeverity.LOW
  const rewards = SEVERITY_REWARDS[severity]

  return {
    severity,
    estimatedReward: {
      min: rewards.minReward,
      max: rewards.maxReward,
      currency: 'ETH',
    },
    qualityScore: Math.max(0, qualityScore),
    issues,
    readyToSubmit: issues.length === 0 && qualityScore >= 60,
  }
}

export async function submitBounty(
  draft: BountySubmissionDraft,
  researcher: Address,
  researcherAgentId: bigint,
  stake: bigint = 0n,
): Promise<BountySubmission> {
  expectDefined(draft, 'Draft is required')
  expectDefined(researcher, 'Researcher address is required')

  // Rate limit check
  await checkRateLimit(researcher)

  // Duplicate check
  const vulnHash = computeVulnerabilityHash(draft)
  const existingId = await checkDuplicate(vulnHash)
  if (existingId) {
    throw new Error(`Duplicate submission. Existing: ${existingId}`)
  }

  // Encrypt report
  const reportContent = JSON.stringify({
    title: draft.title,
    description: draft.description,
    stepsToReproduce: draft.stepsToReproduce,
    proofOfConcept: draft.proofOfConcept,
    suggestedFix: draft.suggestedFix,
  })

  const encrypted = await encryptReport(reportContent)

  // Generate submission ID
  const submissionId = keccak256(
    stringToHex(`${researcher}-${Date.now()}-${Math.random()}`),
  ).slice(0, 18)

  const now = Math.floor(Date.now() / 1000)
  const pocHash = draft.proofOfConcept
    ? keccak256(stringToHex(draft.proofOfConcept))
    : '0x0000000000000000000000000000000000000000000000000000000000000000'

  const submission: BountySubmission = {
    submissionId,
    researcher,
    researcherAgentId,
    severity: draft.severity ?? BountySeverity.LOW,
    vulnType: draft.vulnType ?? VulnerabilityType.OTHER,
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    affectedComponents: draft.affectedComponents,
    stepsToReproduce: draft.stepsToReproduce,
    proofOfConcept: draft.proofOfConcept,
    suggestedFix: draft.suggestedFix,
    encryptedReportCid: encrypted.cid,
    encryptionKeyId: encrypted.keyId,
    proofOfConceptHash: pocHash,
    stake,
    submittedAt: now,
    status: BountySubmissionStatus.PENDING,
    validationResult: ValidationResult.PENDING,
    rewardAmount: 0n,
    guardianApprovals: 0,
    guardianRejections: 0,
  }

  // Store in EQLite
  const client = await getEQLiteClient()
  await client.exec(
    `INSERT INTO bounty_submissions (
      submission_id, researcher, researcher_agent_id, severity, vuln_type,
      title, summary, description, affected_components, steps_to_reproduce,
      proof_of_concept, suggested_fix, encrypted_report_cid, encryption_key_id,
      poc_hash, stake, status, validation_result, submitted_at, vuln_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      submission.submissionId,
      submission.researcher,
      submission.researcherAgentId.toString(),
      submission.severity,
      submission.vulnType,
      submission.title,
      submission.summary,
      submission.description,
      JSON.stringify(submission.affectedComponents),
      JSON.stringify(submission.stepsToReproduce), // Array to JSON string for storage
      submission.proofOfConcept ?? null,
      submission.suggestedFix ?? null,
      submission.encryptedReportCid,
      submission.encryptionKeyId,
      submission.proofOfConceptHash,
      submission.stake.toString(),
      submission.status,
      submission.validationResult,
      submission.submittedAt,
      vulnHash,
    ],
    EQLITE_DATABASE_ID,
  )

  // Submit to smart contract - fail if contract is required
  const contractAddr = getContractAddressOrThrow()
  const { client: walletClient, account } = await getKMSWalletClientInstance()
  const publicClient = getPublicClient()

  // Convert CID and keyId to bytes32-compatible hex (padded to 32 bytes)
  const cidHex = isHex(encrypted.cid)
    ? encrypted.cid
    : keccak256(stringToHex(encrypted.cid))
  const keyIdHex = isHex(encrypted.keyId)
    ? encrypted.keyId
    : keccak256(stringToHex(encrypted.keyId))

  if (!account) {
    throw new Error('Wallet account not available')
  }
  const hash = await writeContract(walletClient, {
    address: contractAddr,
    abi: SECURITY_BOUNTY_REGISTRY_ABI,
    functionName: 'submitVulnerability',
    args: [submission.severity, submission.vulnType, cidHex, keyIdHex, pocHash],
    value: stake,
    account,
  })

  await publicClient.waitForTransactionReceipt({ hash })

  // Update researcher stats
  await updateResearcherStats(researcher, 'submitted')

  // Invalidate cache
  await getCache().delete(`submission:${submissionId}`)

  return submission
}

export async function getSubmission(
  submissionId: string,
): Promise<BountySubmission | null> {
  // Check cache
  const cache = getCache()
  const cached = await cache.get(`submission:${submissionId}`)
  if (cached) {
    // Validate schema then cast - enum values are validated by schema
    const validated = expectValid(
      BountySubmissionSchema,
      JSON.parse(cached),
      'cached submission',
    )
    return validated as BountySubmission
  }

  const client = await getEQLiteClient()
  const result = await client.query<Record<string, unknown>>(
    'SELECT * FROM bounty_submissions WHERE submission_id = ?',
    [submissionId],
    EQLITE_DATABASE_ID,
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  const submission = rowToSubmission(row)

  // Cache for 5 minutes
  await cache.set(`submission:${submissionId}`, JSON.stringify(submission), 300)

  return submission
}

export async function listSubmissions(
  status?: BountySubmissionStatus,
  researcher?: Address,
  limit = 50,
): Promise<BountySubmission[]> {
  const client = await getEQLiteClient()

  let query = 'SELECT * FROM bounty_submissions'
  const params: QueryParam[] = []
  const conditions: string[] = []

  if (status !== undefined) {
    conditions.push('status = ?')
    params.push(status)
  }

  if (researcher) {
    conditions.push('researcher = ?')
    params.push(researcher.toLowerCase())
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`
  }

  query += ' ORDER BY submitted_at DESC LIMIT ?'
  params.push(limit)

  const result = await client.query<Record<string, unknown>>(
    query,
    params,
    EQLITE_DATABASE_ID,
  )
  return result.rows.map(rowToSubmission)
}

export async function triggerValidation(submissionId: string): Promise<void> {
  const submission = await getSubmission(submissionId)
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found`)
  }
  if (submission.status !== BountySubmissionStatus.PENDING) {
    throw new Error('Submission not in PENDING status')
  }

  // Update status
  const client = await getEQLiteClient()
  await client.exec(
    'UPDATE bounty_submissions SET status = ? WHERE submission_id = ?',
    [BountySubmissionStatus.VALIDATING, submissionId],
    EQLITE_DATABASE_ID,
  )

  // Invalidate cache
  await getCache().delete(`submission:${submissionId}`)

  // Execute PoC in sandbox if available
  if (submission.proofOfConcept) {
    const result = await executePoCInSandbox(
      submission.proofOfConcept,
      submission.vulnType,
    )

    const validationResult = result.exploitTriggered
      ? ValidationResult.VERIFIED
      : ValidationResult.NEEDS_MORE_INFO

    await completeValidation(
      submissionId,
      validationResult,
      result.exploitDetails ?? 'Sandbox validation complete',
    )
  } else {
    // No PoC - move directly to guardian review
    await client.exec(
      'UPDATE bounty_submissions SET status = ?, validation_notes = ? WHERE submission_id = ?',
      [
        BountySubmissionStatus.GUARDIAN_REVIEW,
        'No PoC provided - manual review required',
        submissionId,
      ],
      EQLITE_DATABASE_ID,
    )
  }
}

export async function completeValidation(
  submissionId: string,
  result: ValidationResult,
  notes: string,
): Promise<BountySubmission> {
  const client = await getEQLiteClient()
  const now = Math.floor(Date.now() / 1000)

  let newStatus: BountySubmissionStatus
  if (result === ValidationResult.INVALID) {
    newStatus = BountySubmissionStatus.REJECTED
  } else if (
    result === ValidationResult.VERIFIED ||
    result === ValidationResult.LIKELY_VALID
  ) {
    newStatus = BountySubmissionStatus.GUARDIAN_REVIEW
  } else {
    newStatus = BountySubmissionStatus.VALIDATING
  }

  await client.exec(
    `UPDATE bounty_submissions
     SET status = ?, validation_result = ?, validation_notes = ?, validated_at = ?
     WHERE submission_id = ?`,
    [newStatus, result, notes, now, submissionId],
    EQLITE_DATABASE_ID,
  )

  // Update on-chain
  const contractAddr = getContractAddressOrThrow()
  const { client: walletClient, account } = await getKMSWalletClientInstance()
  const publicClient = getPublicClient()

  if (!account) {
    throw new Error('Wallet account not available')
  }
  const txHash = await writeContract(walletClient, {
    address: contractAddr,
    abi: SECURITY_BOUNTY_REGISTRY_ABI,
    functionName: 'completeValidation',
    args: [toHex(submissionId), result, notes],
    account,
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })

  await getCache().delete(`submission:${submissionId}`)

  const submission = await getSubmission(submissionId)
  if (!submission) {
    throw new Error(`Failed to fetch updated submission ${submissionId}`)
  }
  return submission
}

export async function submitGuardianVote(
  submissionId: string,
  guardian: Address,
  guardianAgentId: bigint,
  approved: boolean,
  suggestedReward: bigint,
  feedback: string,
): Promise<void> {
  const client = await getEQLiteClient()
  const now = Math.floor(Date.now() / 1000)
  const voteId = keccak256(
    stringToHex(`${submissionId}-${guardian}-${now}`),
  ).slice(0, 18)

  await client.exec(
    `INSERT INTO bounty_guardian_votes (
      id, submission_id, guardian, guardian_agent_id, approved, suggested_reward, feedback, voted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(submission_id, guardian) DO UPDATE SET
      approved = ?, suggested_reward = ?, feedback = ?, voted_at = ?`,
    [
      voteId,
      submissionId,
      guardian.toLowerCase(),
      guardianAgentId.toString(),
      approved ? 1 : 0,
      suggestedReward.toString(),
      feedback,
      now,
      approved ? 1 : 0,
      suggestedReward.toString(),
      feedback,
      now,
    ],
    EQLITE_DATABASE_ID,
  )

  // Update submission counts
  if (approved) {
    await client.exec(
      'UPDATE bounty_submissions SET guardian_approvals = guardian_approvals + 1 WHERE submission_id = ?',
      [submissionId],
      EQLITE_DATABASE_ID,
    )
  } else {
    await client.exec(
      'UPDATE bounty_submissions SET guardian_rejections = guardian_rejections + 1 WHERE submission_id = ?',
      [submissionId],
      EQLITE_DATABASE_ID,
    )
  }

  // Update on-chain
  const contractAddr = getContractAddressOrThrow()
  const { client: walletClient, account } = await getKMSWalletClientInstance()
  const publicClient = getPublicClient()

  if (!account) {
    throw new Error('Wallet account not available')
  }
  const guardianHash = await writeContract(walletClient, {
    address: contractAddr,
    abi: SECURITY_BOUNTY_REGISTRY_ABI,
    functionName: 'submitGuardianVote',
    args: [toHex(submissionId), approved, suggestedReward, feedback],
    account,
  })

  await publicClient.waitForTransactionReceipt({ hash: guardianHash })

  await getCache().delete(`submission:${submissionId}`)

  // Check if quorum reached and escalate to CEO
  const submission = await getSubmission(submissionId)
  if (submission) {
    const severity = submission.severity
    const requiredApprovals = severity >= BountySeverity.HIGH ? 5 : 3

    if (submission.guardianApprovals >= requiredApprovals) {
      await client.exec(
        'UPDATE bounty_submissions SET status = ? WHERE submission_id = ?',
        [BountySubmissionStatus.DIRECTOR_REVIEW, submissionId],
        EQLITE_DATABASE_ID,
      )
      await getCache().delete(`submission:${submissionId}`)
    }
  }
}

export async function getGuardianVotes(
  submissionId: string,
): Promise<BountyGuardianVote[]> {
  const client = await getEQLiteClient()
  const result = await client.query<Record<string, unknown>>(
    'SELECT * FROM bounty_guardian_votes WHERE submission_id = ? ORDER BY voted_at ASC',
    [submissionId],
    EQLITE_DATABASE_ID,
  )

  return result.rows.map((row) => ({
    submissionId: rowString(row, 'submission_id'),
    guardian: rowAddress(row, 'guardian'),
    guardianAgentId: rowBigInt(row, 'guardian_agent_id'),
    approved: rowNumber(row, 'approved') === 1,
    suggestedReward: rowBigInt(row, 'suggested_reward'),
    feedback: rowString(row, 'feedback'),
    votedAt: rowNumber(row, 'voted_at'),
  }))
}

export async function ceoDecision(
  submissionId: string,
  approved: boolean,
  rewardAmount: bigint,
  reasoning: string,
): Promise<BountySubmission> {
  const client = await getEQLiteClient()
  const now = Math.floor(Date.now() / 1000)

  const newStatus = approved
    ? BountySubmissionStatus.APPROVED
    : BountySubmissionStatus.REJECTED

  await client.exec(
    `UPDATE bounty_submissions
     SET status = ?, reward_amount = ?, validation_notes = COALESCE(validation_notes, '') || '\nCEO: ' || ?, resolved_at = ?
     WHERE submission_id = ?`,
    [newStatus, rewardAmount.toString(), reasoning, now, submissionId],
    EQLITE_DATABASE_ID,
  )

  // Update on-chain
  const contractAddr = getContractAddressOrThrow()
  const { client: walletClient, account } = await getKMSWalletClientInstance()
  const publicClient = getPublicClient()

  if (!account) {
    throw new Error('Wallet account not available')
  }
  const ceoHash = await writeContract(walletClient, {
    address: contractAddr,
    abi: SECURITY_BOUNTY_REGISTRY_ABI,
    functionName: 'ceoDecision',
    args: [toHex(submissionId), approved, rewardAmount, reasoning],
    account,
  })

  await publicClient.waitForTransactionReceipt({ hash: ceoHash })

  await getCache().delete(`submission:${submissionId}`)

  const submission = await getSubmission(submissionId)
  if (!submission) {
    throw new Error(`Failed to fetch updated submission ${submissionId}`)
  }

  // Update researcher stats
  await updateResearcherStats(
    submission.researcher,
    approved ? 'approved' : 'rejected',
    rewardAmount,
  )

  return submission
}

export async function payReward(
  submissionId: string,
): Promise<{ txHash: string; amount: bigint }> {
  const submission = await getSubmission(submissionId)
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found`)
  }
  if (submission.status !== BountySubmissionStatus.APPROVED) {
    throw new Error('Submission not approved')
  }
  if (submission.rewardAmount <= 0n) {
    throw new Error('Reward amount must be positive')
  }

  const client = await getEQLiteClient()

  // Execute on-chain payout
  const contractAddr = getContractAddressOrThrow()
  const { client: walletClient, account } = await getKMSWalletClientInstance()
  const publicClient = getPublicClient()

  if (!account) {
    throw new Error('Wallet account not available')
  }
  const payoutHash = await writeContract(walletClient, {
    address: contractAddr,
    abi: SECURITY_BOUNTY_REGISTRY_ABI,
    functionName: 'payReward',
    args: [toHex(submissionId)],
    account,
  })

  await publicClient.waitForTransactionReceipt({ hash: payoutHash })
  const txHash = payoutHash

  await client.exec(
    'UPDATE bounty_submissions SET status = ? WHERE submission_id = ?',
    [BountySubmissionStatus.PAID, submissionId],
    EQLITE_DATABASE_ID,
  )

  await getCache().delete(`submission:${submissionId}`)

  return { txHash, amount: submission.rewardAmount }
}

export async function recordFix(
  submissionId: string,
  commitHash: string,
): Promise<BountySubmission> {
  if (!/^[a-f0-9]{40}$/.test(commitHash)) {
    throw new Error('Invalid commit hash format')
  }

  const client = await getEQLiteClient()
  const disclosureDate = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days grace

  await client.exec(
    'UPDATE bounty_submissions SET fix_commit_hash = ?, disclosure_date = ? WHERE submission_id = ?',
    [commitHash, disclosureDate, submissionId],
    EQLITE_DATABASE_ID,
  )

  await getCache().delete(`submission:${submissionId}`)

  const submission = await getSubmission(submissionId)
  if (!submission) {
    throw new Error(`Failed to fetch updated submission ${submissionId}`)
  }
  return submission
}

export async function researcherDisclose(
  submissionId: string,
  researcher: Address,
): Promise<BountySubmission> {
  const submission = await getSubmission(submissionId)
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found`)
  }
  if (submission.researcher.toLowerCase() !== researcher.toLowerCase()) {
    throw new Error('Not the researcher')
  }

  const client = await getEQLiteClient()

  await client.exec(
    'UPDATE bounty_submissions SET researcher_disclosed = 1 WHERE submission_id = ?',
    [submissionId],
    EQLITE_DATABASE_ID,
  )

  await getCache().delete(`submission:${submissionId}`)

  const updated = await getSubmission(submissionId)
  if (!updated) {
    throw new Error(`Failed to fetch updated submission ${submissionId}`)
  }
  return updated
}
async function updateResearcherStats(
  researcher: Address,
  action: 'submitted' | 'approved' | 'rejected',
  reward?: bigint,
): Promise<void> {
  const client = await getEQLiteClient()
  const key = researcher.toLowerCase()

  const existing = await client.query<Record<string, unknown>>(
    'SELECT * FROM bounty_researcher_stats WHERE researcher = ?',
    [key],
    EQLITE_DATABASE_ID,
  )

  if (existing.rows.length === 0) {
    await client.exec(
      `INSERT INTO bounty_researcher_stats (researcher, total_submissions, approved_submissions, rejected_submissions, total_earned)
       VALUES (?, 1, 0, 0, '0')`,
      [key],
      EQLITE_DATABASE_ID,
    )
  }

  if (action === 'submitted') {
    await client.exec(
      'UPDATE bounty_researcher_stats SET total_submissions = total_submissions + 1 WHERE researcher = ?',
      [key],
      EQLITE_DATABASE_ID,
    )
  } else if (action === 'approved') {
    await client.exec(
      `UPDATE bounty_researcher_stats
       SET approved_submissions = approved_submissions + 1,
           total_earned = CAST((CAST(total_earned AS INTEGER) + ?) AS TEXT)
       WHERE researcher = ?`,
      [reward?.toString() ?? '0', key],
      EQLITE_DATABASE_ID,
    )
  } else if (action === 'rejected') {
    await client.exec(
      'UPDATE bounty_researcher_stats SET rejected_submissions = rejected_submissions + 1 WHERE researcher = ?',
      [key],
      EQLITE_DATABASE_ID,
    )
  }
}

export async function getResearcherStats(
  researcher: Address,
): Promise<ResearcherStats> {
  const client = await getEQLiteClient()
  const result = await client.query<Record<string, unknown>>(
    'SELECT * FROM bounty_researcher_stats WHERE researcher = ?',
    [researcher.toLowerCase()],
    EQLITE_DATABASE_ID,
  )

  if (result.rows.length === 0) {
    return {
      totalSubmissions: 0,
      approvedSubmissions: 0,
      rejectedSubmissions: 0,
      totalEarned: 0n,
      averageReward: 0n,
      successRate: 0,
    }
  }

  const row = result.rows[0]
  const total = rowNumber(row, 'total_submissions')
  const approved = rowNumber(row, 'approved_submissions')
  const earned = rowBigInt(row, 'total_earned')

  return {
    totalSubmissions: total,
    approvedSubmissions: approved,
    rejectedSubmissions: rowNumber(row, 'rejected_submissions'),
    totalEarned: earned,
    averageReward: approved > 0 ? earned / BigInt(approved) : 0n,
    successRate: total > 0 ? (approved / total) * 100 : 0,
  }
}

export interface ResearcherLeaderboardEntry {
  researcher: Address
  totalSubmissions: number
  approvedSubmissions: number
  totalEarned: bigint
  successRate: number
}

export async function getResearcherLeaderboard(
  limit = 10,
): Promise<ResearcherLeaderboardEntry[]> {
  const client = await getEQLiteClient()
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM bounty_researcher_stats
     ORDER BY total_earned DESC, approved_submissions DESC
     LIMIT ?`,
    [limit],
    EQLITE_DATABASE_ID,
  )

  return result.rows.map((row) => {
    const total = rowNumber(row, 'total_submissions')
    const approved = rowNumber(row, 'approved_submissions')
    return {
      researcher: rowAddress(row, 'researcher'),
      totalSubmissions: total,
      approvedSubmissions: approved,
      totalEarned: rowBigInt(row, 'total_earned'),
      successRate: total > 0 ? (approved / total) * 100 : 0,
    }
  })
}

// SQL aggregate result type for pool stats query
interface PoolStatsRow {
  pending_payouts: number | null
  total_paid: number | null
  active_submissions: number | null
}

export async function getBountyPoolStats(): Promise<BountyPoolStats> {
  const client = await getEQLiteClient()

  // Query aggregates from EQLite
  const submissions = await client.query<PoolStatsRow>(
    `SELECT
       SUM(CASE WHEN status = ? THEN CAST(reward_amount AS INTEGER) ELSE 0 END) as pending_payouts,
       SUM(CASE WHEN status = ? THEN CAST(reward_amount AS INTEGER) ELSE 0 END) as total_paid,
       COUNT(CASE WHEN status NOT IN (?, ?, ?) THEN 1 END) as active_submissions
     FROM bounty_submissions`,
    [
      BountySubmissionStatus.APPROVED,
      BountySubmissionStatus.PAID,
      BountySubmissionStatus.PAID,
      BountySubmissionStatus.REJECTED,
      BountySubmissionStatus.WITHDRAWN,
    ],
    EQLITE_DATABASE_ID,
  )

  const row = submissions.rows[0] ?? {
    pending_payouts: null,
    total_paid: null,
    active_submissions: null,
  }

  // Get pool stats from contract - readContract returns bigint for uint256
  const publicClient = getPublicClient()
  const contractAddr = getContractAddressOrThrow()

  const totalPool = (await publicClient.readContract({
    address: contractAddr,
    abi: SECURITY_BOUNTY_REGISTRY_ABI,
    functionName: 'getTotalPool',
  })) as bigint

  const guardianCount = Number(
    (await publicClient.readContract({
      address: contractAddr,
      abi: SECURITY_BOUNTY_REGISTRY_ABI,
      functionName: 'getGuardianCount',
    })) as bigint,
  )

  return {
    totalPool,
    totalPaidOut: BigInt(row.total_paid ?? 0),
    pendingPayouts: BigInt(row.pending_payouts ?? 0),
    activeSubmissions: row.active_submissions ?? 0,
    guardianCount,
  }
}
function rowToSubmission(row: Record<string, unknown>): BountySubmission {
  return {
    submissionId: rowString(row, 'submission_id'),
    researcher: rowAddress(row, 'researcher'),
    researcherAgentId: rowBigInt(row, 'researcher_agent_id'),
    severity: BountySeveritySchema.parse(rowNumber(row, 'severity')),
    vulnType: VulnerabilityTypeSchema.parse(rowNumber(row, 'vuln_type')),
    title: rowString(row, 'title'),
    summary: rowString(row, 'summary'),
    description: rowString(row, 'description'),
    affectedComponents: expectValid(
      StringArraySchema,
      JSON.parse(rowString(row, 'affected_components')),
      'affectedComponents',
    ),
    stepsToReproduce: expectValid(
      StringArraySchema,
      JSON.parse(rowString(row, 'steps_to_reproduce')),
      'stepsToReproduce',
    ),
    proofOfConcept: rowOptionalString(row, 'proof_of_concept'),
    suggestedFix: rowOptionalString(row, 'suggested_fix'),
    encryptedReportCid: rowString(row, 'encrypted_report_cid'),
    encryptionKeyId: rowString(row, 'encryption_key_id'),
    proofOfConceptHash: rowString(row, 'poc_hash'),
    stake: rowBigInt(row, 'stake'),
    submittedAt: rowNumber(row, 'submitted_at'),
    validatedAt: rowOptionalNumber(row, 'validated_at'),
    resolvedAt: rowOptionalNumber(row, 'resolved_at'),
    status: BountySubmissionStatusSchema.parse(rowNumber(row, 'status')),
    validationResult: ValidationResultSchema.parse(
      rowNumber(row, 'validation_result'),
    ),
    validationNotes: rowOptionalString(row, 'validation_notes'),
    rewardAmount: rowBigInt(row, 'reward_amount'),
    guardianApprovals: rowNumber(row, 'guardian_approvals'),
    guardianRejections: rowNumber(row, 'guardian_rejections'),
    fixCommitHash: rowOptionalString(row, 'fix_commit_hash'),
    disclosureDate: rowOptionalNumber(row, 'disclosure_date'),
    researcherDisclosed: rowNumber(row, 'researcher_disclosed') === 1,
  }
}
export class BugBountyService {
  assess = assessSubmission
  submit = submitBounty
  get = getSubmission
  list = listSubmissions
  triggerValidation = triggerValidation
  completeValidation = completeValidation
  guardianVote = submitGuardianVote
  getGuardianVotes = getGuardianVotes
  ceoDecision = ceoDecision
  payReward = payReward
  recordFix = recordFix
  researcherDisclose = researcherDisclose
  getResearcherStats = getResearcherStats
  getPoolStats = getBountyPoolStats
  getLeaderboard = getResearcherLeaderboard
}

let instance: BugBountyService | null = null

export function getBugBountyService(): BugBountyService {
  if (!instance) {
    instance = new BugBountyService()
  }
  return instance
}
export async function initializeBugBounty(): Promise<void> {
  if (initialized) return
  await getEQLiteClient()
  initialized = true
}
