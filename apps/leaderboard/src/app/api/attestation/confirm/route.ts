/**
 * Confirm on-chain attestation submission
 * Updates the attestation record with the transaction hash
 * 
 * Security: Requires GitHub OAuth token authentication
 * Only the attestation owner can confirm their attestation
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/data/db-nextjs";
import { reputationAttestations } from "@/lib/data/schema";
import { eq, and } from "drizzle-orm";
import { isHex } from "viem";
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

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);
  return new NextResponse(null, {
    headers: {
      ...corsHeaders,
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * POST /api/attestation/confirm
 * Update attestation with on-chain transaction hash
 * 
 * Requires: Authorization header with GitHub token
 * Only the attestation owner can confirm their attestation
 */
export async function POST(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`attestation-confirm:${clientId}`, RATE_LIMITS.attestation);
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
  const { attestationHash, txHash, walletAddress, chainId = "eip155:1" } = body;

  if (!attestationHash || !txHash || !walletAddress) {
    return NextResponse.json(
      { error: "attestationHash, txHash, and walletAddress required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Validate txHash format
  if (!isHex(txHash) || txHash.length !== 66) {
    return NextResponse.json(
      { error: "Invalid transaction hash format" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Find the attestation
  const attestation = await db.query.reputationAttestations.findFirst({
    where: and(
      eq(reputationAttestations.attestationHash, attestationHash),
      eq(reputationAttestations.walletAddress, walletAddress.toLowerCase()),
      eq(reputationAttestations.chainId, chainId)
    ),
  });

  if (!attestation) {
    return NextResponse.json(
      { error: "Attestation not found" },
      { status: 404, headers: corsHeaders }
    );
  }

  // SECURITY: Verify the authenticated user owns this attestation
  if (!verifyUserOwnership(authResult.user, attestation.userId)) {
    return forbiddenResponse(
      "You can only confirm attestations for your own account",
      corsHeaders
    );
  }

  // Update with tx hash
  const now = new Date().toISOString();
  await db
    .update(reputationAttestations)
    .set({
      txHash,
      submittedOnChainAt: now,
      updatedAt: now,
    })
    .where(eq(reputationAttestations.id, attestation.id));

  return NextResponse.json(
    {
      success: true,
      attestation: {
        hash: attestation.attestationHash,
        txHash,
        submittedAt: now,
      },
    },
    { headers: corsHeaders }
  );
}
