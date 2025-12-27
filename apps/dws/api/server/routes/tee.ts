import { Elysia, t } from 'elysia'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  AttestationVerifierService,
  generateNonce,
  generateReportData,
} from '../../../src/tee'

// Get contract address from config
const TDX_VERIFIER_ADDRESS = (process.env.TDX_ATTESTATION_VERIFIER_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545'
const VERIFIER_PRIVATE_KEY = process.env.TEE_VERIFIER_PRIVATE_KEY as
  | `0x${string}`
  | undefined
const DSTACK_ENDPOINT =
  process.env.DSTACK_ATTESTATION_ENDPOINT || 'http://localhost:8090'

// DStack client adapter - uses DStack integration from vendor/babylon
// In production, this connects to the dstack attestation service
function createDstackClientAdapter() {
  const endpoint =
    process.env.DSTACK_ATTESTATION_ENDPOINT || 'http://localhost:8090'

  return {
    async verifyAttestation(params: {
      quote: string
      mode: string
    }): Promise<{ valid: boolean; tcbValid?: boolean; reason?: string }> {
      // SECURITY: Only skip verification in non-production with explicit flag
      const isProduction = process.env.NODE_ENV === 'production'
      if (process.env.DSTACK_SKIP_VERIFICATION === 'true') {
        if (isProduction) {
          console.error(
            '[TEE] CRITICAL: DSTACK_SKIP_VERIFICATION cannot be used in production',
          )
          return {
            valid: false,
            reason: 'Verification bypass not allowed in production',
          }
        }
        console.warn(
          '[TEE] WARNING: Skipping dstack verification (dev mode only)',
        )
        return { valid: true, tcbValid: true }
      }

      // Call dstack attestation verification endpoint
      const response = await fetch(`${endpoint}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote: params.quote,
          attestationType: params.mode,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        return { valid: false, reason: `Verification failed: ${error}` }
      }

      const result = (await response.json()) as {
        valid: boolean
        tcbValid?: boolean
      }
      return {
        valid: result.valid,
        tcbValid: result.tcbValid ?? true,
      }
    },
  }
}

// Initialize clients
const publicClient = createPublicClient({
  transport: http(RPC_URL),
})

let verifierService: AttestationVerifierService | null = null

async function getVerifierService(): Promise<AttestationVerifierService> {
  if (!verifierService) {
    if (!VERIFIER_PRIVATE_KEY) {
      throw new Error('TEE_VERIFIER_PRIVATE_KEY not configured')
    }

    const account = privateKeyToAccount(VERIFIER_PRIVATE_KEY)
    const walletClient = createWalletClient({
      account,
      transport: http(RPC_URL),
    })

    verifierService = new AttestationVerifierService({
      contractAddress: TDX_VERIFIER_ADDRESS,
      publicClient,
      walletClient,
      dstackClient: createDstackClientAdapter(),
      cacheResults: true,
    })

    await verifierService.initialize()
  }
  return verifierService
}

// Active nonces (in production, use a proper store)
const activeNonces: Map<
  string,
  {
    nonce: `0x${string}`
    nodeAddress: Address
    timestamp: number
    expiresAt: number
  }
> = new Map()

export function createTEERouter() {
  return (
    new Elysia({ prefix: '/tee' })
      // =========================================================================
      // Attestation Challenge/Response Flow
      // =========================================================================

      /**
       * Step 1: Node requests a challenge
       * Returns a nonce that must be included in the attestation quote's REPORT_DATA
       */
      .post(
        '/attestation/challenge',
        async ({ body }) => {
          const { nodeAddress } = body as { nodeAddress: Address }

          const nonce = generateNonce()
          const timestamp = Date.now()
          const expiresAt = timestamp + 5 * 60 * 1000 // 5 minutes

          // Calculate expected report data
          const expectedReportData = generateReportData({
            nodeAddress,
            nonce,
            timestamp: Math.floor(timestamp / 1000),
          })

          const challengeId = `${nodeAddress}-${timestamp}`
          activeNonces.set(challengeId, {
            nonce,
            nodeAddress,
            timestamp,
            expiresAt,
          })

          // Clean up expired nonces
          const now = Date.now()
          for (const [key, value] of activeNonces.entries()) {
            if (value.expiresAt < now) {
              activeNonces.delete(key)
            }
          }

          return {
            challengeId,
            nonce,
            expectedReportData,
            timestamp,
            expiresAt,
          }
        },
        {
          body: t.Object({
            nodeAddress: t.String(),
          }),
        },
      )

      /**
       * Step 2: Node submits attestation quote
       * Verifies the quote and optionally submits result on-chain
       */
      .post(
        '/attestation/verify',
        async ({ body }) => {
          const {
            challengeId,
            quote,
            submitOnChain = false,
          } = body as {
            challengeId: string
            quote: string // hex-encoded quote
            submitOnChain?: boolean
          }

          // Validate challenge
          const challenge = activeNonces.get(challengeId)
          if (!challenge) {
            throw new Error('Invalid or expired challenge')
          }

          if (Date.now() > challenge.expiresAt) {
            activeNonces.delete(challengeId)
            throw new Error('Challenge expired')
          }

          // Parse quote from hex
          const quoteBytes = hexToBytes(quote)

          // Calculate expected report data
          const expectedReportData = generateReportData({
            nodeAddress: challenge.nodeAddress,
            nonce: challenge.nonce,
            timestamp: Math.floor(challenge.timestamp / 1000),
          })

          const service = await getVerifierService()

          if (submitOnChain) {
            // Verify and submit on-chain
            const { result, txHash } = await service.verifyAndSubmit({
              quote: quoteBytes,
              expectedReportData,
              nodeAddress: challenge.nodeAddress,
              requestId: challengeId,
            })

            // Clean up used challenge
            activeNonces.delete(challengeId)

            return {
              valid: result.isValid,
              quoteHash: result.quoteHash,
              mrEnclave: result.mrEnclave,
              mrSigner: result.mrSigner,
              reportData: result.reportData,
              verificationDetails: result.verificationDetails,
              onChain: {
                submitted: true,
                txHash,
              },
            }
          } else {
            // Verify only (no on-chain submission)
            const result = await service.verifyQuote({
              quote: quoteBytes,
              expectedReportData,
              nodeAddress: challenge.nodeAddress,
              requestId: challengeId,
            })

            // Clean up used challenge
            activeNonces.delete(challengeId)

            return {
              valid: result.isValid,
              quoteHash: result.quoteHash,
              mrEnclave: result.mrEnclave,
              mrSigner: result.mrSigner,
              reportData: result.reportData,
              verificationDetails: result.verificationDetails,
              onChain: {
                submitted: false,
              },
            }
          }
        },
        {
          body: t.Object({
            challengeId: t.String(),
            quote: t.String(),
            submitOnChain: t.Optional(t.Boolean()),
          }),
        },
      )

      // =========================================================================
      // Direct Verification (for testing/debugging)
      // =========================================================================
      .post(
        '/attestation/verify-direct',
        async ({ body }) => {
          const { quote, expectedReportData, nodeAddress } = body as {
            quote: string
            expectedReportData: `0x${string}`
            nodeAddress: Address
          }

          const quoteBytes = hexToBytes(quote)
          const service = await getVerifierService()

          const result = await service.verifyQuote({
            quote: quoteBytes,
            expectedReportData,
            nodeAddress,
            requestId: `direct-${Date.now()}`,
          })

          return {
            valid: result.isValid,
            quoteHash: result.quoteHash,
            mrEnclave: result.mrEnclave,
            mrSigner: result.mrSigner,
            reportData: result.reportData,
            verificationDetails: result.verificationDetails,
          }
        },
        {
          body: t.Object({
            quote: t.String(),
            expectedReportData: t.String(),
            nodeAddress: t.String(),
          }),
        },
      )

      // =========================================================================
      // Trusted Measurements Management
      // =========================================================================
      .get(
        '/measurements/enclave/:hash',
        async ({ params }) => {
          const service = await getVerifierService()
          const trusted = await service.isMrEnclaveTrusted(
            params.hash as `0x${string}`,
          )
          return { hash: params.hash, type: 'enclave', trusted }
        },
        {
          params: t.Object({
            hash: t.String(),
          }),
        },
      )

      .get(
        '/measurements/signer/:hash',
        async ({ params }) => {
          const service = await getVerifierService()
          const trusted = await service.isMrSignerTrusted(
            params.hash as `0x${string}`,
          )
          return { hash: params.hash, type: 'signer', trusted }
        },
        {
          params: t.Object({
            hash: t.String(),
          }),
        },
      )

      .post(
        '/measurements/enclave',
        async ({ body }) => {
          const { hash } = body as { hash: `0x${string}` }
          const service = await getVerifierService()
          const txHash = await service.addTrustedMrEnclave(hash)
          return { hash, type: 'enclave', action: 'added', txHash }
        },
        {
          body: t.Object({
            hash: t.String(),
          }),
        },
      )

      .post(
        '/measurements/signer',
        async ({ body }) => {
          const { hash } = body as { hash: `0x${string}` }
          const service = await getVerifierService()
          const txHash = await service.addTrustedMrSigner(hash)
          return { hash, type: 'signer', action: 'added', txHash }
        },
        {
          body: t.Object({
            hash: t.String(),
          }),
        },
      )

      .delete(
        '/measurements/enclave/:hash',
        async ({ params }) => {
          const service = await getVerifierService()
          const txHash = await service.removeTrustedMrEnclave(
            params.hash as `0x${string}`,
          )
          return {
            hash: params.hash,
            type: 'enclave',
            action: 'removed',
            txHash,
          }
        },
        {
          params: t.Object({
            hash: t.String(),
          }),
        },
      )

      .delete(
        '/measurements/signer/:hash',
        async ({ params }) => {
          const service = await getVerifierService()
          const txHash = await service.removeTrustedMrSigner(
            params.hash as `0x${string}`,
          )
          return {
            hash: params.hash,
            type: 'signer',
            action: 'removed',
            txHash,
          }
        },
        {
          params: t.Object({
            hash: t.String(),
          }),
        },
      )

      // =========================================================================
      // On-Chain Verification
      // =========================================================================
      .post(
        '/attestation/verify-onchain',
        async ({ body }) => {
          const { quote, expectedReportData } = body as {
            quote: string
            expectedReportData: `0x${string}`
          }

          const quoteBytes = hexToBytes(quote)
          const service = await getVerifierService()

          const valid = await service.verifyOnChain(
            quoteBytes,
            expectedReportData,
          )
          return { valid }
        },
        {
          body: t.Object({
            quote: t.String(),
            expectedReportData: t.String(),
          }),
        },
      )

      // =========================================================================
      // Cache Management
      // =========================================================================
      .get('/cache/stats', async () => {
        const service = await getVerifierService()
        return service.getCacheStats()
      })

      .delete('/cache', async () => {
        const service = await getVerifierService()
        service.clearCache()
        return { cleared: true }
      })

      // =========================================================================
      // Health Check
      // =========================================================================
      .get('/health', async () => {
        const configured =
          TDX_VERIFIER_ADDRESS !== '0x0000000000000000000000000000000000000000'
        const hasPrivateKey = !!VERIFIER_PRIVATE_KEY

        let serviceInitialized = false
        if (configured && hasPrivateKey) {
          try {
            await getVerifierService()
            serviceInitialized = true
          } catch {
            serviceInitialized = false
          }
        }

        return {
          status:
            configured && hasPrivateKey && serviceInitialized
              ? 'healthy'
              : 'degraded',
          contractAddress: TDX_VERIFIER_ADDRESS,
          dstackEndpoint: DSTACK_ENDPOINT || 'not configured',
          serviceInitialized,
          activeChallenges: activeNonces.size,
          timestamp: Date.now(),
        }
      })
  )
}

// Helper function to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16)
  }
  return bytes
}
