import { describe, expect, it } from 'bun:test'
import * as ed25519 from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import {
  SolanaX402Client,
  SPL_TOKENS,
  X402_FACILITATOR_PROGRAM_ID,
  type X402Payment,
} from '../x402'

// Configure @noble/ed25519 with sha512 hash function (required for signing)
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m))

const connection = new Connection('https://api.devnet.solana.com')

describe('SolanaX402Client', () => {
  describe('instantiation', () => {
    it('creates client with default program ID', () => {
      const client = new SolanaX402Client(connection)
      expect(client).toBeInstanceOf(SolanaX402Client)
    })

    it('creates client with custom program ID', () => {
      const customProgramId = Keypair.generate().publicKey
      const client = new SolanaX402Client(connection, customProgramId)
      expect(client).toBeInstanceOf(SolanaX402Client)
    })
  })

  describe('PDA derivation', () => {
    const client = new SolanaX402Client(connection)

    it('derives state PDA deterministically', () => {
      const pda1 = client.getStatePDA()
      const pda2 = client.getStatePDA()

      expect(pda1.equals(pda2)).toBe(true)
    })

    it('derives token config PDA for different mints', () => {
      const mint1 = Keypair.generate().publicKey
      const mint2 = Keypair.generate().publicKey

      const pda1 = client.getTokenConfigPDA(mint1)
      const pda2 = client.getTokenConfigPDA(mint2)
      const pda3 = client.getTokenConfigPDA(mint1)

      expect(pda1.equals(pda2)).toBe(false)
      expect(pda1.equals(pda3)).toBe(true)
    })

    it('derives nonce PDA for payer and nonce', () => {
      const payer = Keypair.generate().publicKey

      const pda1 = client.getNoncePDA(payer, 'nonce1')
      const pda2 = client.getNoncePDA(payer, 'nonce2')
      const pda3 = client.getNoncePDA(payer, 'nonce1')

      expect(pda1.equals(pda2)).toBe(false)
      expect(pda1.equals(pda3)).toBe(true)
    })

    it('derives different nonce PDAs for different payers', () => {
      const payer1 = Keypair.generate().publicKey
      const payer2 = Keypair.generate().publicKey

      const pda1 = client.getNoncePDA(payer1, 'same_nonce')
      const pda2 = client.getNoncePDA(payer2, 'same_nonce')

      expect(pda1.equals(pda2)).toBe(false)
    })
  })

  describe('constants', () => {
    it('exports X402_FACILITATOR_PROGRAM_ID', () => {
      expect(X402_FACILITATOR_PROGRAM_ID).toBeDefined()
      expect(X402_FACILITATOR_PROGRAM_ID).toBeInstanceOf(PublicKey)
    })

    it('exports SPL_TOKENS with correct addresses', () => {
      expect(SPL_TOKENS.USDC_MAINNET).toBeInstanceOf(PublicKey)
      expect(SPL_TOKENS.USDT_MAINNET).toBeInstanceOf(PublicKey)
      expect(SPL_TOKENS.USDC_DEVNET).toBeInstanceOf(PublicKey)

      // Verify well-known USDC address
      expect(SPL_TOKENS.USDC_MAINNET.toBase58()).toBe(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      )
    })
  })
})

describe('Payment creation and encoding', () => {
  const client = new SolanaX402Client(connection)

  describe('createPayment', () => {
    it('creates payment with all required fields', async () => {
      const payer = Keypair.generate()
      const recipient = Keypair.generate().publicKey
      const token = SPL_TOKENS.USDC_DEVNET

      const payment = await client.createPayment(
        {
          recipient,
          token,
          amount: 1000000n, // 1 USDC
          resource: 'https://api.example.com/premium',
        },
        payer,
      )

      expect(payment.payer.equals(payer.publicKey)).toBe(true)
      expect(payment.recipient.equals(recipient)).toBe(true)
      expect(payment.token.equals(token)).toBe(true)
      expect(payment.amount).toBe(1000000n)
      expect(payment.resource).toBe('https://api.example.com/premium')
      expect(payment.nonce.length).toBeGreaterThan(0)
      expect(payment.timestamp).toBeGreaterThan(0)
      expect(payment.signature.length).toBe(64) // Ed25519 signature
      expect(payment.encoded.length).toBeGreaterThan(0)
    })

    it('uses provided nonce and timestamp', async () => {
      const payer = Keypair.generate()
      const customNonce = 'my-custom-nonce-12345'
      const customTimestamp = 1700000000

      const payment = await client.createPayment(
        {
          recipient: Keypair.generate().publicKey,
          token: SPL_TOKENS.USDC_DEVNET,
          amount: 500000n,
          resource: '/api/resource',
          nonce: customNonce,
          timestamp: customTimestamp,
        },
        payer,
      )

      expect(payment.nonce).toBe(customNonce)
      expect(payment.timestamp).toBe(customTimestamp)
    })

    it('generates unique nonces when not provided', async () => {
      const payer = Keypair.generate()
      const payments: X402Payment[] = []

      for (let i = 0; i < 10; i++) {
        const payment = await client.createPayment(
          {
            recipient: Keypair.generate().publicKey,
            token: SPL_TOKENS.USDC_DEVNET,
            amount: 100n,
            resource: '/test',
          },
          payer,
        )
        payments.push(payment)
      }

      const nonces = new Set(payments.map((p) => p.nonce))
      expect(nonces.size).toBe(10) // All unique
    })
  })

  describe('verifyPayment', () => {
    it('verifies valid payment signature', async () => {
      const payer = Keypair.generate()

      const payment = await client.createPayment(
        {
          recipient: Keypair.generate().publicKey,
          token: SPL_TOKENS.USDC_DEVNET,
          amount: 1000000n,
          resource: '/api/premium',
        },
        payer,
      )

      const isValid = await client.verifyPayment(payment)
      expect(isValid).toBe(true)
    })

    it('rejects payment with wrong signature', async () => {
      const payer = Keypair.generate()

      const payment = await client.createPayment(
        {
          recipient: Keypair.generate().publicKey,
          token: SPL_TOKENS.USDC_DEVNET,
          amount: 1000000n,
          resource: '/api/premium',
        },
        payer,
      )

      // Tamper with signature
      const tamperedPayment: X402Payment = {
        ...payment,
        signature: new Uint8Array(64).fill(0),
      }

      const isValid = await client.verifyPayment(tamperedPayment)
      expect(isValid).toBe(false)
    })

    it('rejects payment with modified amount', async () => {
      const payer = Keypair.generate()

      const payment = await client.createPayment(
        {
          recipient: Keypair.generate().publicKey,
          token: SPL_TOKENS.USDC_DEVNET,
          amount: 1000000n,
          resource: '/api/premium',
        },
        payer,
      )

      // Tamper with amount
      const tamperedPayment: X402Payment = {
        ...payment,
        amount: 999999n,
      }

      const isValid = await client.verifyPayment(tamperedPayment)
      expect(isValid).toBe(false)
    })

    it('rejects payment with modified recipient', async () => {
      const payer = Keypair.generate()
      const originalRecipient = Keypair.generate().publicKey

      const payment = await client.createPayment(
        {
          recipient: originalRecipient,
          token: SPL_TOKENS.USDC_DEVNET,
          amount: 1000000n,
          resource: '/api/premium',
        },
        payer,
      )

      // Tamper with recipient
      const tamperedPayment: X402Payment = {
        ...payment,
        recipient: Keypair.generate().publicKey,
      }

      const isValid = await client.verifyPayment(tamperedPayment)
      expect(isValid).toBe(false)
    })
  })

  describe('decodePayment', () => {
    it('decodes encoded payment correctly', async () => {
      const payer = Keypair.generate()
      const recipient = Keypair.generate().publicKey

      const original = await client.createPayment(
        {
          recipient,
          token: SPL_TOKENS.USDC_DEVNET,
          amount: 1234567n,
          resource: '/api/test',
        },
        payer,
      )

      const decoded = client.decodePayment(original.encoded)

      expect(decoded.payer.equals(original.payer)).toBe(true)
      expect(decoded.recipient.equals(original.recipient)).toBe(true)
      expect(decoded.token.equals(original.token)).toBe(true)
      expect(decoded.amount).toBe(original.amount)
      expect(decoded.resource).toBe(original.resource)
      expect(decoded.nonce).toBe(original.nonce)
      expect(decoded.timestamp).toBe(original.timestamp)
    })

    it('throws on invalid base64', () => {
      expect(() => client.decodePayment('not-valid-base64!!!')).toThrow()
    })

    it('throws on invalid JSON structure', () => {
      const invalidJson = Buffer.from('{"invalid": true}').toString('base64')
      expect(() => client.decodePayment(invalidJson)).toThrow()
    })
  })
})

describe('Payment roundtrip', () => {
  const client = new SolanaX402Client(connection)

  it('full roundtrip: create -> encode -> decode -> verify', async () => {
    const payer = Keypair.generate()
    const recipient = Keypair.generate().publicKey

    // Create payment
    const payment = await client.createPayment(
      {
        recipient,
        token: SPL_TOKENS.USDC_DEVNET,
        amount: 5000000n, // 5 USDC
        resource: '/api/v1/chat/completions',
      },
      payer,
    )

    // Decode it back
    const decoded = client.decodePayment(payment.encoded)

    // Verify the decoded payment
    const isValid = await client.verifyPayment(decoded)
    expect(isValid).toBe(true)
  })

  it('handles special characters in resource', async () => {
    const payer = Keypair.generate()

    const payment = await client.createPayment(
      {
        recipient: Keypair.generate().publicKey,
        token: SPL_TOKENS.USDC_DEVNET,
        amount: 100n,
        resource: '/api/query?param=value&other=test%20encoded',
      },
      payer,
    )

    const decoded = client.decodePayment(payment.encoded)
    expect(decoded.resource).toBe('/api/query?param=value&other=test%20encoded')
  })
})
