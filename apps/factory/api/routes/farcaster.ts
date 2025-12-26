/**
 * Farcaster Routes
 *
 * Signer management and Farcaster account linking endpoints.
 * Handles the onboarding flow for connecting Farcaster to Factory.
 */

import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { deleteFidLink, getFidLink } from '../db/client'
import * as farcasterService from '../services/farcaster'
import * as signerService from '../services/signer'

const LinkFidBodySchema = t.Object({
  fid: t.Number({ minimum: 1 }),
})

const CreateSignerBodySchema = t.Object({
  fid: t.Number({ minimum: 1 }),
})

const ActivateSignerBodySchema = t.Object({
  signerPublicKey: t.String({ minLength: 66, maxLength: 66 }),
  signature: t.String({ minLength: 130 }),
})

export const farcasterRoutes = new Elysia({ prefix: '/api/farcaster' })
  // Get current Farcaster connection status
  .get(
    '/status',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const link = getFidLink(address)
      const signerStatus = signerService.getSignerStatus(address)

      return {
        connected: link !== null && signerStatus.isActive,
        fid: link?.fid ?? null,
        username: link?.username ?? null,
        displayName: link?.display_name ?? null,
        pfpUrl: link?.pfp_url ?? null,
        signer: {
          hasSigner: signerStatus.hasSigner,
          isActive: signerStatus.isActive,
          publicKey: signerStatus.publicKey,
        },
      }
    },
    {
      detail: {
        tags: ['farcaster'],
        summary: 'Get connection status',
        description: 'Get current Farcaster connection status for the user',
      },
    },
  )
  // Get user profile by FID
  .get(
    '/user/:fid',
    async ({ params }) => {
      const fid = parseInt(params.fid, 10)
      const user = await farcasterService.getUser(fid)

      if (!user) {
        return { error: { code: 'NOT_FOUND', message: 'User not found' } }
      }

      return { user }
    },
    {
      detail: {
        tags: ['farcaster'],
        summary: 'Get user by FID',
        description: 'Get Farcaster user profile by FID',
      },
    },
  )
  // Get user profile by username
  .get(
    '/user/by-username/:username',
    async ({ params }) => {
      const user = await farcasterService.getUserByUsername(params.username)

      if (!user) {
        return { error: { code: 'NOT_FOUND', message: 'User not found' } }
      }

      return { user }
    },
    {
      detail: {
        tags: ['farcaster'],
        summary: 'Get user by username',
        description: 'Get Farcaster user profile by username',
      },
    },
  )
  // Lookup FID by address
  .get(
    '/lookup/:address',
    async ({ params }) => {
      const address = params.address as Address
      const user = await farcasterService.getUserByAddress(address)

      if (!user) {
        return {
          found: false,
          fid: null,
          user: null,
        }
      }

      return {
        found: true,
        fid: user.fid,
        user: {
          fid: user.fid,
          username: user.username,
          displayName: user.displayName,
          pfpUrl: user.pfpUrl,
          bio: user.bio,
        },
      }
    },
    {
      detail: {
        tags: ['farcaster'],
        summary: 'Lookup by address',
        description: 'Lookup Farcaster user by verified Ethereum address',
      },
    },
  )
  // Link wallet to FID
  .post(
    '/link',
    async ({ body, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      // Check if already linked
      const existingLink = getFidLink(address)
      if (existingLink) {
        return {
          success: true,
          alreadyLinked: true,
          link: {
            fid: existingLink.fid,
            username: existingLink.username,
            displayName: existingLink.display_name,
            pfpUrl: existingLink.pfp_url,
          },
        }
      }

      // Verify and create link
      const link = await farcasterService.linkAddressToFid(address, body.fid)

      return {
        success: true,
        alreadyLinked: false,
        link: {
          fid: link.fid,
          username: link.username,
          displayName: link.display_name,
          pfpUrl: link.pfp_url,
        },
      }
    },
    {
      body: LinkFidBodySchema,
      detail: {
        tags: ['farcaster'],
        summary: 'Link wallet to FID',
        description: 'Link your wallet address to your Farcaster FID',
      },
    },
  )
  // Unlink wallet from FID
  .delete(
    '/link',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const deleted = deleteFidLink(address)

      return { success: deleted }
    },
    {
      detail: {
        tags: ['farcaster'],
        summary: 'Unlink wallet',
        description: 'Unlink your wallet from Farcaster',
      },
    },
  )
  // Create a new signer
  .post(
    '/signer',
    async ({ body, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      // Check if already has active signer
      const existingSigner = signerService.getActiveSigner(address)
      if (existingSigner?.key_state === 'active') {
        return {
          success: true,
          alreadyActive: true,
          signer: {
            publicKey: existingSigner.signer_public_key,
            fid: existingSigner.fid,
            state: existingSigner.key_state,
          },
        }
      }

      // Create new signer
      const signer = await signerService.createSigner(address, body.fid)

      // Generate registration message for signing
      const deadline = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      const registrationMessage = signerService.getSignerRegistrationMessage(
        body.fid,
        signer.signer_public_key as Hex,
        deadline,
      )

      return {
        success: true,
        alreadyActive: false,
        signer: {
          id: signer.id,
          publicKey: signer.signer_public_key,
          fid: signer.fid,
          state: signer.key_state,
        },
        registration: {
          message: registrationMessage,
          deadline,
        },
      }
    },
    {
      body: CreateSignerBodySchema,
      detail: {
        tags: ['farcaster'],
        summary: 'Create signer',
        description: 'Create a new Ed25519 signer for Farcaster posting',
      },
    },
  )
  // Get signer status
  .get(
    '/signer',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const status = signerService.getSignerStatus(address)
      const signers = signerService.getUserSigners(address)

      return {
        status,
        signers: signers.map((s) => ({
          id: s.id,
          publicKey: s.signer_public_key,
          fid: s.fid,
          state: s.key_state,
          createdAt: s.created_at,
        })),
      }
    },
    {
      detail: {
        tags: ['farcaster'],
        summary: 'Get signer status',
        description: 'Get signer status and list of signers',
      },
    },
  )
  // Activate signer (after on-chain registration)
  .post(
    '/signer/activate',
    async ({ body, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const success = await signerService.verifyAndActivateSigner(
        body.signerPublicKey as Hex,
        body.signature as Hex,
      )

      if (!success) {
        set.status = 400
        return {
          error: {
            code: 'ACTIVATION_FAILED',
            message:
              'Failed to activate signer. Ensure it matches a pending signer.',
          },
        }
      }

      return { success: true }
    },
    {
      body: ActivateSignerBodySchema,
      detail: {
        tags: ['farcaster'],
        summary: 'Activate signer',
        description: 'Activate a signer after on-chain registration',
      },
    },
  )
  // Revoke a signer
  .delete(
    '/signer/:signerId',
    async ({ params, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      // Verify the signer belongs to this user
      const signers = signerService.getUserSigners(address)
      const signer = signers.find((s) => s.id === params.signerId)

      if (!signer) {
        set.status = 404
        return {
          error: { code: 'NOT_FOUND', message: 'Signer not found' },
        }
      }

      const success = signerService.revokeSigner(params.signerId)

      return { success }
    },
    {
      detail: {
        tags: ['farcaster'],
        summary: 'Revoke signer',
        description: 'Revoke a signer key',
      },
    },
  )
  // Full onboarding status (combines link + signer)
  .get(
    '/onboarding',
    async ({ headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      const link = getFidLink(address)
      const signerStatus = signerService.getSignerStatus(address)

      // Step 1: Link address to FID
      const step1Complete = link !== null

      // Step 2: Create signer
      const step2Complete = signerStatus.hasSigner

      // Step 3: Activate signer
      const step3Complete = signerStatus.isActive

      return {
        completed: step1Complete && step2Complete && step3Complete,
        steps: {
          linkFid: {
            complete: step1Complete,
            data: link
              ? {
                  fid: link.fid,
                  username: link.username,
                  displayName: link.display_name,
                }
              : null,
          },
          createSigner: {
            complete: step2Complete,
            data: signerStatus.publicKey
              ? { publicKey: signerStatus.publicKey }
              : null,
          },
          activateSigner: {
            complete: step3Complete,
          },
        },
        user: link
          ? {
              fid: link.fid,
              username: link.username,
              displayName: link.display_name,
              pfpUrl: link.pfp_url,
            }
          : null,
      }
    },
    {
      detail: {
        tags: ['farcaster'],
        summary: 'Get onboarding status',
        description: 'Get Farcaster onboarding progress',
      },
    },
  )
  // Quick connect flow (for users with existing FID)
  .post(
    '/connect',
    async ({ body, headers, set }) => {
      const address = headers['x-wallet-address'] as Address | undefined
      if (!address) {
        set.status = 401
        return {
          error: { code: 'UNAUTHORIZED', message: 'Wallet address required' },
        }
      }

      // Step 1: Link FID
      let link = getFidLink(address)
      if (!link) {
        link = await farcasterService.linkAddressToFid(address, body.fid)
      }

      // Step 2: Create signer if needed
      let signer = signerService.getActiveSigner(address)
      let registrationRequired = false
      let registrationMessage: string | null = null
      let deadline: number | null = null

      if (!signer || signer.key_state !== 'active') {
        signer = await signerService.createSigner(address, body.fid)
        registrationRequired = true
        deadline = Math.floor(Date.now() / 1000) + 3600
        registrationMessage = signerService.getSignerRegistrationMessage(
          body.fid,
          signer.signer_public_key as Hex,
          deadline,
        )
      }

      return {
        success: true,
        user: {
          fid: link.fid,
          username: link.username,
          displayName: link.display_name,
          pfpUrl: link.pfp_url,
        },
        signer: {
          publicKey: signer.signer_public_key,
          state: signer.key_state,
        },
        registrationRequired,
        registration: registrationRequired
          ? {
              message: registrationMessage,
              deadline,
              signerPublicKey: signer.signer_public_key,
            }
          : null,
      }
    },
    {
      body: LinkFidBodySchema,
      detail: {
        tags: ['farcaster'],
        summary: 'Quick connect',
        description:
          'Quick connect flow - link FID and create signer in one call',
      },
    },
  )
