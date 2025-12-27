/**
 * Farcaster DWS Worker
 *
 * Decentralized Farcaster signer service running on DWS.
 * Uses MPC infrastructure for key management - signers are threshold keys.
 *
 * Features:
 * - Create Farcaster signers (MPC-backed, not stored locally)
 * - Sign casts with threshold signatures
 * - Signer registration and management
 * - Hub interaction for posting
 *
 * Security:
 * - Private keys never exist in full form
 * - Threshold of MPC parties required to sign
 * - Signer keys stored as shares across TEE nodes
 */

import { createMPCClient } from '@jejunetwork/kms'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex, verifyMessage } from 'viem'
import { z } from 'zod'

// Request body schemas
const CreateSignerBodySchema = z.object({
  fid: z.number(),
  appName: z.string(),
  appFid: z.number().optional(),
})

// Hub response schemas
const FidResponseSchema = z.object({ fid: z.number().optional() })

const SignMessageBodySchema = z.object({
  message: z.string(),
})

const CastBodySchema = z.object({
  signerId: z.string(),
  text: z.string(),
  parentUrl: z.string().optional(),
  parentFid: z.number().optional(),
  parentHash: z.string().optional(),
  embeds: z.array(z.object({ url: z.string() })).optional(),
  mentions: z.array(z.number()).optional(),
  mentionsPositions: z.array(z.number()).optional(),
})

const ReactBodySchema = z.object({
  signerId: z.string(),
  targetFid: z.number(),
  targetHash: z.string(),
  reactionType: z.enum(['like', 'recast']),
})

// ============ Types ============

export interface FarcasterWorkerConfig {
  serviceAgentId: string
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  rpcUrl: string
  hubUrl?: string
  network?: 'mainnet' | 'testnet'
}

interface ManagedSigner {
  signerId: string
  fid: number
  keyId: string // MPC key ID
  publicKey: Hex
  groupAddress: Address
  appName: string
  appFid?: number
  status: 'pending' | 'active' | 'revoked'
  createdAt: number
  approvedAt?: number
  revokedAt?: number
}

// ============ Farcaster Worker ============

export function createFarcasterWorker(config: FarcasterWorkerConfig) {
  const mpcClient = createMPCClient(
    {
      rpcUrl: config.rpcUrl,
      mpcRegistryAddress: config.mpcRegistryAddress,
      identityRegistryAddress: config.identityRegistryAddress,
    },
    config.serviceAgentId,
  )

  const hubUrl = config.hubUrl ?? 'https://nemes.farcaster.xyz:2281'

  // Signer storage
  const signers = new Map<string, ManagedSigner>()
  const fidSigners = new Map<number, string[]>() // fid => signerIds

  // ============ Helpers ============

  async function createMPCSigner(
    fid: number,
    appName: string,
  ): Promise<ManagedSigner> {
    const signerId = crypto.randomUUID()
    const keyId = `farcaster:${fid}:${signerId}`

    // Generate MPC key for this signer
    const { groupPublicKey, groupAddress } = await mpcClient.requestKeyGen({
      keyId,
    })

    const signer: ManagedSigner = {
      signerId,
      fid,
      keyId,
      publicKey: groupPublicKey,
      groupAddress,
      appName,
      status: 'pending',
      createdAt: Date.now(),
    }

    signers.set(signerId, signer)

    // Track by FID
    const existing = fidSigners.get(fid) ?? []
    existing.push(signerId)
    fidSigners.set(fid, existing)

    return signer
  }

  async function signMessage(
    signerId: string,
    message: Uint8Array,
  ): Promise<Uint8Array> {
    const signer = signers.get(signerId)
    if (!signer) {
      throw new Error('Signer not found')
    }

    if (signer.status !== 'active') {
      throw new Error('Signer not active')
    }

    const messageHash = keccak256(message)
    const result = await mpcClient.requestSignature({
      keyId: signer.keyId,
      messageHash,
    })

    // Convert signature to bytes
    return toBytes(result.signature)
  }

  function generateApprovalLink(publicKey: Hex): string {
    // Generate Warpcast deep link for signer approval
    const encodedKey = encodeURIComponent(publicKey)
    return `https://warpcast.com/~/add-signer?publicKey=${encodedKey}`
  }

  // ============ Router ============

  return (
    new Elysia({ name: 'farcaster-worker', prefix: '/farcaster' })
      .get('/health', () => ({
        status: 'healthy',
        service: 'farcaster-signer',
        signerCount: signers.size,
        hubUrl,
        network: config.network ?? 'mainnet',
        mpcEnabled: true,
      }))

      // ============ Signer Management ============

      .post('/signers', async ({ body }) => {
        const params = CreateSignerBodySchema.parse(body)

        const signer = await createMPCSigner(params.fid, params.appName)

        if (params.appFid) {
          signer.appFid = params.appFid
        }

        const approvalLink = generateApprovalLink(signer.publicKey)

        return {
          signerId: signer.signerId,
          publicKey: signer.publicKey,
          groupAddress: signer.groupAddress,
          approvalLink,
          status: signer.status,
          createdAt: signer.createdAt,
        }
      })

      .get(
        '/signers',
        ({ query }) => {
          let signerList = Array.from(signers.values())
          if (query.fid) {
            signerList = signerList.filter((s) => s.fid === query.fid)
          }

          return {
            signers: signerList.map((s) => ({
              signerId: s.signerId,
              fid: s.fid,
              publicKey: s.publicKey,
              appName: s.appName,
              status: s.status,
              createdAt: s.createdAt,
              approvedAt: s.approvedAt,
            })),
          }
        },
        {
          query: t.Object({
            fid: t.Optional(t.Number()),
          }),
        },
      )

      .get('/signers/:signerId', ({ params }) => {
        const signer = signers.get(params.signerId)
        if (!signer) {
          throw new Error('Signer not found')
        }

        return {
          signerId: signer.signerId,
          fid: signer.fid,
          publicKey: signer.publicKey,
          groupAddress: signer.groupAddress,
          appName: signer.appName,
          appFid: signer.appFid,
          status: signer.status,
          createdAt: signer.createdAt,
          approvedAt: signer.approvedAt,
        }
      })

      .post('/signers/:signerId/approve', async ({ params, request, set }) => {
        const signer = signers.get(params.signerId)
        if (!signer) {
          set.status = 404
          return { error: 'Signer not found' }
        }

        // Authenticate: only the MPC group address can approve
        const signature = request.headers.get('x-jeju-signature') as Hex | null
        const timestamp = request.headers.get('x-jeju-timestamp')

        if (!signature || !timestamp) {
          set.status = 401
          return { error: 'Missing authentication headers' }
        }

        const ts = parseInt(timestamp, 10)
        const now = Date.now()
        if (Number.isNaN(ts) || ts < now - 5 * 60 * 1000 || ts > now + 30 * 1000) {
          set.status = 401
          return { error: 'Invalid or expired timestamp' }
        }

        const isValid = await verifyMessage({
          address: signer.groupAddress,
          message: `Approve signer:${params.signerId}:${timestamp}`,
          signature,
        })

        if (!isValid) {
          set.status = 401
          return { error: 'Invalid signature' }
        }

        signer.status = 'active'
        signer.approvedAt = Date.now()

        return {
          signerId: signer.signerId,
          status: signer.status,
          approvedAt: signer.approvedAt,
        }
      })

      .post('/signers/:signerId/revoke', async ({ params, request, set }) => {
        const signer = signers.get(params.signerId)
        if (!signer) {
          set.status = 404
          return { error: 'Signer not found' }
        }

        // Authenticate: only the MPC group address can revoke
        const signature = request.headers.get('x-jeju-signature') as Hex | null
        const timestamp = request.headers.get('x-jeju-timestamp')

        if (!signature || !timestamp) {
          set.status = 401
          return { error: 'Missing authentication headers' }
        }

        const ts = parseInt(timestamp, 10)
        const now = Date.now()
        if (Number.isNaN(ts) || ts < now - 5 * 60 * 1000 || ts > now + 30 * 1000) {
          set.status = 401
          return { error: 'Invalid or expired timestamp' }
        }

        const isValid = await verifyMessage({
          address: signer.groupAddress,
          message: `Revoke signer:${params.signerId}:${timestamp}`,
          signature,
        })

        if (!isValid) {
          set.status = 401
          return { error: 'Invalid signature' }
        }

        signer.status = 'revoked'
        signer.revokedAt = Date.now()

        return {
          signerId: signer.signerId,
          status: signer.status,
          revokedAt: signer.revokedAt,
        }
      })

      // ============ Signing ============

      .post('/signers/:signerId/sign', async ({ params, body }) => {
        const signer = signers.get(params.signerId)
        if (!signer) {
          throw new Error('Signer not found')
        }

        const { message } = SignMessageBodySchema.parse(body)
        const messageBytes = toBytes(message as Hex)

        const signature = await signMessage(params.signerId, messageBytes)

        return {
          signature: toHex(signature),
          signerId: signer.signerId,
          signedAt: Date.now(),
        }
      })

      // ============ Casting ============

      .post('/cast', async ({ body }) => {
        const params = CastBodySchema.parse(body)

        const signer = signers.get(params.signerId)
        if (!signer) {
          throw new Error('Signer not found')
        }

        if (signer.status !== 'active') {
          throw new Error('Signer not active')
        }

        // Build cast message
        const castAddBody = {
          text: params.text,
          embeds: params.embeds ?? [],
          embedsDeprecated: [],
          mentions: params.mentions ?? [],
          mentionsPositions: params.mentionsPositions ?? [],
          parentCastId: params.parentHash
            ? { fid: params.parentFid, hash: params.parentHash }
            : undefined,
          parentUrl: params.parentUrl,
        }

        // Create message data
        const messageData = {
          type: 1, // MESSAGE_TYPE_CAST_ADD
          fid: signer.fid,
          timestamp: Math.floor(Date.now() / 1000) - 1609459200, // Farcaster epoch
          network: config.network === 'testnet' ? 2 : 1,
          castAddBody,
        }

        // Hash and sign
        const messageBytes = toBytes(JSON.stringify(messageData))
        const messageHash = keccak256(messageBytes)
        const signatureResult = await mpcClient.requestSignature({
          keyId: signer.keyId,
          messageHash,
        })

        // Submit to hub
        let hubSuccess = false
        let hubError: string | undefined
        try {
          const hubResponse = await fetch(`${hubUrl}/v1/submitMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: messageData,
              hash: messageHash,
              hashScheme: 1, // HASH_SCHEME_BLAKE3
              signature: signatureResult.signature,
              signatureScheme: 1, // SIGNATURE_SCHEME_ED25519 (need to adapt for secp256k1)
              signer: signer.publicKey,
            }),
          })
          hubSuccess = hubResponse.ok
          if (!hubResponse.ok) {
            hubError = `Hub returned ${hubResponse.status}: ${hubResponse.statusText}`
          }
        } catch (error) {
          hubError =
            error instanceof Error ? error.message : 'Hub request failed'
        }

        return {
          success: hubSuccess,
          error: hubError,
          hash: messageHash,
          signerId: signer.signerId,
          fid: signer.fid,
          timestamp: messageData.timestamp,
        }
      })

      // ============ Reactions ============

      .post('/react', async ({ body }) => {
        const params = ReactBodySchema.parse(body)

        const signer = signers.get(params.signerId)
        if (!signer) {
          throw new Error('Signer not found')
        }

        if (signer.status !== 'active') {
          throw new Error('Signer not active')
        }

        const reactionBody = {
          type: params.reactionType === 'like' ? 1 : 2,
          targetCastId: {
            fid: params.targetFid,
            hash: params.targetHash,
          },
        }

        const messageData = {
          type: 3, // MESSAGE_TYPE_REACTION_ADD
          fid: signer.fid,
          timestamp: Math.floor(Date.now() / 1000) - 1609459200,
          network: config.network === 'testnet' ? 2 : 1,
          reactionBody,
        }

        const messageBytes = toBytes(JSON.stringify(messageData))
        const messageHash = keccak256(messageBytes)
        const signatureResult = await mpcClient.requestSignature({
          keyId: signer.keyId,
          messageHash,
        })

        return {
          success: true,
          hash: messageHash,
          signature: signatureResult.signature,
          reactionType: params.reactionType,
        }
      })

      // ============ FID Lookup ============

      .get('/fid/:address', async ({ params: { address } }) => {
        // Look up FID for an address via hub
        try {
          const response = await fetch(
            `${hubUrl}/v1/custodyAddressByFid?address=${address}`,
          )

          if (!response.ok) {
            return { fid: null, error: `Hub returned ${response.status}` }
          }

          const parsed = FidResponseSchema.safeParse(await response.json())
          if (!parsed.success || typeof parsed.data.fid !== 'number') {
            return { fid: null }
          }
          return { fid: parsed.data.fid }
        } catch (error) {
          return {
            fid: null,
            error:
              error instanceof Error ? error.message : 'Hub request failed',
          }
        }
      })
  )
}

export type FarcasterWorker = ReturnType<typeof createFarcasterWorker>
