/**
 * Agent Identity Link API
 * Links GitHub accounts to ERC-8004 agent IDs
 * 
 * Security: POST/DELETE require GitHub OAuth token authentication
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/data/db-nextjs";
import {
  walletAddresses,
  agentIdentityLinks,
  users,
} from "@/lib/data/schema";
import { eq, and } from "drizzle-orm";
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
 * GET /api/agent/link?wallet=0x...&chainId=eip155:1
 * Get agent links for a wallet
 * 
 * Public endpoint - no authentication required for reading
 */
export async function GET(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`agent-link-get:${clientId}`, RATE_LIMITS.agentLink);
  if (!rateLimit.success) {
    return rateLimitExceededResponse(rateLimit, corsHeaders);
  }

  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet");
  const username = searchParams.get("username");
  const agentId = searchParams.get("agentId");

  if (!walletAddress && !username && !agentId) {
    return NextResponse.json(
      { error: "wallet, username, or agentId parameter required" },
      { status: 400, headers: corsHeaders }
    );
  }

  let links;

  if (agentId) {
    links = await db.query.agentIdentityLinks.findMany({
      where: eq(agentIdentityLinks.agentId, parseInt(agentId)),
      with: { user: true },
    });
  } else if (walletAddress) {
    links = await db.query.agentIdentityLinks.findMany({
      where: eq(agentIdentityLinks.walletAddress, walletAddress.toLowerCase()),
      with: { user: true },
    });
  } else if (username) {
    links = await db.query.agentIdentityLinks.findMany({
      where: eq(agentIdentityLinks.userId, username),
      with: { user: true },
    });
  }

  return NextResponse.json(
    {
      links: (links || []).map((link) => ({
        id: link.id,
        username: link.userId,
        walletAddress: link.walletAddress,
        chainId: link.chainId,
        agentId: link.agentId,
        registryAddress: link.registryAddress,
        isVerified: link.isVerified,
        verifiedAt: link.verifiedAt,
        user: link.user
          ? {
              username: link.user.username,
              avatarUrl: link.user.avatarUrl,
            }
          : null,
      })),
    },
    { headers: corsHeaders }
  );
}

/**
 * POST /api/agent/link
 * Create a new agent-GitHub link
 * 
 * Requires: Authorization header with GitHub token
 * User can only create links for their own account
 */
export async function POST(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`agent-link-post:${clientId}`, RATE_LIMITS.agentLink);
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
  const {
    username,
    walletAddress,
    agentId,
    registryAddress,
    chainId = "eip155:1",
    txHash,
  } = body;

  if (!username || !walletAddress || !agentId || !registryAddress) {
    return NextResponse.json(
      {
        error: "username, walletAddress, agentId, and registryAddress required",
      },
      { status: 400, headers: corsHeaders }
    );
  }

  // SECURITY: Verify user is creating link for their own account
  if (!verifyUserOwnership(authResult.user, username)) {
    return forbiddenResponse(
      "You can only create agent links for your own account",
      corsHeaders
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

  // Verify wallet is linked and verified for this user
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

  // Require wallet verification for agent links
  if (!wallet.isVerified) {
    return NextResponse.json(
      {
        error: "Wallet must be verified before creating agent links",
        action: "verify_wallet",
        message: "Please sign a verification message to prove wallet ownership first",
      },
      { status: 403, headers: corsHeaders }
    );
  }

  // Check for existing link
  const existingLink = await db.query.agentIdentityLinks.findFirst({
    where: and(
      eq(agentIdentityLinks.walletAddress, walletAddress.toLowerCase()),
      eq(agentIdentityLinks.chainId, chainId),
      eq(agentIdentityLinks.agentId, agentId)
    ),
  });

  const now = new Date().toISOString();

  if (existingLink) {
    // SECURITY: Verify the existing link belongs to the same user
    if (existingLink.userId !== username) {
      return forbiddenResponse(
        "This agent is already linked to a different user",
        corsHeaders
      );
    }

    // Update existing link
    await db
      .update(agentIdentityLinks)
      .set({
        registryAddress: registryAddress.toLowerCase(),
        isVerified: wallet.isVerified || false,
        verifiedAt: wallet.isVerified ? now : null,
        verificationTxHash: txHash || null,
        updatedAt: now,
      })
      .where(eq(agentIdentityLinks.id, existingLink.id));

    return NextResponse.json(
      {
        success: true,
        link: {
          id: existingLink.id,
          username,
          walletAddress: walletAddress.toLowerCase(),
          chainId,
          agentId,
          registryAddress: registryAddress.toLowerCase(),
          isVerified: wallet.isVerified || false,
        },
        message: "Agent link updated",
      },
      { headers: corsHeaders }
    );
  }

  // Create new link
  const result = await db
    .insert(agentIdentityLinks)
    .values({
      userId: username,
      walletAddress: walletAddress.toLowerCase(),
      chainId,
      agentId,
      registryAddress: registryAddress.toLowerCase(),
      isVerified: wallet.isVerified || false,
      verifiedAt: wallet.isVerified ? now : null,
      verificationTxHash: txHash || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: agentIdentityLinks.id });

  return NextResponse.json(
    {
      success: true,
      link: {
        id: result[0].id,
        username,
        walletAddress: walletAddress.toLowerCase(),
        chainId,
        agentId,
        registryAddress: registryAddress.toLowerCase(),
        isVerified: wallet.isVerified || false,
      },
      message: `Agent #${agentId} linked to ${username}`,
    },
    { status: 201, headers: corsHeaders }
  );
}

/**
 * DELETE /api/agent/link
 * Remove an agent link
 * 
 * Requires: Authorization header with GitHub token
 * User can only delete their own links
 */
export async function DELETE(request: NextRequest) {
  const corsHeaders = corsHeadersFromRequest(request);

  // Rate limiting
  const clientId = getClientIdentifier(request);
  const rateLimit = checkRateLimit(`agent-link-delete:${clientId}`, RATE_LIMITS.agentLink);
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
  const { username, agentId, chainId = "eip155:1" } = body;

  if (!username || !agentId) {
    return NextResponse.json(
      { error: "username and agentId required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // SECURITY: Verify user is deleting their own link
  if (!verifyUserOwnership(authResult.user, username)) {
    return forbiddenResponse(
      "You can only delete your own agent links",
      corsHeaders
    );
  }

  // Find and delete the link
  const link = await db.query.agentIdentityLinks.findFirst({
    where: and(
      eq(agentIdentityLinks.userId, username),
      eq(agentIdentityLinks.agentId, agentId),
      eq(agentIdentityLinks.chainId, chainId)
    ),
  });

  if (!link) {
    return NextResponse.json(
      { error: "Link not found" },
      { status: 404, headers: corsHeaders }
    );
  }

  await db
    .delete(agentIdentityLinks)
    .where(eq(agentIdentityLinks.id, link.id));

  return NextResponse.json(
    {
      success: true,
      message: `Agent #${agentId} unlinked from ${username}`,
    },
    { headers: corsHeaders }
  );
}
