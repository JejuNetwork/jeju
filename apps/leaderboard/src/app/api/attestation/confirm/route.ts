/**
 * Confirm on-chain attestation submission
 * Updates the attestation record with the transaction hash
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/data/db-nextjs";
import { reputationAttestations } from "@/lib/data/schema";
import { eq, and } from "drizzle-orm";
import { isHex } from "viem";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

/**
 * POST /api/attestation/confirm
 * Update attestation with on-chain transaction hash
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { attestationHash, txHash, walletAddress, chainId = "eip155:1" } = body;

  if (!attestationHash || !txHash || !walletAddress) {
    return NextResponse.json(
      { error: "attestationHash, txHash, and walletAddress required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate txHash format
  if (!isHex(txHash) || txHash.length !== 66) {
    return NextResponse.json(
      { error: "Invalid transaction hash format" },
      { status: 400, headers: CORS_HEADERS }
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
      { status: 404, headers: CORS_HEADERS }
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
    { headers: CORS_HEADERS }
  );
}
