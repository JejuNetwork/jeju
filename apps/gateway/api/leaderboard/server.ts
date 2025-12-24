import { timingSafeEqual } from 'node:crypto'
import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { isAddress } from 'viem'
import {
  A2ARequestSchema,
  AgentLinkQuerySchema,
  ConfirmAttestationRequestSchema,
  CreateAgentLinkRequestSchema,
  CreateAttestationRequestSchema,
  expect,
  GetAttestationQuerySchema,
  LeaderboardQuerySchema,
  UsernameSchema,
  validateBody,
  validateQuery,
  WalletVerifyQuerySchema,
  WalletVerifyRequestSchema,
} from '../../lib/validation'
import {
  authenticateRequest,
  checkRateLimit,
  generateNonce,
  generateVerificationMessage,
  getClientId,
  isAuthError,
  verifyUserOwnership,
  verifyWalletSignature,
} from './auth'
import { LEADERBOARD_CONFIG } from './config'
import { exec, initLeaderboardDB, query } from './db'
import {
  calculateUserReputation,
  confirmAttestation,
  createAttestation,
  getAttestation,
  getTopContributors,
  storeAttestation,
} from './reputation'

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
const isProduction = process.env.NODE_ENV === 'production'
const MAX_BODY_SIZE = 1024 * 1024

function timingSafeCompare(a: string | undefined | null, b: string): boolean {
  if (!a) return false
  const aLen = Buffer.from(a).length
  const bLen = Buffer.from(b).length
  const aBuf = Buffer.alloc(Math.max(aLen, bLen))
  const bBuf = Buffer.alloc(Math.max(aLen, bLen))
  Buffer.from(a).copy(aBuf)
  Buffer.from(b).copy(bBuf)
  return aLen === bLen && timingSafeEqual(aBuf, bBuf)
}

let dbInitialized = false
async function ensureDbInitialized() {
  if (!dbInitialized) {
    await initLeaderboardDB()
    dbInitialized = true
  }
}

const app = new Elysia()
  .use(
    cors(
      isProduction && CORS_ORIGINS?.length
        ? {
            origin: CORS_ORIGINS,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: [
              'Content-Type',
              'Authorization',
              'X-Requested-With',
            ],
            credentials: true,
            maxAge: 86400,
          }
        : {},
    ),
  )
  .onBeforeHandle(async () => {
    await ensureDbInitialized()
  })
  .onParse(async ({ request, contentType }) => {
    if (contentType === 'application/json') {
      const text = await request.text()
      if (text.length > MAX_BODY_SIZE) {
        throw new Error('Request body too large')
      }
      return JSON.parse(text)
    }
  })
  .get('/health', () => ({ status: 'ok', service: 'leaderboard' }))

  .get('/api/attestation', async ({ query: queryParams, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `attestation-get:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.attestation,
    )
    if (!limit.allowed) {
      set.status = 429
      return {
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000),
      }
    }

    const validated = validateQuery(
      GetAttestationQuerySchema,
      queryParams,
      'get attestation',
    )
    const walletAddress = validated.wallet
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId
    const username = validated.username

    if (!walletAddress && !username) {
      set.status = 400
      return { error: 'wallet or username parameter required' }
    }

    let user: { username: string; avatar_url: string } | undefined
    let wallet:
      | {
          user_id: string
          account_address: string
          chain_id: string
          is_verified: number
          verified_at: string | null
        }
      | undefined

    if (walletAddress) {
      const walletResult = await query<{
        user_id: string
        account_address: string
        chain_id: string
        is_verified: number
        verified_at: string | null
      }>(
        `SELECT user_id, account_address, chain_id, is_verified, verified_at
       FROM wallet_addresses
       WHERE account_address = ? AND is_active = 1`,
        [walletAddress.toLowerCase()],
      )

      if (walletResult.length === 0) {
        set.status = 404
        return { error: 'Wallet not linked to any GitHub account' }
      }

      wallet = walletResult[0]
      const users = await query<{ username: string; avatar_url: string }>(
        'SELECT username, avatar_url FROM users WHERE username = ?',
        [wallet.user_id],
      )
      user = users[0]
    } else if (username) {
      const users = await query<{ username: string; avatar_url: string }>(
        'SELECT username, avatar_url FROM users WHERE username = ?',
        [username],
      )

      if (users.length === 0) {
        set.status = 404
        return { error: 'User not found' }
      }
      user = users[0]

      const wallets = await query<{
        user_id: string
        account_address: string
        chain_id: string
        is_verified: number
        verified_at: string | null
      }>(
        `SELECT user_id, account_address, chain_id, is_verified, verified_at
       FROM wallet_addresses
       WHERE user_id = ? AND chain_id = ? AND is_active = 1`,
        [username, chainId],
      )
      wallet = wallets[0]
    }

    if (!user) {
      set.status = 404
      return { error: 'User not found' }
    }

    const reputation = await calculateUserReputation(user.username)
    const attestation = wallet
      ? await getAttestation(
          user.username,
          wallet.account_address,
          wallet.chain_id,
        )
      : null

    return {
      username: user.username,
      avatarUrl: user.avatar_url,
      wallet: wallet
        ? {
            address: wallet.account_address,
            chainId: wallet.chain_id,
            isVerified: Boolean(wallet.is_verified),
            verifiedAt: wallet.verified_at,
          }
        : null,
      reputation,
      attestation,
      oracleConfigured: Boolean(LEADERBOARD_CONFIG.oracle.privateKey),
      onChainEnabled: LEADERBOARD_CONFIG.oracle.isEnabled,
    }
  })

  .post('/api/attestation', async ({ body, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `attestation-post:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.attestation,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const authResult = await authenticateRequest(request)
    if (isAuthError(authResult)) {
      set.status = authResult.status
      return { error: authResult.error }
    }

    const validated = validateBody(
      CreateAttestationRequestSchema,
      body,
      'create attestation',
    )
    const { username, walletAddress, agentId } = validated
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId

    if (!verifyUserOwnership(authResult.user, username)) {
      set.status = 403
      return { error: 'You can only request attestations for your own account' }
    }

    const wallets = await query<{ is_verified: number }>(
      `SELECT is_verified FROM wallet_addresses
       WHERE user_id = ? AND account_address = ? AND is_active = 1`,
      [username, walletAddress.toLowerCase()],
    )

    if (wallets.length === 0) {
      set.status = 403
      return { error: 'Wallet not linked to this GitHub account' }
    }

    if (!wallets[0].is_verified) {
      set.status = 403
      return {
        error: 'Wallet must be verified before requesting attestation',
        action: 'verify_wallet',
      }
    }

    const reputation = await calculateUserReputation(username)
    const timestamp = Math.floor(Date.now() / 1000)
    const attestation = await createAttestation(
      walletAddress,
      agentId || 0,
      reputation,
      timestamp,
    )

    await storeAttestation(
      username,
      walletAddress,
      chainId,
      reputation,
      attestation,
      agentId || null,
    )

    const message =
      LEADERBOARD_CONFIG.oracle.isEnabled && attestation.signature
        ? `Signed attestation created for ${username}. Score: ${reputation.normalizedScore}/100`
        : `Reputation recorded for ${username}. Score: ${reputation.normalizedScore}/100`

    return {
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
    }
  })

  .post('/api/attestation/confirm', async ({ body, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `attestation-confirm:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.attestation,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const authResult = await authenticateRequest(request)
    if (isAuthError(authResult)) {
      set.status = authResult.status
      return { error: authResult.error }
    }

    const validated = validateBody(
      ConfirmAttestationRequestSchema,
      body,
      'confirm attestation',
    )
    const { attestationHash, txHash, walletAddress } = validated
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId

    const attestations = await query<{ user_id: string }>(
      `SELECT user_id FROM reputation_attestations
       WHERE attestation_hash = ? AND wallet_address = ? AND chain_id = ?`,
      [attestationHash, walletAddress.toLowerCase(), chainId],
    )

    if (attestations.length === 0) {
      set.status = 404
      return { error: 'Attestation not found' }
    }

    if (!verifyUserOwnership(authResult.user, attestations[0].user_id)) {
      set.status = 403
      return { error: 'You can only confirm attestations for your own account' }
    }

    const success = await confirmAttestation(
      attestationHash,
      walletAddress,
      chainId,
      txHash,
    )
    if (!success) {
      set.status = 500
      return { error: 'Failed to update attestation' }
    }

    return {
      success: true,
      attestation: {
        hash: attestationHash,
        txHash,
        submittedAt: new Date().toISOString(),
      },
    }
  })

  .get('/api/wallet/verify', async ({ query: queryParams, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `wallet-verify-get:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.walletVerify,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const authResult = await authenticateRequest(request)
    if (isAuthError(authResult)) {
      set.status = authResult.status
      return { error: authResult.error }
    }

    const validated = validateQuery(
      WalletVerifyQuerySchema,
      queryParams,
      'wallet verify',
    )
    const username = validated.username
    const walletAddress = validated.wallet

    if (!verifyUserOwnership(authResult.user, username)) {
      set.status = 403
      return { error: 'You can only request verification for your own account' }
    }

    const users = await query<{ username: string }>(
      'SELECT username FROM users WHERE username = ?',
      [username],
    )
    if (users.length === 0) {
      set.status = 404
      return {
        error: 'User not found. Please ensure your GitHub is synced first.',
      }
    }

    const timestamp = Date.now()
    const nonce = generateNonce(username)
    const message = generateVerificationMessage(
      username,
      walletAddress || null,
      timestamp,
      nonce,
    )

    return {
      message,
      timestamp,
      nonce,
      expiresAt: timestamp + LEADERBOARD_CONFIG.tokens.maxMessageAgeMs,
      instructions:
        'Sign this message with your wallet to verify ownership. Message expires in 10 minutes.',
    }
  })

  .post('/api/wallet/verify', async ({ body, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `wallet-verify-post:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.walletVerify,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const authResult = await authenticateRequest(request)
    if (isAuthError(authResult)) {
      set.status = authResult.status
      return { error: authResult.error }
    }

    const validated = validateBody(
      WalletVerifyRequestSchema,
      body,
      'wallet verify',
    )
    const { username, walletAddress, signature, message, timestamp } = validated
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId

    if (!verifyUserOwnership(authResult.user, username)) {
      set.status = 403
      return { error: 'You can only verify wallets for your own account' }
    }

    const messageAge = Date.now() - timestamp
    if (messageAge > LEADERBOARD_CONFIG.tokens.maxMessageAgeMs) {
      set.status = 400
      return {
        error: 'Verification message expired. Please request a new one.',
      }
    }
    if (messageAge < 0) {
      set.status = 400
      return { error: 'Invalid timestamp (future date)' }
    }

    const isValid = await verifyWalletSignature(
      walletAddress,
      message,
      signature,
    )
    if (!isValid) {
      set.status = 400
      return { error: 'Invalid signature' }
    }

    if (
      !message.includes(username) ||
      !message.includes(LEADERBOARD_CONFIG.domain.domain)
    ) {
      set.status = 400
      return { error: 'Invalid message content' }
    }

    const now = new Date().toISOString()
    const normalizedAddress = walletAddress.toLowerCase()

    const existing = await query<{ id: number }>(
      `SELECT id FROM wallet_addresses
       WHERE user_id = ? AND account_address = ? AND chain_id = ?`,
      [username, normalizedAddress, chainId],
    )

    if (existing.length > 0) {
      await exec(
        `UPDATE wallet_addresses SET
          signature = ?, signature_message = ?, is_verified = 1, verified_at = ?, updated_at = ?
         WHERE id = ?`,
        [signature, message, now, now, existing[0].id],
      )
    } else {
      await exec(
        `INSERT INTO wallet_addresses (
          user_id, chain_id, account_address, signature, signature_message,
          is_verified, verified_at, is_primary, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, 0, 1, ?, ?)`,
        [
          username,
          chainId,
          normalizedAddress,
          signature,
          message,
          now,
          now,
          now,
        ],
      )
    }

    return {
      success: true,
      wallet: {
        address: normalizedAddress,
        chainId,
        isVerified: true,
        verifiedAt: now,
      },
      message: `Wallet ${normalizedAddress} verified for ${username}`,
    }
  })

  .get('/api/agent/link', async ({ query: queryParams, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `agent-link-get:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.agentLink,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const validated = validateQuery(
      AgentLinkQuerySchema,
      queryParams,
      'agent link',
    )
    const walletAddress = validated.wallet
    const username = validated.username
    const agentId = validated.agentId

    if (!walletAddress && !username && !agentId) {
      set.status = 400
      return { error: 'wallet, username, or agentId parameter required' }
    }

    let links: Array<{
      id: number
      user_id: string
      wallet_address: string
      chain_id: string
      agent_id: number
      registry_address: string
      is_verified: number
      verified_at: string | null
    }>

    if (agentId) {
      links = await query(
        `SELECT * FROM agent_identity_links WHERE agent_id = ?`,
        [agentId.toString()],
      )
    } else if (walletAddress) {
      links = await query(
        `SELECT * FROM agent_identity_links WHERE wallet_address = ?`,
        [walletAddress.toLowerCase()],
      )
    } else {
      links = await query(
        `SELECT * FROM agent_identity_links WHERE user_id = ?`,
        [username ?? ''],
      )
    }

    const enrichedLinks = await Promise.all(
      links.map(async (link) => {
        const users = await query<{ username: string; avatar_url: string }>(
          'SELECT username, avatar_url FROM users WHERE username = ?',
          [link.user_id],
        )
        const user = users[0]
        return {
          id: link.id,
          username: link.user_id,
          walletAddress: link.wallet_address,
          chainId: link.chain_id,
          agentId: link.agent_id,
          registryAddress: link.registry_address,
          isVerified: Boolean(link.is_verified),
          verifiedAt: link.verified_at,
          user: user
            ? { username: user.username, avatarUrl: user.avatar_url }
            : null,
        }
      }),
    )

    return { links: enrichedLinks }
  })

  .post('/api/agent/link', async ({ body, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `agent-link-post:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.agentLink,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const authResult = await authenticateRequest(request)
    if (isAuthError(authResult)) {
      set.status = authResult.status
      return { error: authResult.error }
    }

    const validated = validateBody(
      CreateAgentLinkRequestSchema,
      body,
      'create agent link',
    )
    const { username, walletAddress, agentId, registryAddress, txHash } =
      validated
    const chainId = validated.chainId || LEADERBOARD_CONFIG.chain.caip2ChainId

    if (!verifyUserOwnership(authResult.user, username)) {
      set.status = 403
      return { error: 'You can only create agent links for your own account' }
    }

    const wallets = await query<{ is_verified: number }>(
      `SELECT is_verified FROM wallet_addresses
     WHERE user_id = ? AND account_address = ? AND is_active = 1`,
      [username, walletAddress.toLowerCase()],
    )

    if (wallets.length === 0) {
      set.status = 403
      return { error: 'Wallet not linked to this GitHub account' }
    }

    if (!wallets[0].is_verified) {
      set.status = 403
      return {
        error: 'Wallet must be verified before creating agent links',
        action: 'verify_wallet',
      }
    }

    const now = new Date().toISOString()
    const normalizedWallet = walletAddress.toLowerCase()
    const normalizedRegistry = registryAddress.toLowerCase()

    const existing = await query<{ id: number; user_id: string }>(
      `SELECT id, user_id FROM agent_identity_links
     WHERE wallet_address = ? AND chain_id = ? AND agent_id = ?`,
      [normalizedWallet, chainId, agentId],
    )

    if (existing.length > 0) {
      if (existing[0].user_id !== username) {
        set.status = 403
        return { error: 'This agent is already linked to a different user' }
      }

      await exec(
        `UPDATE agent_identity_links SET
        registry_address = ?, is_verified = ?, verified_at = ?, verification_tx_hash = ?, updated_at = ?
       WHERE id = ?`,
        [
          normalizedRegistry,
          wallets[0].is_verified,
          now,
          txHash || null,
          now,
          existing[0].id,
        ],
      )

      return {
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
      }
    }

    const result = await exec(
      `INSERT INTO agent_identity_links (
      user_id, wallet_address, chain_id, agent_id, registry_address,
      is_verified, verified_at, verification_tx_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        normalizedWallet,
        chainId,
        agentId,
        normalizedRegistry,
        wallets[0].is_verified,
        now,
        txHash || null,
        now,
        now,
      ],
    )

    set.status = 201
    return {
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
    }
  })

  .get('/api/leaderboard', async ({ query: queryParams, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `leaderboard:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.general,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const validated = validateQuery(
      LeaderboardQuerySchema,
      queryParams,
      'leaderboard',
    )
    const contributors = await getTopContributors(validated.limit)

    return { contributors, totalContributors: contributors.length }
  })

  .get('/api/profile/:username', async ({ params, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `profile:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.general,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const username = expect(params.username, UsernameSchema, 'username')

    const users = await query<{ username: string; avatar_url: string }>(
      'SELECT username, avatar_url FROM users WHERE username = ?',
      [username],
    )

    if (users.length === 0) {
      set.status = 404
      return { error: 'User not found' }
    }

    const user = users[0]
    const reputation = await calculateUserReputation(username)

    return {
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
    }
  })

  .post('/api/a2a', async ({ body, request, set }) => {
    const clientId = getClientId(request)
    const limit = checkRateLimit(
      `a2a:${clientId}`,
      LEADERBOARD_CONFIG.rateLimits.a2a,
    )
    if (!limit.allowed) {
      set.status = 429
      return { error: 'Rate limit exceeded' }
    }

    const validated = validateBody(A2ARequestSchema, body, 'A2A request')
    const message = validated.params.message
    const dataPart = message.parts.find((p) => p.kind === 'data')
    const skillId = dataPart?.data?.skillId
    const params = dataPart?.data || {}

    let result: { message: string; data: Record<string, unknown> }

    switch (skillId) {
      case 'get-leaderboard': {
        const contributors = await getTopContributors(
          Number(params.limit) || 10,
        )
        result = {
          message: `Top ${contributors.length} contributors on the Network leaderboard`,
          data: { contributors, totalContributors: contributors.length },
        }
        break
      }
      case 'get-contributor-profile': {
        const username =
          typeof params.username === 'string' ? params.username : undefined
        if (!username) {
          result = {
            message: 'Username required',
            data: { error: 'Missing username parameter' },
          }
          break
        }
        const users = await query<{ username: string; avatar_url: string }>(
          'SELECT username, avatar_url FROM users WHERE username = ?',
          [username],
        )
        if (users.length === 0) {
          result = {
            message: `User ${username} not found`,
            data: { error: 'User not found' },
          }
          break
        }
        const reputation = await calculateUserReputation(username)
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
        }
        break
      }
      default:
        result = {
          message: `Unknown skill: ${skillId}`,
          data: { error: 'Skill not found' },
        }
    }

    return {
      jsonrpc: '2.0',
      id: validated.id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: message.messageId,
        kind: 'message',
      },
    }
  })

  .post('/api/contributions/jeju-git', async ({ body, request, set }) => {
    const service = request.headers.get('x-jeju-service')
    if (!timingSafeCompare(service, 'dws-git')) {
      set.status = 401
      return { error: 'Invalid service header' }
    }

    const typedBody = body as {
      username?: string
      walletAddress?: Address
      source: string
      scores: { commits: number; prs: number; issues: number; reviews: number }
      contributions: Array<{
        type: string
        repoId: string
        timestamp: number
        metadata: Record<string, unknown>
      }>
      timestamp: number
    }

    if (!typedBody.source || typeof typedBody.source !== 'string') {
      set.status = 400
      return { error: 'source is required' }
    }
    if (!typedBody.scores || typeof typedBody.scores !== 'object') {
      set.status = 400
      return { error: 'scores is required' }
    }
    if (!Array.isArray(typedBody.contributions)) {
      set.status = 400
      return { error: 'contributions must be an array' }
    }
    if (typeof typedBody.timestamp !== 'number') {
      set.status = 400
      return { error: 'timestamp is required' }
    }

    let username = typedBody.username
    if (!username && typedBody.walletAddress) {
      const mapping = await query<{ username: string }>(
        'SELECT username FROM wallet_mappings WHERE wallet_address = ?',
        [typedBody.walletAddress.toLowerCase()],
      )
      if (mapping.length > 0) {
        username = mapping[0].username
      }
    }

    if (!username) {
      set.status = 400
      return { error: 'No username mapping found for wallet' }
    }

    const WEIGHTS = {
      commit: 5,
      pr_open: 50,
      pr_merge: 100,
      branch: 10,
      merge: 20,
      issue: 20,
      review: 30,
    }

    let totalScore = 0
    for (const contribution of typedBody.contributions) {
      const weight = WEIGHTS[contribution.type as keyof typeof WEIGHTS] || 5
      totalScore += weight
    }

    const date = new Date().toISOString().split('T')[0]
    const scoreId = `${username}_${date}_jeju-git`

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
        (typedBody.scores?.prs || 0) * 50,
        (typedBody.scores?.issues || 0) * 20,
        (typedBody.scores?.reviews || 0) * 30,
        (typedBody.scores?.commits || 0) * 5,
        JSON.stringify({
          contributions: typedBody.contributions.length,
          source: 'jeju-git',
        }),
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    )

    return { success: true, scoreAdded: totalScore }
  })

  .post('/api/contributions/jeju-npm', async ({ body, request, set }) => {
    const service = request.headers.get('x-jeju-service')
    if (!timingSafeCompare(service, 'dws-npm')) {
      set.status = 401
      return { error: 'Invalid service header' }
    }

    const typedBody = body as {
      walletAddress: Address
      source: string
      score: number
      contribution: {
        type: string
        packageId: string
        packageName: string
        timestamp: number
        metadata: Record<string, unknown>
      }
    }

    if (!typedBody.walletAddress || !isAddress(typedBody.walletAddress)) {
      set.status = 400
      return { error: 'Invalid walletAddress' }
    }
    if (!typedBody.source || typeof typedBody.source !== 'string') {
      set.status = 400
      return { error: 'source is required' }
    }
    if (typeof typedBody.score !== 'number') {
      set.status = 400
      return { error: 'score is required' }
    }
    if (!typedBody.contribution || typeof typedBody.contribution !== 'object') {
      set.status = 400
      return { error: 'contribution is required' }
    }

    const mapping = await query<{ username: string }>(
      'SELECT username FROM wallet_mappings WHERE wallet_address = ?',
      [typedBody.walletAddress.toLowerCase()],
    )

    let username = 'anonymous'
    if (mapping.length > 0) {
      username = mapping[0].username
    }

    const date = new Date().toISOString().split('T')[0]
    const scoreId = `${username}_${date}_jeju-npm`

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
        typedBody.score,
        JSON.stringify({
          packageName: typedBody.contribution.packageName,
          type: typedBody.contribution.type,
        }),
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    )

    return { success: true, scoreAdded: typedBody.score }
  })

  .post('/api/packages/downloads', async ({ body, request, set }) => {
    const service = request.headers.get('x-jeju-service')
    if (!timingSafeCompare(service, 'dws-npm')) {
      set.status = 401
      return { error: 'Invalid service header' }
    }

    const typedBody = body as {
      packageId: string
      packageName: string
      downloadCount: number
      timestamp: number
    }

    if (!typedBody.packageId || typeof typedBody.packageId !== 'string') {
      set.status = 400
      return { error: 'packageId is required' }
    }
    if (!typedBody.packageName || typeof typedBody.packageName !== 'string') {
      set.status = 400
      return { error: 'packageName is required' }
    }
    if (typeof typedBody.downloadCount !== 'number') {
      set.status = 400
      return { error: 'downloadCount is required' }
    }
    if (typeof typedBody.timestamp !== 'number') {
      set.status = 400
      return { error: 'timestamp is required' }
    }

    await exec(
      `INSERT INTO package_stats (package_id, package_name, download_count, last_updated)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(package_id) DO UPDATE SET
       download_count = download_count + excluded.download_count,
       last_updated = excluded.last_updated`,
      [
        typedBody.packageId,
        typedBody.packageName,
        typedBody.downloadCount,
        new Date().toISOString(),
      ],
    )

    return { success: true }
  })

  .get('/api/wallet-mappings', async () => {
    const mappings = await query<{ wallet_address: string; username: string }>(
      'SELECT wallet_address, username FROM wallet_mappings',
    )

    return {
      mappings: mappings.map((m) => ({
        walletAddress: m.wallet_address,
        username: m.username,
      })),
    }
  })

export type LeaderboardApp = typeof app

export { app as leaderboardApp }
export default app
