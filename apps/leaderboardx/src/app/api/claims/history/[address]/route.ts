import { NextResponse } from "next/server";
import { db } from "@/lib/data/db";
import { contributorAllocations } from "@/lib/data/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { isAddress } from "viem";

/**
 * GET /api/claims/history/:address
 * 
 * Returns claim history for a contributor address
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  // Validate address
  if (!isAddress(address)) {
    return NextResponse.json(
      { error: "Invalid Ethereum address" },
      { status: 400 },
    );
  }

  // Find all allocations for this address
  const allocations = await db.query.contributorAllocations.findMany({
    where: (allocations, { eq }) => eq(allocations.walletAddress, address),
    with: {
      snapshot: true,
    },
    orderBy: (allocations, { desc }) => [desc(allocations.createdAt)],
  });

  // Transform for API response
  const history = allocations.map((alloc) => ({
    period: alloc.snapshot.period,
    snapshotId: alloc.snapshotId,
    username: alloc.username,
    score: alloc.score,
    shares: alloc.shares,
    percentage: alloc.percentage,
    rank: alloc.rank,
    estimatedReward: alloc.estimatedReward,
    periodStart: alloc.snapshot.periodStart,
    periodEnd: alloc.snapshot.periodEnd,
    submittedToChain: alloc.snapshot.submittedToChain === 1,
    txHash: alloc.snapshot.txHash,
    finalizedTxHash: alloc.snapshot.finalizedTxHash,
  }));

  return NextResponse.json({
    address,
    totalAllocations: history.length,
    history,
  });
}


