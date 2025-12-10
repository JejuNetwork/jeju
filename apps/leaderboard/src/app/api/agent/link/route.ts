/**
 * Agent Identity Link API
 * Links GitHub accounts to ERC-8004 agent IDs
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/data/db-nextjs";
import {
  walletAddresses,
  agentIdentityLinks,
  users,
} from "@/lib/data/schema";
import { eq, and } from "drizzle-orm";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

/**
 * GET /api/agent/link?wallet=0x...&chainId=eip155:1
 * Get agent links for a wallet
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet");
  const username = searchParams.get("username");
  const agentId = searchParams.get("agentId");

  if (!walletAddress && !username && !agentId) {
    return NextResponse.json(
      { error: "wallet, username, or agentId parameter required" },
      { status: 400, headers: CORS_HEADERS }
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
    { headers: CORS_HEADERS }
  );
}

/**
 * POST /api/agent/link
 * Create a new agent-GitHub link
 */
export async function POST(request: NextRequest) {
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
      { status: 403, headers: CORS_HEADERS }
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
      { headers: CORS_HEADERS }
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
    { status: 201, headers: CORS_HEADERS }
  );
}

/**
 * DELETE /api/agent/link
 * Remove an agent link
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { username, agentId, chainId = "eip155:1" } = body;

  if (!username || !agentId) {
    return NextResponse.json(
      { error: "username and agentId required" },
      { status: 400, headers: CORS_HEADERS }
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
      { status: 404, headers: CORS_HEADERS }
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
    { headers: CORS_HEADERS }
  );
}
