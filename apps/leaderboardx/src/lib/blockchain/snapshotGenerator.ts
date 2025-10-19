/**
 * Monthly Snapshot Generator
 * 
 * Generates monthly contributor snapshots for on-chain submission.
 * Calculates weighted scores, stores in database, prepares for blockchain.
 */

import { db } from "@/lib/data/db";
import {
  contributorSnapshots,
  contributorAllocations,
} from "@/lib/data/schema";
import {
  calculateWeightedScores,
  convertScoresToShares,
  getContributorWalletAddresses,
  calculateScoreStats,
  type ContributorScore,
} from "./scoreWeighting";
import { UTCDate } from "@date-fns/utc";
import { toDateString } from "@/lib/date-utils";
import { subMonths, startOfMonth, endOfMonth } from "date-fns";
import { eq } from "drizzle-orm";

export interface SnapshotData {
  snapshotId: string;
  period: number;
  periodStart: string;
  periodEnd: string;
  contributors: string[];
  walletAddresses: string[];
  scores: ContributorScore[];
  shares: bigint[];
  totalShares: bigint;
  totalPool: bigint;
  merkleRoot: string | null;
  ipfsHash: string | null;
}

/**
 * Generate monthly snapshot for a specific period
 * @param periodDate Date within the period to snapshot (defaults to last month)
 * @param totalPoolAmount Total token amount in pool (from contract)
 * @returns Snapshot data ready for on-chain submission
 */
export async function generateMonthlySnapshot(
  periodDate: Date | string = subMonths(new UTCDate(), 1),
  totalPoolAmount?: bigint,
): Promise<SnapshotData> {
  const date = new UTCDate(periodDate);
  
  // Calculate period boundaries (month)
  const periodStart = startOfMonth(date);
  const periodEnd = endOfMonth(date);
  
  // Generate snapshot ID and period number
  const year = periodStart.getFullYear();
  const month = periodStart.getMonth();
  const period = (year - 2024) * 12 + month; // Periods since 2024
  const snapshotId = `period_${period}_${year}-${String(month + 1).padStart(2, "0")}`;
  
  console.log(`📊 Generating snapshot for period ${period} (${toDateString(periodStart)} to ${toDateString(periodEnd)})`);
  
  // Calculate weighted scores for all contributors
  const scores = await calculateWeightedScores(periodEnd);
  
  if (scores.length === 0) {
    throw new Error("No contributors found for this period");
  }
  
  // Convert scores to shares
  const { contributors, shares, totalShares } = convertScoresToShares(scores);
  
  // Get wallet addresses
  const walletMap = await getContributorWalletAddresses(contributors);
  const walletAddresses = contributors.map(
    (username) => walletMap.get(username) || "",
  );
  
  // Filter out contributors without wallet addresses
  const validContributors: string[] = [];
  const validWallets: string[] = [];
  const validShares: bigint[] = [];
  const validScores: ContributorScore[] = [];
  
  for (let i = 0; i < contributors.length; i++) {
    if (walletAddresses[i]) {
      validContributors.push(contributors[i]);
      validWallets.push(walletAddresses[i]);
      validShares.push(shares[i]);
      validScores.push(scores[i]);
    }
  }
  
  if (validContributors.length === 0) {
    throw new Error("No contributors with linked wallet addresses");
  }
  
  // Recalculate total shares after filtering
  const validTotalShares = validShares.reduce((sum, s) => sum + s, 0n);
  
  // Log statistics
  const stats = calculateScoreStats(validScores);
  console.log(`✅ ${validContributors.length} contributors with wallets`);
  console.log(`📈 Top contributor: ${stats.topContributor?.username} (${stats.topContributor?.weightedScore.toFixed(2)} points)`);
  console.log(`📊 Average score: ${stats.averageScore.toFixed(2)}`);
  console.log(`📊 Total shares: ${validTotalShares.toString()}`);
  
  // Store in database
  await saveSnapshotToDatabase({
    snapshotId,
    period,
    periodStart: toDateString(periodStart),
    periodEnd: toDateString(periodEnd),
    contributors: validContributors,
    walletAddresses: validWallets,
    scores: validScores,
    shares: validShares,
    totalShares: validTotalShares,
    totalPool: totalPoolAmount || 0n,
    merkleRoot: null, // Will be generated if needed
    ipfsHash: null,   // Will be uploaded if needed
  });
  
  return {
    snapshotId,
    period,
    periodStart: toDateString(periodStart),
    periodEnd: toDateString(periodEnd),
    contributors: validContributors,
    walletAddresses: validWallets,
    scores: validScores,
    shares: validShares,
    totalShares: validTotalShares,
    totalPool: totalPoolAmount || 0n,
    merkleRoot: null,
    ipfsHash: null,
  };
}

/**
 * Save snapshot to database
 */
async function saveSnapshotToDatabase(snapshot: SnapshotData): Promise<void> {
  // Check if snapshot already exists
  const existing = await db.query.contributorSnapshots.findFirst({
    where: (snapshots, { eq }) => eq(snapshots.period, snapshot.period),
  });
  
  if (existing) {
    console.log(`⚠️  Snapshot for period ${snapshot.period} already exists`);
    return;
  }
  
  // Insert snapshot
  await db.insert(contributorSnapshots).values({
    snapshotId: snapshot.snapshotId,
    period: snapshot.period,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    totalPool: snapshot.totalPool.toString(),
    totalShares: snapshot.totalShares.toString(),
    contributorCount: snapshot.contributors.length,
    submittedToChain: 0,
    merkleRoot: snapshot.merkleRoot,
    ipfsHash: snapshot.ipfsHash,
  });
  
  // Insert allocations
  const allocations = snapshot.contributors.map((username, index) => ({
    id: `${snapshot.snapshotId}_${username}`,
    snapshotId: snapshot.snapshotId,
    username,
    walletAddress: snapshot.walletAddresses[index],
    score: snapshot.scores[index].weightedScore,
    shares: snapshot.shares[index].toString(),
    percentage:
      (Number(snapshot.shares[index]) / Number(snapshot.totalShares)) * 100,
    rank: snapshot.scores[index].rank,
    estimatedReward:
      snapshot.totalPool > 0n
        ? (
            (snapshot.shares[index] * snapshot.totalPool) /
            snapshot.totalShares
          ).toString()
        : null,
  }));
  
  await db.insert(contributorAllocations).values(allocations);
  
  console.log(
    `💾 Saved snapshot ${snapshot.snapshotId} with ${allocations.length} allocations`,
  );
}

/**
 * Get latest snapshot from database
 */
export async function getLatestSnapshot(): Promise<SnapshotData | null> {
  const snapshot = await db.query.contributorSnapshots.findFirst({
    orderBy: (snapshots, { desc }) => [desc(snapshots.period)],
    with: {
      allocations: {
        orderBy: (allocations, { asc }) => [asc(allocations.rank)],
      },
    },
  });
  
  if (!snapshot) {
    return null;
  }
  
  const scores: ContributorScore[] = snapshot.allocations.map((alloc) => ({
    username: alloc.username,
    allTimeScore: 0, // Not stored separately, would need recalculation
    sixMonthScore: 0,
    oneMonthScore: 0,
    weightedScore: alloc.score,
    rank: alloc.rank,
  }));
  
  return {
    snapshotId: snapshot.snapshotId,
    period: snapshot.period,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    contributors: snapshot.allocations.map((a) => a.username),
    walletAddresses: snapshot.allocations.map((a) => a.walletAddress || ""),
    scores,
    shares: snapshot.allocations.map((a) => BigInt(a.shares)),
    totalShares: BigInt(snapshot.totalShares),
    totalPool: BigInt(snapshot.totalPool),
    merkleRoot: snapshot.merkleRoot,
    ipfsHash: snapshot.ipfsHash,
  };
}

/**
 * Update snapshot with on-chain submission details
 */
export async function markSnapshotSubmitted(
  period: number,
  txHash: string,
): Promise<void> {
  await db
    .update(contributorSnapshots)
    .set({
      submittedToChain: 1,
      txHash,
      submittedAt: toDateString(new UTCDate()),
    })
    .where(eq(contributorSnapshots.period, period));
  
  console.log(`✅ Marked snapshot period ${period} as submitted (tx: ${txHash})`);
}

/**
 * Update snapshot with finalization details
 */
export async function markSnapshotFinalized(
  period: number,
  txHash: string,
): Promise<void> {
  await db
    .update(contributorSnapshots)
    .set({
      finalizedTxHash: txHash,
      finalizedAt: toDateString(new UTCDate()),
    })
    .where(eq(contributorSnapshots.period, period));
  
  console.log(
    `✅ Marked snapshot period ${period} as finalized (tx: ${txHash})`,
  );
}


