/**
 * Reputation Attestation API
 * Provides signed attestations of GitHub reputation for ERC-8004 integration
 * 
 * Security: Requires GitHub OAuth token authentication for POST
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
import { eq, and, desc, sum, count } from "drizzle-orm";
import { keccak256, encodePacked, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sql } from "drizzle-orm";
import {
  authenticateRequest,
  isAuthError,
  verifyUserOwnership,
  forbiddenResponse,
} from "@/lib/auth";
import { corsHeadersFromRequest } from "@/lib/auth/cors";
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
  rateLimitExceededResponse,
} from "@/lib/auth/rateLimit";

// Oracle private key for signing attestations
// In production, this should be in a secure key management system
const ORACLE_PRIVATE_KEY = process.env.ATTESTATION_ORACLE_PRIVATE_KEY as Hex | undefined;

// Contract address for domain binding
const GITHUB_REPUTATION_PROVIDER_ADDRESS = process.env.GITHUB_REPUTATION_PROVIDER_ADDRESS || "0x0000000000000000000000000000000000000000";

// Chain ID for the target chain
const TARGET_CHAIN_ID = parseInt(process.env.TARGET_CHAIN_ID || "8453"); // Base mainnet

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);
  return new NextResponse(null, {
    headers: {
      ...corsHeaders,
      "Access-Control-Max-Age": "86400",
    },
  });
}

interface ReputationData {
  totalScore: number;
  normalizedScore: number;
  prScore: number;
  issueScore: number;
  reviewScore: number;
  commitScore: number;
  mergedPrCount: number;
  totalPrCount: number;
  totalCommits: number;
}

/**
 * GET /api/attestation?wallet=0x...&chainId=eip155:1
 * Returns reputation data for a wallet address
 * 
 * Public endpoint - no authentication required for reading
 */
export async function GET(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`attestation-get:${clientId}`, RATE_LIMITS.attestation);
  if (!rateLimit.success) {
    return rateLimitExceededResponse(rateLimit, corsHeaders);
  }

  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet");
  const chainId = searchParams.get("chainId") || "eip155:1";
  const username = searchParams.get("username");

  if (!walletAddress && !username) {
    return NextResponse.json(
      { error: "wallet or username parameter required" },
      { status: 400, headers: corsHeaders }
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
        { status: 404, headers: corsHeaders }
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
        { status: 404, headers: corsHeaders }
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
      { status: 404, headers: corsHeaders }
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
      oracleConfigured: !!ORACLE_PRIVATE_KEY,
    },
    { headers: corsHeaders }
  );
}

/**
 * POST /api/attestation
 * Request a new signed reputation attestation
 * 
 * Requires: Authorization header with GitHub token
 * User can only request attestations for their own account
 */
export async function POST(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`attestation-post:${clientId}`, RATE_LIMITS.attestation);
  if (!rateLimit.success) {
    return rateLimitExceededResponse(rateLimit, corsHeaders);
  }

  // Authenticate request
  const authResult = await authenticateRequest(request);
  if (isAuthError(authResult)) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status, headers: corsHeaders }
    );
  }

  const body = await request.json();
  const { username, walletAddress, chainId = "eip155:1", agentId } = body;

  if (!username || !walletAddress) {
    return NextResponse.json(
      { error: "username and walletAddress required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // SECURITY: Verify user is requesting attestation for their own account
  if (!verifyUserOwnership(authResult.user, username)) {
    return forbiddenResponse(
      "You can only request attestations for your own account",
      corsHeaders
    );
  }

  // Verify wallet is linked AND verified for this user
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
      { status: 403, headers: corsHeaders }
    );
  }

  // Require wallet verification for attestations
  if (!wallet.isVerified) {
    return NextResponse.json(
      {
        error: "Wallet must be verified before requesting attestation",
        action: "verify_wallet",
        message: "Please sign a verification message to prove wallet ownership first",
      },
      { status: 403, headers: corsHeaders }
    );
  }

  // Calculate reputation
  const reputationData = await calculateUserReputation(username);
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

  // Create attestation hash matching contract format exactly:
  // keccak256(abi.encodePacked(wallet, agentId, score, totalScore, mergedPrs, totalCommits, timestamp, chainid, address(this)))
  const attestationHash = keccak256(
    encodePacked(
      ["address", "uint256", "uint8", "uint256", "uint256", "uint256", "uint256", "uint256", "address"],
      [
        walletAddress.toLowerCase() as `0x${string}`,
        BigInt(agentId || 0),
        reputationData.normalizedScore,
        BigInt(Math.floor(reputationData.totalScore)),
        BigInt(reputationData.mergedPrCount),
        BigInt(reputationData.totalCommits),
        BigInt(timestamp),
        BigInt(TARGET_CHAIN_ID),
        GITHUB_REPUTATION_PROVIDER_ADDRESS as `0x${string}`,
      ]
    )
  );

  // Sign the attestation if oracle is configured
  let oracleSignature: string | null = null;

  if (ORACLE_PRIVATE_KEY) {
    const account = privateKeyToAccount(ORACLE_PRIVATE_KEY);
    // Sign the EIP-191 prefixed message
    oracleSignature = await account.signMessage({
      message: { raw: attestationHash },
    });
  }

  // Store attestation
  const existingAttestation = await db.query.reputationAttestations.findFirst({
    where: and(
      eq(reputationAttestations.userId, username),
      eq(reputationAttestations.walletAddress, walletAddress.toLowerCase()),
      eq(reputationAttestations.chainId, chainId)
    ),
  });

  const now = new Date().toISOString();
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
    oracleSignature,
    agentId: agentId || null,
    scoreCalculatedAt: now,
    attestedAt: oracleSignature ? now : null,
    updatedAt: now,
  };

  if (existingAttestation) {
    await db
      .update(reputationAttestations)
      .set(attestationRecord)
      .where(eq(reputationAttestations.id, existingAttestation.id));
  } else {
    await db.insert(reputationAttestations).values({
      ...attestationRecord,
      createdAt: now,
    });
  }

  return NextResponse.json(
    {
      success: true,
      attestation: {
        hash: attestationHash,
        signature: oracleSignature,
        normalizedScore: reputationData.normalizedScore,
        timestamp,
        agentId: agentId || 0,
        // Data needed for on-chain submission
        onChainParams: {
          agentId: agentId || 0,
          score: reputationData.normalizedScore,
          totalScore: Math.floor(reputationData.totalScore),
          mergedPrs: reputationData.mergedPrCount,
          totalCommits: reputationData.totalCommits,
          timestamp,
          signature: oracleSignature,
        },
      },
      message: oracleSignature
        ? `Signed attestation created for ${username}. Score: ${reputationData.normalizedScore}/100`
        : `Attestation created but not signed (oracle not configured). Score: ${reputationData.normalizedScore}/100`,
    },
    { headers: corsHeaders }
  );
}

async function calculateUserReputation(username: string): Promise<ReputationData> {
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
