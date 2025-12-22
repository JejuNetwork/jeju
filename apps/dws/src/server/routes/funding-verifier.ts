/**
 * Funding Verifier Routes
 *
 * Handles OAuth3 verification callbacks for the ContributorRegistry:
 * - GitHub repository ownership verification
 * - Social link verification (GitHub, Discord, Twitter)
 * - Dependency maintainer verification
 *
 * This is the CRITICAL integration point between OAuth3 and funding.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import {
  GitHubUserSchema,
  verifyDependencyRequestSchema,
  verifyRepoRequestSchema,
  verifySocialRequestSchema,
} from '../../shared/schemas'
import { expectValid } from '../../shared/validation'

// Schemas for external API responses
const GitHubRepoPermissionsSchema = z.object({
  permissions: z
    .object({
      admin: z.boolean().optional(),
      push: z.boolean().optional(),
    })
    .optional(),
})

const NpmPackageSchema = z.object({
  maintainers: z
    .array(z.object({ name: z.string() }))
    .optional(),
})

// ============ ABI ============

const CONTRIBUTOR_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'verifySocialLink',
    inputs: [
      { name: 'contributorId', type: 'bytes32' },
      { name: 'platform', type: 'bytes32' },
      { name: 'proofHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyRepository',
    inputs: [
      { name: 'claimId', type: 'bytes32' },
      { name: 'proofHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyDependency',
    inputs: [
      { name: 'claimId', type: 'bytes32' },
      { name: 'proofHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getSocialLinks',
    inputs: [{ name: 'contributorId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'platform', type: 'bytes32' },
          { name: 'handle', type: 'string' },
          { name: 'proofHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'verifiedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRepositoryClaims',
    inputs: [{ name: 'contributorId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'claimId', type: 'bytes32' },
          { name: 'contributorId', type: 'bytes32' },
          { name: 'owner', type: 'string' },
          { name: 'repo', type: 'string' },
          { name: 'proofHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'claimedAt', type: 'uint256' },
          { name: 'verifiedAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

// Platform hashes matching Solidity
const PLATFORM_GITHUB = keccak256(Buffer.from('github'))
const PLATFORM_DISCORD = keccak256(Buffer.from('discord'))
const PLATFORM_TWITTER = keccak256(Buffer.from('twitter'))
const PLATFORM_FARCASTER = keccak256(Buffer.from('farcaster'))

// ============ Types ============

// Types now defined via Zod schemas in shared/schemas/funding.ts

// ============ GitHub Verification ============

async function verifyGitHubOwnership(
  token: string,
  expectedUsername: string,
  repoOwner?: string,
  repoName?: string,
): Promise<{ verified: boolean; proofHash: Hex; error?: string }> {
  // Verify the token belongs to the expected user
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!userResponse.ok) {
    return {
      verified: false,
      proofHash: '0x' as Hex,
      error: 'Invalid GitHub token',
    }
  }

  const userResult = GitHubUserSchema.safeParse(await userResponse.json())
  if (!userResult.success) {
    return {
      verified: false,
      proofHash: '0x' as Hex,
      error: 'Invalid GitHub API response',
    }
  }
  const user = userResult.data

  if (user.login.toLowerCase() !== expectedUsername.toLowerCase()) {
    return {
      verified: false,
      proofHash: '0x' as Hex,
      error: 'GitHub username mismatch',
    }
  }

  // If verifying repo ownership
  if (repoOwner && repoName) {
    const repoResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    )

    if (!repoResponse.ok) {
      return {
        verified: false,
        proofHash: '0x' as Hex,
        error: 'Repository not found',
      }
    }

    const repoResult = GitHubRepoPermissionsSchema.safeParse(
      await repoResponse.json(),
    )
    if (!repoResult.success) {
      return {
        verified: false,
        proofHash: '0x' as Hex,
        error: 'Invalid repository response',
      }
    }
    const repo = repoResult.data

    if (!repo.permissions?.admin && !repo.permissions?.push) {
      return {
        verified: false,
        proofHash: '0x' as Hex,
        error: 'No write access to repository',
      }
    }
  }

  // Generate proof hash
  const proofData = `github:${user.id}:${user.login}:${Date.now()}`
  const proofHash = keccak256(Buffer.from(proofData))

  return { verified: true, proofHash }
}

// ============ NPM Maintainer Verification ============

async function verifyNpmMaintainer(
  token: string,
  packageName: string,
  expectedUsername: string,
): Promise<{ verified: boolean; proofHash: Hex; error?: string }> {
  // Get package info
  const pkgResponse = await fetch(`https://registry.npmjs.org/${packageName}`)
  if (!pkgResponse.ok) {
    return {
      verified: false,
      proofHash: '0x' as Hex,
      error: 'Package not found',
    }
  }

  const pkgResult = NpmPackageSchema.safeParse(await pkgResponse.json())
  if (!pkgResult.success) {
    return {
      verified: false,
      proofHash: '0x' as Hex,
      error: 'Invalid package response',
    }
  }
  const pkg = pkgResult.data

  const isMaintainer = pkg.maintainers?.some(
    (m) => m.name.toLowerCase() === expectedUsername.toLowerCase(),
  )

  if (!isMaintainer) {
    return {
      verified: false,
      proofHash: '0x' as Hex,
      error: 'Not a package maintainer',
    }
  }

  // Verify via GitHub that they control the npm-linked GitHub
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!userResponse.ok) {
    return {
      verified: false,
      proofHash: '0x' as Hex,
      error: 'GitHub token invalid',
    }
  }

  const userResult = GitHubUserSchema.safeParse(await userResponse.json())
  if (!userResult.success) {
    return {
      verified: false,
      proofHash: '0x' as Hex,
      error: 'Invalid GitHub user response',
    }
  }
  const user = userResult.data

  const proofData = `npm:${packageName}:${user.login}:${Date.now()}`
  const proofHash = keccak256(Buffer.from(proofData))

  return { verified: true, proofHash }
}

// ============ Router ============

export function createFundingVerifierRouter(): Hono {
  const router = new Hono()

  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:6546'
  const verifierKey = process.env.VERIFIER_PRIVATE_KEY
  const contributorRegistryAddress = process.env
    .CONTRIBUTOR_REGISTRY_ADDRESS as Address

  if (!verifierKey) {
    console.warn(
      '[FundingVerifier] VERIFIER_PRIVATE_KEY not set - verification disabled',
    )
  }

  const _publicClient = createPublicClient({ transport: http(rpcUrl) })

  const getWalletClient = () => {
    if (!verifierKey) throw new Error('Verifier key not configured')
    const account = privateKeyToAccount(verifierKey as Hex)
    return createWalletClient({
      account,
      transport: http(rpcUrl),
    })
  }

  // ============ Social Link Verification ============

  router.post('/verify-social', async (c: Context) => {
    const body = expectValid(
      verifySocialRequestSchema,
      await c.req.json(),
      'Verify social request',
    )
    const { contributorId, platform, handle, oauthToken } = body

    if (!verifierKey) {
      return c.json({ error: 'Verification service not configured' }, 503)
    }

    let verified = false
    let proofHash: Hex = `0x${'0'.repeat(64)}` as Hex
    let error: string | undefined

    // Verify based on platform
    switch (platform) {
      case 'github': {
        const result = await verifyGitHubOwnership(oauthToken, handle)
        verified = result.verified
        proofHash = result.proofHash
        error = result.error
        break
      }
      // Add other platforms as needed
      default:
        return c.json({ error: `Unsupported platform: ${platform}` }, 400)
    }

    if (!verified) {
      return c.json({ verified: false, error })
    }

    // Call contract to verify
    const platformHash =
      platform === 'github'
        ? PLATFORM_GITHUB
        : platform === 'discord'
          ? PLATFORM_DISCORD
          : platform === 'twitter'
            ? PLATFORM_TWITTER
            : PLATFORM_FARCASTER

    const walletClient = getWalletClient()
    const hash = await walletClient.writeContract({
      address: contributorRegistryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'verifySocialLink',
      args: [contributorId as Hex, platformHash, proofHash],
    })

    return c.json({ verified: true, proofHash, txHash: hash })
  })

  // ============ Repository Verification ============

  router.post('/verify-repo', async (c: Context) => {
    const body = expectValid(
      verifyRepoRequestSchema,
      await c.req.json(),
      'Verify repository request',
    )
    const { claimId, owner, repo, oauthToken } = body

    if (!verifierKey) {
      return c.json({ error: 'Verification service not configured' }, 503)
    }

    // Get user from token
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        Accept: 'application/vnd.github+json',
      },
    })

    if (!userResponse.ok) {
      return c.json({ verified: false, error: 'Invalid GitHub token' })
    }

    const userResult = GitHubUserSchema.safeParse(await userResponse.json())
    if (!userResult.success) {
      return c.json({ verified: false, error: 'Invalid GitHub response' })
    }
    const user = userResult.data

    const result = await verifyGitHubOwnership(
      oauthToken,
      user.login,
      owner,
      repo,
    )

    if (!result.verified) {
      return c.json({ verified: false, error: result.error })
    }

    const walletClient = getWalletClient()
    const hash = await walletClient.writeContract({
      address: contributorRegistryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'verifyRepository',
      args: [claimId as Hex, result.proofHash],
    })

    return c.json({ verified: true, proofHash: result.proofHash, txHash: hash })
  })

  // ============ Dependency Verification ============

  router.post('/verify-dependency', async (c: Context) => {
    const body = expectValid(
      verifyDependencyRequestSchema,
      await c.req.json(),
      'Verify dependency request',
    )
    const { claimId, packageName, registryType, oauthToken } = body

    if (!verifierKey) {
      return c.json({ error: 'Verification service not configured' }, 503)
    }

    let verified = false
    let proofHash: Hex = `0x${'0'.repeat(64)}` as Hex
    let error: string | undefined

    // Get GitHub username from token
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        Accept: 'application/vnd.github+json',
      },
    })

    if (!userResponse.ok) {
      return c.json({ verified: false, error: 'Invalid GitHub token' })
    }

    const userResult = GitHubUserSchema.safeParse(await userResponse.json())
    if (!userResult.success) {
      return c.json({ verified: false, error: 'Invalid GitHub response' })
    }
    const user = userResult.data

    switch (registryType) {
      case 'npm': {
        const npmResult = await verifyNpmMaintainer(
          oauthToken,
          packageName,
          user.login,
        )
        verified = npmResult.verified
        proofHash = npmResult.proofHash
        error = npmResult.error
        break
      }
      // Add other registries (pypi, cargo, go) as needed
      default:
        return c.json({ error: `Unsupported registry: ${registryType}` }, 400)
    }

    if (!verified) {
      return c.json({ verified: false, error })
    }

    const walletClient = getWalletClient()
    const hash = await walletClient.writeContract({
      address: contributorRegistryAddress,
      abi: CONTRIBUTOR_REGISTRY_ABI,
      functionName: 'verifyDependency',
      args: [claimId as Hex, proofHash],
    })

    return c.json({ verified: true, proofHash, txHash: hash })
  })

  // ============ OAuth Callback (for GitHub) ============

  router.get('/oauth/github/callback', async (c: Context) => {
    const code = c.req.query('code')
    const state = c.req.query('state') // Contains contributorId and platform

    if (!code) {
      return c.json({ error: 'No authorization code' }, 400)
    }

    // Exchange code for token
    const clientId = process.env.GITHUB_CLIENT_ID
    const clientSecret = process.env.GITHUB_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return c.json({ error: 'GitHub OAuth not configured' }, 503)
    }

    const tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      },
    )

    const TokenResponseSchema = z.object({
      access_token: z.string().optional(),
      error: z.string().optional(),
    })
    const tokenResult = TokenResponseSchema.safeParse(await tokenResponse.json())
    if (!tokenResult.success) {
      return c.json({ error: 'Invalid token response' }, 400)
    }
    const tokenData = tokenResult.data

    if (!tokenData.access_token) {
      return c.json({ error: tokenData.error || 'Token exchange failed' }, 400)
    }

    // Parse state
    let parsedState: {
      contributorId: string
      platform: string
      type: string
    } | null = null
    try {
      parsedState = JSON.parse(Buffer.from(state || '', 'base64').toString())
    } catch {
      return c.json({ error: 'Invalid state' }, 400)
    }

    // Redirect back to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const redirectUrl = new URL(`${frontendUrl}/funding/verify-complete`)
    redirectUrl.searchParams.set('token', tokenData.access_token)
    redirectUrl.searchParams.set(
      'contributorId',
      parsedState?.contributorId || '',
    )
    redirectUrl.searchParams.set('platform', parsedState?.platform || '')
    redirectUrl.searchParams.set('type', parsedState?.type || 'social')

    return c.redirect(redirectUrl.toString())
  })

  // ============ Health Check ============

  router.get('/health', (c: Context) => {
    return c.json({
      status: verifierKey ? 'ok' : 'degraded',
      verifierConfigured: !!verifierKey,
      registryAddress: contributorRegistryAddress,
    })
  })

  return router
}
