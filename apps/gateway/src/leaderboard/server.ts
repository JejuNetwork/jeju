/**
 * Leaderboard API Server
 * 
 * Exposes all leaderboard APIs via Hono.
 * Mount at /leaderboard/api in main gateway.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Address, Hex } from 'viem';
import { isAddress, isHex } from 'viem';
import {
  authenticateRequest,
  verifyUserOwnership,
  checkRateLimit,
  getClientId,
  generateVerificationMessage,
  generateNonce,
  verifyWalletSignature,
} from './auth.js';
import {
  calculateUserReputation,
  createAttestation,
  storeAttestation,
  getAttestation,
  confirmAttestation,
  getTopContributors,
} from './reputation.js';
import { query, exec, initLeaderboardDB } from './db.js';
import { LEADERBOARD_CONFIG } from './config.js';
import {
  GetAttestationQuerySchema,
  CreateAttestationRequestSchema,
  ConfirmAttestationRequestSchema,
  WalletVerifyQuerySchema,
  WalletVerifyRequestSchema,
  AgentLinkQuerySchema,
  CreateAgentLinkRequestSchema,
  LeaderboardQuerySchema,
  UsernameSchema,
  expect,
  expectAddress,
  validateBody,
  validateQuery,
} from '../lib/validation.js';

const app = new Hono();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'leaderboard' }));

// ============================================================================
// Attestation Endpoints
// ============================================================================

/**
 * GET /api/attestation?wallet=0x...&chainId=eip155:1
 * Returns reputation data for a wallet address (public)
 */
app.get('/api/attestation', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`attestation-get:${clientId}`, LEADERBOARD_CONFIG.rateLimits.attestation);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded', retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000) }, 429);
  }

  try {
    const validated = validateQuery(GetAttestationQuerySchema, c.req.query(), 'get attestation');
    const walletAddress = validated.wallet;
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId;
    const username = validated.username;

    if (!walletAddress && !username) {
      return c.json({ error: 'wallet or username parameter required' }, 400);
    }

    // Find user by wallet or username
    let user: { username: string; avatar_url: string } | undefined;
    let wallet: { user_id: string; account_address: string; chain_id: string; is_verified: number; verified_at: string | null } | undefined;

    if (walletAddress) {
    const walletResult = await query<{
      user_id: string;
      account_address: string;
      chain_id: string;
      is_verified: number;
      verified_at: string | null;
    }>(
      `SELECT user_id, account_address, chain_id, is_verified, verified_at
       FROM wallet_addresses
       WHERE account_address = ? AND is_active = 1`,
      [walletAddress.toLowerCase()]
    );

    if (walletResult.length === 0) {
      return c.json({ error: 'Wallet not linked to any GitHub account' }, 404);
    }

    wallet = walletResult[0];
    const users = await query<{ username: string; avatar_url: string }>(
      'SELECT username, avatar_url FROM users WHERE username = ?',
      [wallet.user_id]
    );
    user = users[0];
  } else if (username) {
    const users = await query<{ username: string; avatar_url: string }>(
      'SELECT username, avatar_url FROM users WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }
    user = users[0];

    // Find primary wallet
    const wallets = await query<{
      user_id: string;
      account_address: string;
      chain_id: string;
      is_verified: number;
      verified_at: string | null;
    }>(
      `SELECT user_id, account_address, chain_id, is_verified, verified_at
       FROM wallet_addresses
       WHERE user_id = ? AND chain_id = ? AND is_active = 1`,
      [username, chainId]
    );
      wallet = wallets[0];
    }

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const reputation = await calculateUserReputation(user.username);
    const attestation = wallet ? await getAttestation(user.username, wallet.account_address, wallet.chain_id) : null;

    return c.json({
      username: user.username,
      avatarUrl: user.avatar_url,
      wallet: wallet ? {
        address: wallet.account_address,
        chainId: wallet.chain_id,
        isVerified: Boolean(wallet.is_verified),
        verifiedAt: wallet.verified_at,
      } : null,
      reputation,
      attestation,
      oracleConfigured: Boolean(LEADERBOARD_CONFIG.oracle.privateKey),
      onChainEnabled: LEADERBOARD_CONFIG.oracle.isEnabled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/attestation
 * Request a new signed reputation attestation (authenticated)
 */
app.post('/api/attestation', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`attestation-post:${clientId}`, LEADERBOARD_CONFIG.rateLimits.attestation);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const authResult = await authenticateRequest(c.req.raw);
  if (!authResult.success) {
    return c.json({ error: authResult.error }, authResult.status);
  }

  try {
    const validated = validateBody(CreateAttestationRequestSchema, await c.req.json(), 'create attestation');
    const { username, walletAddress, agentId } = validated;
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId;

    if (!verifyUserOwnership(authResult.user, username)) {
      return c.json({ error: 'You can only request attestations for your own account' }, 403);
    }

    // Verify wallet is linked and verified
    const wallets = await query<{ is_verified: number }>(
      `SELECT is_verified FROM wallet_addresses
       WHERE user_id = ? AND account_address = ? AND is_active = 1`,
      [username, walletAddress.toLowerCase()]
    );

    if (wallets.length === 0) {
      return c.json({ error: 'Wallet not linked to this GitHub account' }, 403);
    }

    if (!wallets[0].is_verified) {
      return c.json({
        error: 'Wallet must be verified before requesting attestation',
        action: 'verify_wallet',
      }, 403);
    }

    const reputation = await calculateUserReputation(username);
    const timestamp = Math.floor(Date.now() / 1000);
    const attestation = await createAttestation(walletAddress, agentId || 0, reputation, timestamp);

    await storeAttestation(username, walletAddress, chainId, reputation, attestation, agentId || null);

    const message = LEADERBOARD_CONFIG.oracle.isEnabled && attestation.signature
      ? `Signed attestation created for ${username}. Score: ${reputation.normalizedScore}/100`
      : `Reputation recorded for ${username}. Score: ${reputation.normalizedScore}/100`;

    return c.json({
      success: true,
      onChainEnabled: LEADERBOARD_CONFIG.oracle.isEnabled,
      attestation: {
        hash: attestation.hash,
        signature: attestation.signature,
        normalizedScore: attestation.normalizedScore,
        timestamp,
        agentId: agentId || 0,
        onChainParams: attestation.onChainParams,
      },
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

// ============================================================================
// Attestation Confirm
// ============================================================================

/**
 * POST /api/attestation/confirm
 * Confirm on-chain attestation submission
 */
app.post('/api/attestation/confirm', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`attestation-confirm:${clientId}`, LEADERBOARD_CONFIG.rateLimits.attestation);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const authResult = await authenticateRequest(c.req.raw);
  if (!authResult.success) {
    return c.json({ error: authResult.error }, authResult.status);
  }

  try {
    const validated = validateBody(ConfirmAttestationRequestSchema, await c.req.json(), 'confirm attestation');
    const { attestationHash, txHash, walletAddress } = validated;
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId;

    // Find attestation and verify ownership
    const attestations = await query<{ user_id: string }>(
      `SELECT user_id FROM reputation_attestations
       WHERE attestation_hash = ? AND wallet_address = ? AND chain_id = ?`,
      [attestationHash, walletAddress.toLowerCase(), chainId]
    );

    if (attestations.length === 0) {
      return c.json({ error: 'Attestation not found' }, 404);
    }

    if (!verifyUserOwnership(authResult.user, attestations[0].user_id)) {
      return c.json({ error: 'You can only confirm attestations for your own account' }, 403);
    }

    const success = await confirmAttestation(attestationHash, walletAddress, chainId, txHash);
    if (!success) {
      return c.json({ error: 'Failed to update attestation' }, 500);
    }

    return c.json({
      success: true,
      attestation: { hash: attestationHash, txHash, submittedAt: new Date().toISOString() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

// ============================================================================
// Wallet Verification
// ============================================================================

/**
 * GET /api/wallet/verify?username=...&wallet=...
 * Get verification message to sign (authenticated)
 */
app.get('/api/wallet/verify', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`wallet-verify-get:${clientId}`, LEADERBOARD_CONFIG.rateLimits.walletVerify);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const authResult = await authenticateRequest(c.req.raw);
  if (!authResult.success) {
    return c.json({ error: authResult.error }, authResult.status);
  }

  try {
    const validated = validateQuery(WalletVerifyQuerySchema, c.req.query(), 'wallet verify');
    const username = validated.username;
    const walletAddress = validated.wallet;

    if (!verifyUserOwnership(authResult.user, username)) {
      return c.json({ error: 'You can only request verification for your own account' }, 403);
    }

    // Verify user exists
    const users = await query<{ username: string }>('SELECT username FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return c.json({ error: 'User not found. Please ensure your GitHub is synced first.' }, 404);
    }

    const timestamp = Date.now();
    const nonce = generateNonce(username);
    const message = generateVerificationMessage(username, walletAddress || null, timestamp, nonce);

    return c.json({
      message,
      timestamp,
      nonce,
      expiresAt: timestamp + LEADERBOARD_CONFIG.tokens.maxMessageAgeMs,
      instructions: 'Sign this message with your wallet to verify ownership. Message expires in 10 minutes.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/wallet/verify
 * Verify signed message and link wallet (authenticated)
 */
app.post('/api/wallet/verify', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`wallet-verify-post:${clientId}`, LEADERBOARD_CONFIG.rateLimits.walletVerify);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const authResult = await authenticateRequest(c.req.raw);
  if (!authResult.success) {
    return c.json({ error: authResult.error }, authResult.status);
  }

  try {
    const validated = validateBody(WalletVerifyRequestSchema, await c.req.json(), 'wallet verify');
    const { username, walletAddress, signature, message, timestamp } = validated;
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId;

    if (!verifyUserOwnership(authResult.user, username)) {
      return c.json({ error: 'You can only verify wallets for your own account' }, 403);
    }

    // Validate timestamp
    const messageAge = Date.now() - timestamp;
    if (messageAge > LEADERBOARD_CONFIG.tokens.maxMessageAgeMs) {
      return c.json({ error: 'Verification message expired. Please request a new one.' }, 400);
    }
    if (messageAge < 0) {
      return c.json({ error: 'Invalid timestamp (future date)' }, 400);
    }

    // Verify signature
    const isValid = await verifyWalletSignature(walletAddress as Address, message, signature as Hex);
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // Validate message content
    if (!message.includes(username) || !message.includes(LEADERBOARD_CONFIG.domain.domain)) {
      return c.json({ error: 'Invalid message content' }, 400);
    }

    const now = new Date().toISOString();
    const normalizedAddress = walletAddress.toLowerCase();

    // Check if wallet exists
    const existing = await query<{ id: number }>(
      `SELECT id FROM wallet_addresses
       WHERE user_id = ? AND account_address = ? AND chain_id = ?`,
      [username, normalizedAddress, chainId]
    );

    if (existing.length > 0) {
      await exec(
        `UPDATE wallet_addresses SET
          signature = ?, signature_message = ?, is_verified = 1, verified_at = ?, updated_at = ?
         WHERE id = ?`,
        [signature, message, now, now, existing[0].id]
      );
    } else {
      await exec(
        `INSERT INTO wallet_addresses (
          user_id, chain_id, account_address, signature, signature_message,
          is_verified, verified_at, is_primary, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, 0, 1, ?, ?)`,
        [username, chainId, normalizedAddress, signature, message, now, now, now]
      );
    }

    return c.json({
      success: true,
      wallet: { address: normalizedAddress, chainId, isVerified: true, verifiedAt: now },
      message: `Wallet ${normalizedAddress} verified for ${username}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

// ============================================================================
// Agent Link
// ============================================================================

/**
 * GET /api/agent/link?wallet=...&agentId=...
 * Get agent links (public)
 */
app.get('/api/agent/link', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`agent-link-get:${clientId}`, LEADERBOARD_CONFIG.rateLimits.agentLink);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  try {
    const validated = validateQuery(AgentLinkQuerySchema, c.req.query(), 'agent link');
    const walletAddress = validated.wallet;
    const username = validated.username;
    const agentId = validated.agentId;

    if (!walletAddress && !username && !agentId) {
      return c.json({ error: 'wallet, username, or agentId parameter required' }, 400);
    }

    let links: Array<{
    id: number;
    user_id: string;
    wallet_address: string;
    chain_id: string;
    agent_id: number;
    registry_address: string;
    is_verified: number;
    verified_at: string | null;
  }>;

  if (agentId) {
    links = await query(`SELECT * FROM agent_identity_links WHERE agent_id = ?`, [agentId.toString()]);
  } else if (walletAddress) {
    links = await query(`SELECT * FROM agent_identity_links WHERE wallet_address = ?`, [walletAddress.toLowerCase()]);
  } else {
    links = await query(`SELECT * FROM agent_identity_links WHERE user_id = ?`, [username!]);
  }

  // Get user info for each link
  const enrichedLinks = await Promise.all(links.map(async (link) => {
    const users = await query<{ username: string; avatar_url: string }>(
      'SELECT username, avatar_url FROM users WHERE username = ?',
      [link.user_id]
    );
    const user = users[0];
    return {
      id: link.id,
      username: link.user_id,
      walletAddress: link.wallet_address,
      chainId: link.chain_id,
      agentId: link.agent_id,
      registryAddress: link.registry_address,
      isVerified: Boolean(link.is_verified),
      verifiedAt: link.verified_at,
      user: user ? { username: user.username, avatarUrl: user.avatar_url } : null,
    };
    }));

    return c.json({ links: enrichedLinks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/agent/link
 * Create agent link (authenticated)
 */
app.post('/api/agent/link', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`agent-link-post:${clientId}`, LEADERBOARD_CONFIG.rateLimits.agentLink);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const authResult = await authenticateRequest(c.req.raw);
  if (!authResult.success) {
    return c.json({ error: authResult.error }, authResult.status);
  }

  try {
    const validated = validateBody(CreateAgentLinkRequestSchema, await c.req.json(), 'create agent link');
    const { username, walletAddress, agentId, registryAddress, txHash } = validated;
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId;

    if (!verifyUserOwnership(authResult.user, username)) {
      return c.json({ error: 'You can only create agent links for your own account' }, 403);
    }

    // Verify wallet is linked and verified
    const wallets = await query<{ is_verified: number }>(
    `SELECT is_verified FROM wallet_addresses
     WHERE user_id = ? AND account_address = ? AND is_active = 1`,
    [username, walletAddress.toLowerCase()]
  );

  if (wallets.length === 0) {
    return c.json({ error: 'Wallet not linked to this GitHub account' }, 403);
  }

  if (!wallets[0].is_verified) {
    return c.json({ error: 'Wallet must be verified before creating agent links', action: 'verify_wallet' }, 403);
  }

  const now = new Date().toISOString();
  const normalizedWallet = walletAddress.toLowerCase();
  const normalizedRegistry = registryAddress.toLowerCase();

  // Check existing link
  const existing = await query<{ id: number; user_id: string }>(
    `SELECT id, user_id FROM agent_identity_links
     WHERE wallet_address = ? AND chain_id = ? AND agent_id = ?`,
    [normalizedWallet, chainId, agentId]
  );

  if (existing.length > 0) {
    if (existing[0].user_id !== username) {
      return c.json({ error: 'This agent is already linked to a different user' }, 403);
    }

    await exec(
      `UPDATE agent_identity_links SET
        registry_address = ?, is_verified = ?, verified_at = ?, verification_tx_hash = ?, updated_at = ?
       WHERE id = ?`,
      [normalizedRegistry, wallets[0].is_verified, now, txHash || null, now, existing[0].id]
    );

    return c.json({
      success: true,
      link: {
        id: existing[0].id,
        username,
        walletAddress: normalizedWallet,
        chainId,
        agentId,
        registryAddress: normalizedRegistry,
        isVerified: Boolean(wallets[0].is_verified),
      },
      message: 'Agent link updated',
    });
  }

  const result = await exec(
    `INSERT INTO agent_identity_links (
      user_id, wallet_address, chain_id, agent_id, registry_address,
      is_verified, verified_at, verification_tx_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [username, normalizedWallet, chainId, agentId, normalizedRegistry,
     wallets[0].is_verified, now, txHash || null, now, now]
  );

  return c.json({
    success: true,
    link: {
      id: result.rowsAffected,
      username,
      walletAddress: normalizedWallet,
      chainId,
      agentId,
      registryAddress: normalizedRegistry,
      isVerified: Boolean(wallets[0].is_verified),
      },
      message: `Agent #${agentId} linked to ${username}`,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

// ============================================================================
// Leaderboard Data
// ============================================================================

/**
 * GET /api/leaderboard?limit=10
 * Get top contributors (public)
 */
app.get('/api/leaderboard', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`leaderboard:${clientId}`, LEADERBOARD_CONFIG.rateLimits.general);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  try {
    const validated = validateQuery(LeaderboardQuerySchema, c.req.query(), 'leaderboard');
    const contributors = await getTopContributors(validated.limit);

    return c.json({ contributors, totalContributors: contributors.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

/**
 * GET /api/profile/:username
 * Get contributor profile (public)
 */
app.get('/api/profile/:username', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`profile:${clientId}`, LEADERBOARD_CONFIG.rateLimits.general);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  try {
    const username = expect(c.req.param('username'), UsernameSchema, 'username');

  const users = await query<{ username: string; avatar_url: string }>(
    'SELECT username, avatar_url FROM users WHERE username = ?',
    [username]
  );

  if (users.length === 0) {
    return c.json({ error: 'User not found' }, 404);
  }

    const user = users[0];
    const reputation = await calculateUserReputation(username);

    return c.json({
      profile: {
        username: user.username,
        avatarUrl: user.avatar_url,
        score: Math.round(reputation.totalScore),
        normalizedScore: reputation.normalizedScore,
        breakdown: {
          prScore: Math.round(reputation.prScore),
          issueScore: Math.round(reputation.issueScore),
          reviewScore: Math.round(reputation.reviewScore),
          commitScore: Math.round(reputation.commitScore),
        },
        stats: {
          totalPRs: reputation.totalPrCount,
          mergedPRs: reputation.mergedPrCount,
          totalCommits: reputation.totalCommits,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

// ============================================================================
// A2A Endpoint
// ============================================================================

import { A2ARequestSchema, type A2ARequest } from '../lib/validation.js';

/**
 * POST /api/a2a
 * Agent-to-Agent protocol endpoint
 */
app.post('/api/a2a', async (c) => {
  const clientId = getClientId(c.req.raw);
  const limit = checkRateLimit(`a2a:${clientId}`, LEADERBOARD_CONFIG.rateLimits.a2a);
  if (!limit.allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  try {
    const body = validateBody(A2ARequestSchema, await c.req.json(), 'A2A request');
    const message = body.params.message;
    const dataPart = message.parts.find((p) => p.kind === 'data');
    const skillId = dataPart?.data?.skillId;
    const params = dataPart?.data || {};

  let result: { message: string; data: Record<string, unknown> };

  switch (skillId) {
    case 'get-leaderboard': {
      const contributors = await getTopContributors(Number(params.limit) || 10);
      result = {
        message: `Top ${contributors.length} contributors on the Network leaderboard`,
        data: { contributors, totalContributors: contributors.length },
      };
      break;
    }
    case 'get-contributor-profile': {
      const username = params.username as string;
      if (!username) {
        result = { message: 'Username required', data: { error: 'Missing username parameter' } };
        break;
      }
      const users = await query<{ username: string; avatar_url: string }>(
        'SELECT username, avatar_url FROM users WHERE username = ?',
        [username]
      );
      if (users.length === 0) {
        result = { message: `User ${username} not found`, data: { error: 'User not found' } };
        break;
      }
      const reputation = await calculateUserReputation(username);
      result = {
        message: `Profile for ${username}`,
        data: {
          profile: {
            username: users[0].username,
            avatarUrl: users[0].avatar_url,
            score: Math.round(reputation.totalScore),
            breakdown: {
              prScore: Math.round(reputation.prScore),
              issueScore: Math.round(reputation.issueScore),
              reviewScore: Math.round(reputation.reviewScore),
            },
            stats: {
              totalPRs: reputation.totalPrCount,
              mergedPRs: reputation.mergedPrCount,
              totalCommits: reputation.totalCommits,
            },
          },
        },
      };
      break;
    }
    default:
      result = { message: `Unknown skill: ${skillId}`, data: { error: 'Skill not found' } };
  }

    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }],
        messageId: message.messageId,
        kind: 'message',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message },
    });
  }
});

// ============================================================================
// DWS Integration Endpoints (Git and NPM contributions)
// ============================================================================

/**
 * POST /api/contributions/jeju-git
 * Record Git activity from DWS Git service
 */
app.post('/api/contributions/jeju-git', async (c) => {
  const service = c.req.header('x-jeju-service');
  if (service !== 'dws-git') {
    return c.json({ error: 'Invalid service header' }, 401);
  }

  try {
    const body = await c.req.json<{
      username?: string;
      walletAddress?: Address;
      source: string;
      scores: { commits: number; prs: number; issues: number; reviews: number };
      contributions: Array<{
        type: string;
        repoId: string;
        timestamp: number;
        metadata: Record<string, unknown>;
      }>;
      timestamp: number;
    }>();

    if (!body.source || typeof body.source !== 'string') {
      throw new Error('source is required');
    }
    if (!body.scores || typeof body.scores !== 'object') {
      throw new Error('scores is required');
    }
    if (!Array.isArray(body.contributions)) {
      throw new Error('contributions must be an array');
    }
    if (typeof body.timestamp !== 'number') {
      throw new Error('timestamp is required');
    }

  // Get username from wallet if not provided
  let username = body.username;
  if (!username && body.walletAddress) {
    const mapping = await query<{ username: string }>(
      'SELECT username FROM wallet_mappings WHERE wallet_address = ?',
      [body.walletAddress.toLowerCase()]
    );
    if (mapping.length > 0) {
      username = mapping[0].username;
    }
  }

  if (!username) {
    return c.json({ error: 'No username mapping found for wallet' }, 400);
  }

  // Calculate score from contributions
  const WEIGHTS = {
    commit: 5,
    pr_open: 50,
    pr_merge: 100,
    branch: 10,
    merge: 20,
    issue: 20,
    review: 30,
  };

  let totalScore = 0;
  for (const contribution of body.contributions) {
    const weight = WEIGHTS[contribution.type as keyof typeof WEIGHTS] || 5;
    totalScore += weight;
  }

  // Store in daily scores
  const date = new Date().toISOString().split('T')[0];
  const scoreId = `${username}_${date}_jeju-git`;

  await exec(
    `INSERT INTO user_daily_scores (id, username, date, score, pr_score, issue_score, review_score, comment_score, metrics, category, timestamp, last_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'jeju-git', ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       score = score + excluded.score,
       pr_score = pr_score + excluded.pr_score,
       issue_score = issue_score + excluded.issue_score,
       review_score = review_score + excluded.review_score,
       last_updated = excluded.last_updated`,
    [
      scoreId,
      username,
      date,
      totalScore,
      (body.scores?.prs || 0) * 50,
      (body.scores?.issues || 0) * 20,
      (body.scores?.reviews || 0) * 30,
      (body.scores?.commits || 0) * 5,
      JSON.stringify({ contributions: body.contributions.length, source: 'jeju-git' }),
      new Date().toISOString(),
      new Date().toISOString(),
    ]
  );

    return c.json({ success: true, scoreAdded: totalScore });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/contributions/jeju-npm
 * Record NPM activity from DWS NPM service
 */
app.post('/api/contributions/jeju-npm', async (c) => {
  const service = c.req.header('x-jeju-service');
  if (service !== 'dws-npm') {
    return c.json({ error: 'Invalid service header' }, 401);
  }

  try {
    const body = await c.req.json<{
      walletAddress: Address;
      source: string;
      score: number;
      contribution: {
        type: string;
        packageId: string;
        packageName: string;
        timestamp: number;
        metadata: Record<string, unknown>;
      };
    }>();

    if (!body.walletAddress || !isAddress(body.walletAddress)) {
      throw new Error('Invalid walletAddress');
    }
    if (!body.source || typeof body.source !== 'string') {
      throw new Error('source is required');
    }
    if (typeof body.score !== 'number') {
      throw new Error('score is required');
    }
    if (!body.contribution || typeof body.contribution !== 'object') {
      throw new Error('contribution is required');
    }

  // Get username from wallet
  const mapping = await query<{ username: string }>(
    'SELECT username FROM wallet_mappings WHERE wallet_address = ?',
    [body.walletAddress.toLowerCase()]
  );

  let username = 'anonymous';
  if (mapping.length > 0) {
    username = mapping[0].username;
  }

  // Store NPM contribution score
  const date = new Date().toISOString().split('T')[0];
  const scoreId = `${username}_${date}_jeju-npm`;

  await exec(
    `INSERT INTO user_daily_scores (id, username, date, score, pr_score, issue_score, review_score, comment_score, metrics, category, timestamp, last_updated)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, 'jeju-npm', ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       score = score + excluded.score,
       last_updated = excluded.last_updated`,
    [
      scoreId,
      username,
      date,
      body.score,
      JSON.stringify({ packageName: body.contribution.packageName, type: body.contribution.type }),
      new Date().toISOString(),
      new Date().toISOString(),
    ]
  );

    return c.json({ success: true, scoreAdded: body.score });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/packages/downloads
 * Record package download counts (for popularity tracking)
 */
app.post('/api/packages/downloads', async (c) => {
  const service = c.req.header('x-jeju-service');
  if (service !== 'dws-npm') {
    return c.json({ error: 'Invalid service header' }, 401);
  }

  try {
    const body = await c.req.json<{
      packageId: string;
      packageName: string;
      downloadCount: number;
      timestamp: number;
    }>();

    if (!body.packageId || typeof body.packageId !== 'string') {
      throw new Error('packageId is required');
    }
    if (!body.packageName || typeof body.packageName !== 'string') {
      throw new Error('packageName is required');
    }
    if (typeof body.downloadCount !== 'number') {
      throw new Error('downloadCount is required');
    }
    if (typeof body.timestamp !== 'number') {
      throw new Error('timestamp is required');
    }

  // Store package download stats (could be used for trending packages)
  await exec(
    `INSERT INTO package_stats (package_id, package_name, download_count, last_updated)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(package_id) DO UPDATE SET 
       download_count = download_count + excluded.download_count,
       last_updated = excluded.last_updated`,
    [body.packageId, body.packageName, body.downloadCount, new Date().toISOString()]
  );

    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ error: message }, 400);
  }
});

/**
 * GET /api/wallet-mappings
 * Get all wallet to username mappings (for DWS integration)
 */
app.get('/api/wallet-mappings', async (c) => {
  const mappings = await query<{ wallet_address: string; username: string }>(
    'SELECT wallet_address, username FROM wallet_mappings'
  );

  return c.json({
    mappings: mappings.map(m => ({
      walletAddress: m.wallet_address,
      username: m.username,
    })),
  });
});

// Initialize database on first request
let dbInitialized = false;
app.use('*', async (_c, next) => {
  if (!dbInitialized) {
    await initLeaderboardDB();
    dbInitialized = true;
  }
  return next();
});

export { app as leaderboardApp };
export default app;



