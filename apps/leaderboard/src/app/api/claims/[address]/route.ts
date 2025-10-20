import { NextResponse } from "next/server";
import { createBlockchainClientFromEnv } from "@/lib/blockchain/contractClient";
import { isAddress, type Address } from "viem";

/**
 * GET /api/claims/:address
 * 
 * Returns claimable rewards for a contributor address
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

  try {
    const client = createBlockchainClientFromEnv();

    // Get current period from contract
    const currentPeriod = 0; // TODO: Get from contract or config

    // Get claimable rewards for each period
    const claimableRewards: {
      period: number;
      reward: string;
      claimed: boolean;
      finalized: boolean;
    }[] = [];

    // Check last 12 periods (1 year)
    for (let period = Math.max(0, currentPeriod - 12); period <= currentPeriod; period++) {
      const rewardInfo = await client.getContributorReward(
        address as Address,
        period,
      );

      if (rewardInfo.reward > 0n || rewardInfo.finalized) {
        claimableRewards.push({
          period,
          reward: rewardInfo.reward.toString(),
          claimed: rewardInfo.claimed,
          finalized: rewardInfo.finalized,
        });
      }
    }

    // Calculate total claimable
    const totalClaimable = claimableRewards
      .filter((r) => !r.claimed && r.finalized)
      .reduce((sum, r) => sum + BigInt(r.reward), 0n);

    return NextResponse.json({
      address,
      totalClaimable: totalClaimable.toString(),
      periods: claimableRewards,
      unclaimedPeriods: claimableRewards
        .filter((r) => !r.claimed && r.finalized)
        .map((r) => r.period),
    });
  } catch (error) {
    console.error("Error fetching claims:", error);
    return NextResponse.json(
      { error: "Failed to fetch claims from blockchain" },
      { status: 500 },
    );
  }
}


