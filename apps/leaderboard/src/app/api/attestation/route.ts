/**
 * Reputation Attestation API
 * Provides signed attestations of GitHub reputation for ERC-8004 integration
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/data/db-nextjs";
import {
  users,
  walletAddresses,
  reputationAttestations,
  userDailyScores,
  rawPullRequests,
  rawCommits,
} from "@/lib/data/schema";
import { eq, and, desc, sql, sum, count } from "drizzle-orm";
import { keccak256, encodePacked, toHex } from "viem";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

interface AttestationData {
  username: string;
  walletAddress: string;
  chainId: string;
  totalScore: number;
  normalizedScore: number;
  prScore: number;
  issueScore: number;
  reviewScore: number;
  commitScore: number;
  mergedPrCount: number;
  totalPrCount: number;
  totalCommits: number;
  timestamp: number;
  nonce: string;
}

/**
 * GET /api/attestation?wallet=0x...&chainId=eip155:1
 * Returns reputation data for a wallet address
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet");
  const chainId = searchParams.get("chainId") || "eip155:1";
  const username = searchParams.get("username");

  if (!walletAddress && !username) {
    return NextResponse.json(
      { error: "wallet or username parameter required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Find the user by wallet or username
  let user;
  let wallet;

  if (walletAddress) {
    const walletResult = await db.query.walletAddresses.findFirst({
      where: and(
        eq(walletAddresses.accountAddress, walletAddress.toLowerCase()),
        eq(walletAddresses.isActive, true)
      ),
      with: { user: true },
    });

    if (!walletResult) {
      return NextResponse.json(
        { error: "Wallet not linked to any GitHub account" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    wallet = walletResult;
    user = walletResult.user;
  } else if (username) {
    user = await db.query.users.findFirst({
      where: eq(users.username, username),
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Find their primary wallet
    wallet = await db.query.walletAddresses.findFirst({
      where: and(
        eq(walletAddresses.userId, username),
        eq(walletAddresses.chainId, chainId),
        eq(walletAddresses.isActive, true)
      ),
    });
  }

  if (!user) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  // Calculate reputation scores
  const reputationData = await calculateUserReputation(user.username);

  // Check for existing attestation
  const existingAttestation = wallet
    ? await db.query.reputationAttestations.findFirst({
        where: and(
          eq(reputationAttestations.userId, user.username),
          eq(
            reputationAttestations.walletAddress,
            wallet.accountAddress.toLowerCase()
          )
        ),
        orderBy: desc(reputationAttestations.createdAt),
      })
    : null;

  return NextResponse.json(
    {
      username: user.username,
      avatarUrl: user.avatarUrl,
      wallet: wallet
        ? {
            address: wallet.accountAddress,
            chainId: wallet.chainId,
            isVerified: wallet.isVerified,
            verifiedAt: wallet.verifiedAt,
          }
        : null,
      reputation: reputationData,
      attestation: existingAttestation
        ? {
            hash: existingAttestation.attestationHash,
            signature: existingAttestation.oracleSignature,
            normalizedScore: existingAttestation.normalizedScore,
            calculatedAt: existingAttestation.scoreCalculatedAt,
            attestedAt: existingAttestation.attestedAt,
            agentId: existingAttestation.agentId,
            txHash: existingAttestation.txHash,
          }
        : null,
    },
    { headers: CORS_HEADERS }
  );
}

/**
 * POST /api/attestation
 * Request a new reputation attestation
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { username, walletAddress, chainId = "eip155:1", agentId } = body;

  if (!username || !walletAddress) {
    return NextResponse.json(
      { error: "username and walletAddress required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Verify wallet is linked to this user
  const wallet = await db.query.walletAddresses.findFirst({
    where: and(
      eq(walletAddresses.userId, username),
      eq(walletAddresses.accountAddress, walletAddress.toLowerCase()),
      eq(walletAddresses.isActive, true)
    ),
  });

  if (!wallet) {
    return NextResponse.json(
      { error: "Wallet not linked to this GitHub account" },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  // Calculate reputation
  const reputationData = await calculateUserReputation(username);
  const timestamp = Date.now();
  const nonce = toHex(Math.floor(Math.random() * 1000000000));

  // Create attestation data
  const attestationData: AttestationData = {
    username,
    walletAddress: walletAddress.toLowerCase(),
    chainId,
    totalScore: reputationData.totalScore,
    normalizedScore: reputationData.normalizedScore,
    prScore: reputationData.prScore,
    issueScore: reputationData.issueScore,
    reviewScore: reputationData.reviewScore,
    commitScore: reputationData.commitScore,
    mergedPrCount: reputationData.mergedPrCount,
    totalPrCount: reputationData.totalPrCount,
    totalCommits: reputationData.totalCommits,
    timestamp,
    nonce,
  };

  // Create attestation hash
  const attestationHash = keccak256(
    encodePacked(
      ["address", "uint256", "uint8", "uint256", "bytes32"],
      [
        walletAddress.toLowerCase() as `0x${string}`,
        BigInt(agentId || 0),
        reputationData.normalizedScore,
        BigInt(timestamp),
        nonce as `0x${string}`,
      ]
    )
  );

  // Store attestation (signature will be added when oracle signs it)
  const existingAttestation = await db.query.reputationAttestations.findFirst({
    where: and(
      eq(reputationAttestations.userId, username),
      eq(reputationAttestations.walletAddress, walletAddress.toLowerCase()),
      eq(reputationAttestations.chainId, chainId)
    ),
  });

  const attestationRecord = {
    userId: username,
    walletAddress: walletAddress.toLowerCase(),
    chainId,
    totalScore: reputationData.totalScore,
    prScore: reputationData.prScore,
    issueScore: reputationData.issueScore,
    reviewScore: reputationData.reviewScore,
    commitScore: reputationData.commitScore,
    mergedPrCount: reputationData.mergedPrCount,
    totalPrCount: reputationData.totalPrCount,
    totalCommits: reputationData.totalCommits,
    normalizedScore: reputationData.normalizedScore,
    attestationHash,
    agentId: agentId || null,
    scoreCalculatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existingAttestation) {
    await db
      .update(reputationAttestations)
      .set(attestationRecord)
      .where(eq(reputationAttestations.id, existingAttestation.id));
  } else {
    await db.insert(reputationAttestations).values({
      ...attestationRecord,
      createdAt: new Date().toISOString(),
    });
  }

  return NextResponse.json(
    {
      success: true,
      attestation: {
        hash: attestationHash,
        data: attestationData,
        normalizedScore: reputationData.normalizedScore,
        message: `Attestation created for ${username}. Score: ${reputationData.normalizedScore}/100`,
      },
    },
    { headers: CORS_HEADERS }
  );
}

async function calculateUserReputation(username: string): Promise<{
  totalScore: number;
  normalizedScore: number;
  prScore: number;
  issueScore: number;
  reviewScore: number;
  commitScore: number;
  mergedPrCount: number;
  totalPrCount: number;
  totalCommits: number;
}> {
  // Get aggregated scores from daily scores
  const scoreResult = await db
    .select({
      totalScore: sum(userDailyScores.score),
      prScore: sum(userDailyScores.prScore),
      issueScore: sum(userDailyScores.issueScore),
      reviewScore: sum(userDailyScores.reviewScore),
      commentScore: sum(userDailyScores.commentScore),
    })
    .from(userDailyScores)
    .where(eq(userDailyScores.username, username));

  // Get PR counts
  const prCountResult = await db
    .select({
      totalPrs: count(),
      mergedPrs: sql<number>`SUM(CASE WHEN ${rawPullRequests.merged} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(rawPullRequests)
    .where(eq(rawPullRequests.author, username));

  // Get commit count
  const commitCountResult = await db
    .select({ totalCommits: count() })
    .from(rawCommits)
    .where(eq(rawCommits.author, username));

  const scores = scoreResult[0] || {};
  const prCounts = prCountResult[0] || {};
  const commitCounts = commitCountResult[0] || {};

  const totalScore = Number(scores.totalScore) || 0;
  const prScore = Number(scores.prScore) || 0;
  const issueScore = Number(scores.issueScore) || 0;
  const reviewScore = Number(scores.reviewScore) || 0;
  const commitScore = Number(scores.commentScore) || 0;
  const mergedPrCount = Number(prCounts.mergedPrs) || 0;
  const totalPrCount = Number(prCounts.totalPrs) || 0;
  const totalCommits = Number(commitCounts.totalCommits) || 0;

  // Normalize score to 0-100 for ERC-8004 compatibility
  // Use logarithmic scaling to handle large score ranges
  // Score tiers:
  // 0-10: New contributor (score < 100)
  // 11-30: Active contributor (score 100-1000)
  // 31-60: Regular contributor (score 1000-10000)
  // 61-80: Core contributor (score 10000-50000)
  // 81-100: Elite contributor (score > 50000)
  let normalizedScore: number;
  if (totalScore <= 0) {
    normalizedScore = 0;
  } else if (totalScore < 100) {
    normalizedScore = Math.floor((totalScore / 100) * 10);
  } else if (totalScore < 1000) {
    normalizedScore = 10 + Math.floor(((totalScore - 100) / 900) * 20);
  } else if (totalScore < 10000) {
    normalizedScore = 30 + Math.floor(((totalScore - 1000) / 9000) * 30);
  } else if (totalScore < 50000) {
    normalizedScore = 60 + Math.floor(((totalScore - 10000) / 40000) * 20);
  } else {
    normalizedScore = Math.min(100, 80 + Math.floor(Math.log10(totalScore / 50000) * 20));
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
  };
}
