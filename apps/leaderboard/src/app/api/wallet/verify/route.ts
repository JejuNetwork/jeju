/**
 * Wallet Verification API
 * Verifies wallet ownership via EIP-191 signatures
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/data/db-nextjs";
import { walletAddresses, users } from "@/lib/data/schema";
import { eq, and } from "drizzle-orm";
import { verifyMessage, isAddress } from "viem";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

/**
 * GET /api/wallet/verify?username=...
 * Get the verification message to sign
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");
  const walletAddress = searchParams.get("wallet");

  if (!username) {
    return NextResponse.json(
      { error: "username parameter required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Generate verification message
  const timestamp = Date.now();
  const message = generateVerificationMessage(username, walletAddress, timestamp);

  return NextResponse.json(
    {
      message,
      timestamp,
      instructions: "Sign this message with your wallet to verify ownership",
    },
    { headers: CORS_HEADERS }
  );
}

/**
 * POST /api/wallet/verify
 * Verify a signed message and update wallet verification status
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { username, walletAddress, signature, message, chainId = "eip155:1" } = body;

  if (!username || !walletAddress || !signature || !message) {
    return NextResponse.json(
      { error: "username, walletAddress, signature, and message are required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate wallet address format
  if (!isAddress(walletAddress)) {
    return NextResponse.json(
      { error: "Invalid wallet address format" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Verify user exists
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  // Verify signature
  let recoveredAddress: string;
  try {
    const isValid = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    recoveredAddress = walletAddress.toLowerCase();
  } catch {
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate message contains the username
  if (!message.includes(username)) {
    return NextResponse.json(
      { error: "Message must contain the username" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const now = new Date().toISOString();

  // Check if wallet already exists for this user
  const existingWallet = await db.query.walletAddresses.findFirst({
    where: and(
      eq(walletAddresses.userId, username),
      eq(walletAddresses.accountAddress, recoveredAddress),
      eq(walletAddresses.chainId, chainId)
    ),
  });

  if (existingWallet) {
    // Update verification status
    await db
      .update(walletAddresses)
      .set({
        signature,
        signatureMessage: message,
        isVerified: true,
        verifiedAt: now,
        updatedAt: now,
      })
      .where(eq(walletAddresses.id, existingWallet.id));
  } else {
    // Create new verified wallet entry
    await db.insert(walletAddresses).values({
      userId: username,
      chainId,
      accountAddress: recoveredAddress,
      signature,
      signatureMessage: message,
      isVerified: true,
      verifiedAt: now,
      isPrimary: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return NextResponse.json(
    {
      success: true,
      wallet: {
        address: recoveredAddress,
        chainId,
        isVerified: true,
        verifiedAt: now,
      },
      message: `Wallet ${recoveredAddress} verified for ${username}`,
    },
    { headers: CORS_HEADERS }
  );
}

function generateVerificationMessage(
  username: string,
  walletAddress: string | null,
  timestamp: number
): string {
  const walletPart = walletAddress ? ` for wallet ${walletAddress}` : "";
  return `I verify that GitHub user "${username}" owns this wallet${walletPart}.

Timestamp: ${timestamp}
Domain: leaderboard.jeju.network
Purpose: ERC-8004 Identity Verification

This signature proves wallet ownership and allows reputation attestation on the Jeju Network.`;
}
