/**
 * Wallet Verification API
 * Verifies wallet ownership via EIP-191 signatures
 * 
 * Security: Requires GitHub OAuth token authentication
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/data/db-nextjs";
import { walletAddresses, users } from "@/lib/data/schema";
import { eq, and } from "drizzle-orm";
import { verifyMessage, isAddress, keccak256, toBytes } from "viem";
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

// Maximum age of verification message (10 minutes)
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

// Domain for verification messages
const VERIFICATION_DOMAIN = process.env.LEADERBOARD_DOMAIN || "leaderboard.jeju.network";

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
 * GET /api/wallet/verify?username=...&wallet=...
 * Get the verification message to sign
 * 
 * Requires: Authorization header with GitHub token
 * User can only request verification messages for their own account
 */
export async function GET(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);
  
  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`wallet-verify-get:${clientId}`, RATE_LIMITS.walletVerify);
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

  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");
  const walletAddress = searchParams.get("wallet");

  if (!username) {
    return NextResponse.json(
      { error: "username parameter required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Verify user is requesting for their own account
  if (!verifyUserOwnership(authResult.user, username)) {
    return forbiddenResponse(
      "You can only request verification for your own account",
      corsHeaders
    );
  }

  // Verify user exists in database
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user) {
    return NextResponse.json(
      { error: "User not found. Please ensure your GitHub is synced first." },
      { status: 404, headers: corsHeaders }
    );
  }

  // Generate verification message with nonce
  const timestamp = Date.now();
  const nonce = keccak256(toBytes(`${username}-${timestamp}-${Math.random()}`)).slice(0, 18);
  const message = generateVerificationMessage(username, walletAddress, timestamp, nonce);

  return NextResponse.json(
    {
      message,
      timestamp,
      nonce,
      expiresAt: timestamp + MAX_MESSAGE_AGE_MS,
      instructions: "Sign this message with your wallet to verify ownership. Message expires in 10 minutes.",
    },
    { headers: corsHeaders }
  );
}

/**
 * POST /api/wallet/verify
 * Verify a signed message and update wallet verification status
 * 
 * Requires: Authorization header with GitHub token
 * User can only verify wallets for their own account
 */
export async function POST(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`wallet-verify-post:${clientId}`, RATE_LIMITS.walletVerify);
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
  const { username, walletAddress, signature, message, chainId = "eip155:1", timestamp } = body;

  if (!username || !walletAddress || !signature || !message) {
    return NextResponse.json(
      { error: "username, walletAddress, signature, and message are required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // SECURITY: Timestamp is now required
  if (!timestamp) {
    return NextResponse.json(
      { error: "timestamp is required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Verify user is verifying for their own account
  if (!verifyUserOwnership(authResult.user, username)) {
    return forbiddenResponse(
      "You can only verify wallets for your own account",
      corsHeaders
    );
  }

  // Validate wallet address format
  if (!isAddress(walletAddress)) {
    return NextResponse.json(
      { error: "Invalid wallet address format" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Validate timestamp to prevent replay attacks
  const messageAge = Date.now() - timestamp;
  if (messageAge > MAX_MESSAGE_AGE_MS) {
    return NextResponse.json(
      { error: "Verification message expired. Please request a new one." },
      { status: 400, headers: corsHeaders }
    );
  }
  if (messageAge < 0) {
    return NextResponse.json(
      { error: "Invalid timestamp (future date)" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Verify user exists
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 404, headers: corsHeaders }
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
        { status: 400, headers: corsHeaders }
      );
    }

    recoveredAddress = walletAddress.toLowerCase();
  } catch {
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 400, headers: corsHeaders }
    );
  }

  // Validate message contains required components
  if (!message.includes(username)) {
    return NextResponse.json(
      { error: "Message must contain the username" },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!message.includes(VERIFICATION_DOMAIN)) {
    return NextResponse.json(
      { error: "Message must contain the verification domain" },
      { status: 400, headers: corsHeaders }
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
    { headers: corsHeaders }
  );
}

function generateVerificationMessage(
  username: string,
  walletAddress: string | null,
  timestamp: number,
  nonce: string
): string {
  const walletPart = walletAddress ? `\nWallet: ${walletAddress}` : "";
  return `I verify that GitHub user "${username}" owns this wallet.
${walletPart}
Timestamp: ${timestamp}
Nonce: ${nonce}
Domain: ${VERIFICATION_DOMAIN}
Purpose: ERC-8004 Identity Verification

This signature proves wallet ownership and allows reputation attestation on the Jeju Network.`;
}
