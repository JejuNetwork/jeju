import { NextResponse } from "next/server";
import { calculateWeightedScores } from "@/lib/blockchain/scoreWeighting";
import { createBlockchainClientFromEnv } from "@/lib/blockchain/contractClient";
import { getContributorWalletAddress } from "@/lib/blockchain/scoreWeighting";
import { isAddress } from "viem";

/**
 * GET /api/rewards/estimate/:address
 * 
 * Estimates next month's rewards for a contributor
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

  // Calculate current weighted scores
  const scores = await calculateWeightedScores();

  // Find contributor by wallet address
  let contributorScore = null;
  let contributorUsername = null;

  for (const score of scores) {
    const wallet = await getContributorWalletAddress(score.username);
    if (wallet && wallet.toLowerCase() === address.toLowerCase()) {
      contributorScore = score;
      contributorUsername = score.username;
      break;
    }
  }

  if (!contributorScore) {
    return NextResponse.json({
      address,
      found: false,
      estimatedReward: "0",
      rank: null,
      message: "Contributor not found or no linked wallet",
    });
  }

  // Get current contributor pool balance
  const client = createBlockchainClientFromEnv();
  const poolBalance = await client.getContributorPoolBalance();

  // Calculate total shares
  const totalScore = scores.reduce((sum, s) => sum + s.weightedScore, 0);

  // Estimate reward (pro-rata based on current pool)
  const estimatedReward =
    poolBalance > 0n && totalScore > 0
      ? (poolBalance * BigInt(Math.floor(contributorScore.weightedScore * 1e18))) /
        BigInt(Math.floor(totalScore * 1e18))
      : 0n;

  return NextResponse.json({
    address,
    found: true,
    username: contributorUsername,
    currentPeriod: {
      rank: contributorScore.rank,
      weightedScore: contributorScore.weightedScore,
      allTimeScore: contributorScore.allTimeScore,
      sixMonthScore: contributorScore.sixMonthScore,
      oneMonthScore: contributorScore.oneMonthScore,
    },
    estimatedReward: estimatedReward.toString(),
    currentPool: poolBalance.toString(),
    estimatedPercentage: totalScore > 0 ? (contributorScore.weightedScore / totalScore) * 100 : 0,
  });
}


