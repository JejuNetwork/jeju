import { type Address, encodePacked, type Hex, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { LEADERBOARD_CONFIG } from './config'
import { exec, query } from './db'

export interface ReputationData {
  totalScore: number
  normalizedScore: number
  prScore: number
  issueScore: number
  reviewScore: number
  commitScore: number
  mergedPrCount: number
  totalPrCount: number
  totalCommits: number
}

export interface AttestationData {
  hash: Hex | null
  signature: Hex | null
  normalizedScore: number
  timestamp: number
  agentId: number
  onChainParams: {
    agentId: number
    score: number
    totalScore: number
    mergedPrs: number
    totalCommits: number
    timestamp: number
    signature: Hex | null
  } | null
}

export async function calculateUserReputation(
  username: string,
): Promise<ReputationData> {
  const scoreResult = await query<{
    total_score: number
    pr_score: number
    issue_score: number
    review_score: number
    comment_score: number
  }>(
    `SELECT
      COALESCE(SUM(score), 0) as total_score,
      COALESCE(SUM(pr_score), 0) as pr_score,
      COALESCE(SUM(issue_score), 0) as issue_score,
      COALESCE(SUM(review_score), 0) as review_score,
      COALESCE(SUM(comment_score), 0) as comment_score
    FROM user_daily_scores WHERE username = ?`,
    [username],
  )

  // Get PR counts
  const prCountResult = await query<{ total_prs: number; merged_prs: number }>(
    `SELECT
      COUNT(*) as total_prs,
      SUM(CASE WHEN merged = 1 THEN 1 ELSE 0 END) as merged_prs
    FROM raw_pull_requests WHERE author = ?`,
    [username],
  )

  // Get commit count
  const commitCountResult = await query<{ total_commits: number }>(
    'SELECT COUNT(*) as total_commits FROM raw_commits WHERE author = ?',
    [username],
  )

  const scores = scoreResult[0] || {
    total_score: 0,
    pr_score: 0,
    issue_score: 0,
    review_score: 0,
    comment_score: 0,
  }
  const prCounts = prCountResult[0] || { total_prs: 0, merged_prs: 0 }
  const commitCounts = commitCountResult[0] || { total_commits: 0 }

  const totalScore = Number(scores.total_score) ?? 0
  const prScore = Number(scores.pr_score) ?? 0
  const issueScore = Number(scores.issue_score) ?? 0
  const reviewScore = Number(scores.review_score) ?? 0
  const commitScore = Number(scores.comment_score) ?? 0
  const mergedPrCount = Number(prCounts.merged_prs) ?? 0
  const totalPrCount = Number(prCounts.total_prs) ?? 0
  const totalCommits = Number(commitCounts.total_commits) ?? 0

  let normalizedScore: number
  if (totalScore <= 0) {
    normalizedScore = 0
  } else if (totalScore < 100) {
    normalizedScore = Math.floor((totalScore / 100) * 10)
  } else if (totalScore < 1000) {
    normalizedScore = 10 + Math.floor(((totalScore - 100) / 900) * 20)
  } else if (totalScore < 10000) {
    normalizedScore = 30 + Math.floor(((totalScore - 1000) / 9000) * 30)
  } else if (totalScore < 50000) {
    normalizedScore = 60 + Math.floor(((totalScore - 10000) / 40000) * 20)
  } else {
    normalizedScore = Math.min(
      100,
      80 + Math.floor(Math.log10(totalScore / 50000) * 20),
    )
  }

  return {
    totalScore,
    normalizedScore,
    prScore,
    issueScore,
    reviewScore,
    commitScore,
    mergedPrCount,
    totalPrCount,
    totalCommits,
  }
}

export async function createAttestation(
  walletAddress: string,
  agentId: number,
  reputation: ReputationData,
  timestamp: number,
): Promise<AttestationData> {
  const { oracle, contracts, chain } = LEADERBOARD_CONFIG

  if (!oracle.isEnabled || !oracle.privateKey) {
    return {
      hash: null,
      signature: null,
      normalizedScore: reputation.normalizedScore,
      timestamp,
      agentId,
      onChainParams: null,
    }
  }

  const attestationHash = keccak256(
    encodePacked(
      [
        'address',
        'uint256',
        'uint8',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'address',
      ],
      [
        walletAddress.toLowerCase() as Address,
        BigInt(agentId),
        reputation.normalizedScore,
        BigInt(Math.floor(reputation.totalScore)),
        BigInt(reputation.mergedPrCount),
        BigInt(reputation.totalCommits),
        BigInt(timestamp),
        BigInt(chain.chainId),
        contracts.githubReputationProvider,
      ],
    ),
  )

  const account = privateKeyToAccount(oracle.privateKey)
  const signature = await account.signMessage({
    message: { raw: attestationHash },
  })

  return {
    hash: attestationHash,
    signature,
    normalizedScore: reputation.normalizedScore,
    timestamp,
    agentId,
    onChainParams: {
      agentId,
      score: reputation.normalizedScore,
      totalScore: Math.floor(reputation.totalScore),
      mergedPrs: reputation.mergedPrCount,
      totalCommits: reputation.totalCommits,
      timestamp,
      signature,
    },
  }
}

export async function storeAttestation(
  username: string,
  walletAddress: string,
  chainId: string,
  reputation: ReputationData,
  attestation: AttestationData,
  agentId: number | null,
): Promise<void> {
  const now = new Date().toISOString()

  const existing = await query<{ id: number }>(
    `SELECT id FROM reputation_attestations
     WHERE user_id = ? AND wallet_address = ? AND chain_id = ?`,
    [username, walletAddress.toLowerCase(), chainId],
  )

  if (existing.length > 0) {
    await exec(
      `UPDATE reputation_attestations SET
        total_score = ?, pr_score = ?, issue_score = ?, review_score = ?, commit_score = ?,
        merged_pr_count = ?, total_pr_count = ?, total_commits = ?, normalized_score = ?,
        attestation_hash = ?, oracle_signature = ?, agent_id = ?,
        score_calculated_at = ?, attested_at = ?, updated_at = ?
      WHERE id = ?`,
      [
        reputation.totalScore,
        reputation.prScore,
        reputation.issueScore,
        reputation.reviewScore,
        reputation.commitScore,
        reputation.mergedPrCount,
        reputation.totalPrCount,
        reputation.totalCommits,
        reputation.normalizedScore,
        attestation.hash,
        attestation.signature,
        agentId,
        now,
        attestation.signature ? now : null,
        now,
        existing[0].id,
      ],
    )
  } else {
    await exec(
      `INSERT INTO reputation_attestations (
        user_id, wallet_address, chain_id,
        total_score, pr_score, issue_score, review_score, commit_score,
        merged_pr_count, total_pr_count, total_commits, normalized_score,
        attestation_hash, oracle_signature, agent_id,
        score_calculated_at, attested_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        walletAddress.toLowerCase(),
        chainId,
        reputation.totalScore,
        reputation.prScore,
        reputation.issueScore,
        reputation.reviewScore,
        reputation.commitScore,
        reputation.mergedPrCount,
        reputation.totalPrCount,
        reputation.totalCommits,
        reputation.normalizedScore,
        attestation.hash,
        attestation.signature,
        agentId,
        now,
        attestation.signature ? now : null,
        now,
        now,
      ],
    )
  }
}

export async function getAttestation(
  username: string,
  walletAddress: string,
  chainId: string,
): Promise<{
  hash: string | null
  signature: string | null
  normalizedScore: number
  calculatedAt: string
  attestedAt: string | null
  agentId: number | null
  txHash: string | null
} | null> {
  const result = await query<{
    attestation_hash: string | null
    oracle_signature: string | null
    normalized_score: number
    score_calculated_at: string
    attested_at: string | null
    agent_id: number | null
    tx_hash: string | null
  }>(
    `SELECT attestation_hash, oracle_signature, normalized_score,
            score_calculated_at, attested_at, agent_id, tx_hash
     FROM reputation_attestations
     WHERE user_id = ? AND wallet_address = ? AND chain_id = ?`,
    [username, walletAddress.toLowerCase(), chainId],
  )

  if (result.length === 0) return null

  const row = result[0]
  return {
    hash: row.attestation_hash,
    signature: row.oracle_signature,
    normalizedScore: row.normalized_score,
    calculatedAt: row.score_calculated_at,
    attestedAt: row.attested_at,
    agentId: row.agent_id,
    txHash: row.tx_hash,
  }
}

export async function confirmAttestation(
  attestationHash: string,
  walletAddress: string,
  chainId: string,
  txHash: string,
): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await exec(
    `UPDATE reputation_attestations
     SET tx_hash = ?, submitted_on_chain_at = ?, updated_at = ?
     WHERE attestation_hash = ? AND wallet_address = ? AND chain_id = ?`,
    [txHash, now, now, attestationHash, walletAddress.toLowerCase(), chainId],
  )
  return result.rowsAffected > 0
}

export async function getTopContributors(limit: number = 10): Promise<
  Array<{
    rank: number
    username: string
    avatarUrl: string
    score: number
  }>
> {
  const result = await query<{
    username: string
    avatar_url: string
    total_score: number
  }>(
    `SELECT u.username, u.avatar_url, COALESCE(SUM(s.score), 0) as total_score
     FROM users u
     LEFT JOIN user_daily_scores s ON u.username = s.username
     WHERE u.is_bot = 0
     GROUP BY u.username
     ORDER BY total_score DESC
     LIMIT ?`,
    [limit],
  )

  return result.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    avatarUrl: row.avatar_url,
    score: Math.round(row.total_score),
  }))
}
