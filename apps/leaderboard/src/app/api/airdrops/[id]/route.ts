import { NextResponse } from "next/server";
import { db } from "@/lib/data/db";
import { airdropClaims } from "@/lib/data/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/airdrops/:id
 * 
 * Returns detailed airdrop information
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const airdropId = parseInt(id);

  if (isNaN(airdropId)) {
    return NextResponse.json(
      { error: "Invalid airdrop ID" },
      { status: 400 },
    );
  }

  const airdrop = await db.query.airdrops.findFirst({
    where: (airdrops, { eq }) => eq(airdrops.airdropId, airdropId),
    with: {
      snapshot: true,
      claims: {
        orderBy: (claims, { desc }) => [desc(claims.claimedAt)],
      },
    },
  });

  if (!airdrop) {
    return NextResponse.json(
      { error: "Airdrop not found" },
      { status: 404 },
    );
  }

  const recentClaims = airdrop.claims
    .filter((claim) => claim.claimed === 1)
    .slice(0, 10)
    .map((claim) => ({
      username: claim.username,
      walletAddress: claim.walletAddress,
      amount: claim.amount,
      claimedAt: claim.claimedAt,
      txHash: claim.txHash,
    }));

  return NextResponse.json({
    airdropId: airdrop.airdropId,
    token: {
      address: airdrop.tokenAddress,
      symbol: airdrop.tokenSymbol,
      decimals: airdrop.tokenDecimals,
    },
    totalAmount: airdrop.totalAmount,
    claimedAmount: airdrop.claimedAmount,
    claimedCount: airdrop.claimedCount,
    contributorCount: airdrop.contributorCount,
    creator: airdrop.creatorAddress,
    period: airdrop.snapshot.period,
    periodStart: airdrop.snapshot.periodStart,
    periodEnd: airdrop.snapshot.periodEnd,
    active: airdrop.active === 1,
    createdAt: airdrop.createdAt,
    txHash: airdrop.txHash,
    cancelledAt: airdrop.cancelledAt,
    percentageClaimed: (airdrop.claimedCount / airdrop.contributorCount) * 100,
    recentClaims,
  });
}


