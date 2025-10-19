import { NextResponse } from "next/server";
import { db } from "@/lib/data/db";
import { airdrops } from "@/lib/data/schema";
import { desc } from "drizzle-orm";

/**
 * GET /api/airdrops
 * 
 * Returns list of all airdrops with pagination
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const offset = (page - 1) * limit;

  const allAirdrops = await db.query.airdrops.findMany({
    orderBy: (airdrops, { desc }) => [desc(airdrops.createdAt)],
    limit,
    offset,
    with: {
      snapshot: true,
    },
  });

  // Get total count
  const totalResult = await db
    .select({ count: airdrops.airdropId })
    .from(airdrops);
  const total = totalResult.length;

  const results = allAirdrops.map((airdrop) => ({
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
    active: airdrop.active === 1,
    createdAt: airdrop.createdAt,
    txHash: airdrop.txHash,
    percentageClaimed:
      (airdrop.claimedCount / airdrop.contributorCount) * 100,
  }));

  return NextResponse.json({
    airdrops: results,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}


