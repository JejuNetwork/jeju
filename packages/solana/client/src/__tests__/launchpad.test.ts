import { describe, expect, it } from 'bun:test'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js'
import {
  type BondingCurve,
  createLaunchpadClient,
  LAUNCHPAD_PROGRAM_ID,
  LaunchpadClient,
} from '../launchpad'

const connection = new Connection('https://api.devnet.solana.com')

describe('LaunchpadClient', () => {
  describe('instantiation', () => {
    it('creates client with default program ID', () => {
      const client = createLaunchpadClient(connection)
      expect(client).toBeInstanceOf(LaunchpadClient)
    })

    it('creates client with custom program ID', () => {
      const customProgramId = Keypair.generate().publicKey
      const client = createLaunchpadClient(connection, customProgramId)
      expect(client).toBeInstanceOf(LaunchpadClient)
    })
  })

  describe('PDA derivation', () => {
    const client = createLaunchpadClient(connection)

    it('derives config PDA deterministically', () => {
      const [pda1, bump1] = client.getConfigPDA()
      const [pda2, bump2] = client.getConfigPDA()

      expect(pda1.equals(pda2)).toBe(true)
      expect(bump1).toBe(bump2)
      expect(bump1).toBeGreaterThanOrEqual(0)
      expect(bump1).toBeLessThanOrEqual(255)
    })

    it('derives bonding curve PDA from token mint', () => {
      const mint1 = Keypair.generate().publicKey
      const mint2 = Keypair.generate().publicKey

      const [pda1] = client.getBondingCurvePDA(mint1)
      const [pda2] = client.getBondingCurvePDA(mint2)
      const [pda3] = client.getBondingCurvePDA(mint1)

      expect(pda1.equals(pda2)).toBe(false)
      expect(pda1.equals(pda3)).toBe(true)
    })

    it('derives presale PDA from token mint', () => {
      const mint1 = Keypair.generate().publicKey
      const mint2 = Keypair.generate().publicKey

      const [pda1] = client.getPresalePDA(mint1)
      const [pda2] = client.getPresalePDA(mint2)

      expect(pda1.equals(pda2)).toBe(false)
    })

    it('derives vault PDA from token mint', () => {
      const mint = Keypair.generate().publicKey
      const [vaultPDA, bump] = client.getVaultPDA(mint)

      expect(vaultPDA).toBeDefined()
      expect(bump).toBeGreaterThanOrEqual(0)
    })

    it('derives contribution PDA from presale and contributor', () => {
      const presale = Keypair.generate().publicKey
      const contributor1 = Keypair.generate().publicKey
      const contributor2 = Keypair.generate().publicKey

      const [pda1] = client.getContributionPDA(presale, contributor1)
      const [pda2] = client.getContributionPDA(presale, contributor2)
      const [pda3] = client.getContributionPDA(presale, contributor1)

      expect(pda1.equals(pda2)).toBe(false)
      expect(pda1.equals(pda3)).toBe(true)
    })
  })

  describe('constants', () => {
    it('exports LAUNCHPAD_PROGRAM_ID', () => {
      expect(LAUNCHPAD_PROGRAM_ID).toBeDefined()
      expect(LAUNCHPAD_PROGRAM_ID).toBeInstanceOf(PublicKey)
    })
  })
})

describe('Bonding curve calculations', () => {
  const client = createLaunchpadClient(connection)

  // Standard pump.fun style initial reserves
  // virtualTokenReserves = 1e15 (1 quadrillion smallest units)
  // If tokens have 6 decimals, this = 1 billion tokens
  const createStandardCurve = (): BondingCurve => ({
    creator: LAUNCHPAD_PROGRAM_ID,
    tokenMint: LAUNCHPAD_PROGRAM_ID,
    virtualSolReserves: 30n * BigInt(LAMPORTS_PER_SOL), // 30 SOL virtual = 30e9 lamports
    virtualTokenReserves: 1_000_000_000_000_000n, // 1e15 token units
    realSolReserves: 0n,
    realTokenReserves: 1_000_000_000_000_000n,
    tokensSold: 0n,
    graduationThreshold: 85n * BigInt(LAMPORTS_PER_SOL), // 85 SOL
    creatorFeeBps: 100,
    graduated: false,
    createdAt: 0n,
  })

  describe('calculateBuyAmount', () => {
    it('calculates tokens received for SOL input', () => {
      const curve = createStandardCurve()
      const solAmount = BigInt(LAMPORTS_PER_SOL) // 1 SOL

      const tokensOut = client.calculateBuyAmount(curve, solAmount)

      // With 30 SOL virtual and 1B tokens:
      // k = 30 * 1B = 30B
      // After adding 1 SOL: new_sol = 31
      // new_tokens = 30B / 31 ≈ 967.7M
      // tokens_out = 1B - 967.7M ≈ 32.3M
      expect(tokensOut).toBeGreaterThan(30_000_000_000_000n)
      expect(tokensOut).toBeLessThan(35_000_000_000_000n)
    })

    it('returns more tokens for larger initial purchases', () => {
      const curve = createStandardCurve()

      const smallBuy = client.calculateBuyAmount(curve, 100_000_000n) // 0.1 SOL
      const largeBuy = client.calculateBuyAmount(curve, 1_000_000_000n) // 1 SOL

      // Larger buy should get more tokens
      expect(largeBuy).toBeGreaterThan(smallBuy)

      // But rate should be worse (less tokens per SOL)
      const smallRate = Number(smallBuy) / 0.1
      const largeRate = Number(largeBuy) / 1.0
      expect(smallRate).toBeGreaterThan(largeRate)
    })

    it('handles very small purchases', () => {
      const curve = createStandardCurve()
      const tokensOut = client.calculateBuyAmount(curve, 1000n) // 0.000001 SOL

      expect(tokensOut).toBeGreaterThan(0n)
    })

    it('handles very large purchases', () => {
      const curve = createStandardCurve()
      const tokensOut = client.calculateBuyAmount(
        curve,
        50n * BigInt(LAMPORTS_PER_SOL),
      ) // 50 SOL

      expect(tokensOut).toBeGreaterThan(0n)
      expect(tokensOut).toBeLessThan(curve.virtualTokenReserves)
    })
  })

  describe('calculateSellAmount', () => {
    it('calculates SOL received for token input', () => {
      const curve = createStandardCurve()
      const tokenAmount = 32_000_000_000_000n // ~32M tokens

      const solOut = client.calculateSellAmount(curve, tokenAmount)

      // Should get approximately 1 SOL
      expect(solOut).toBeGreaterThan(0n)
      expect(solOut).toBeLessThan(2n * BigInt(LAMPORTS_PER_SOL))
    })

    it('buy and sell are approximately inverse operations', () => {
      const curve = createStandardCurve()
      const solIn = BigInt(LAMPORTS_PER_SOL)

      const tokensOut = client.calculateBuyAmount(curve, solIn)

      // Simulate updated curve state after buy
      const curveAfterBuy: BondingCurve = {
        ...curve,
        virtualSolReserves: curve.virtualSolReserves + solIn,
        virtualTokenReserves: curve.virtualTokenReserves - tokensOut,
      }

      const solBack = client.calculateSellAmount(curveAfterBuy, tokensOut)

      // Should get approximately the same SOL back (within 1%)
      const difference = solIn > solBack ? solIn - solBack : solBack - solIn
      expect(difference).toBeLessThan(solIn / 100n)
    })
  })

  describe('getCurrentPrice', () => {
    it('returns SOL per token price', () => {
      const curve = createStandardCurve()
      const price = client.getCurrentPrice(curve)

      // Price = virtualSolReserves / virtualTokenReserves
      // = 30e9 lamports / 1e15 tokens = 3e-5 = 0.00003
      expect(price).toBeCloseTo(0.00003, 8)
    })

    it('price increases as tokens are purchased', () => {
      const initial = createStandardCurve()
      const afterBuy: BondingCurve = {
        ...initial,
        virtualSolReserves: 50n * BigInt(LAMPORTS_PER_SOL),
        virtualTokenReserves: 600_000_000_000_000n,
      }

      const initialPrice = client.getCurrentPrice(initial)
      const afterPrice = client.getCurrentPrice(afterBuy)

      expect(afterPrice).toBeGreaterThan(initialPrice)
    })
  })

  describe('getProgress', () => {
    it('returns 0% progress at launch', () => {
      const curve = createStandardCurve()
      const progress = client.getProgress(curve)

      expect(progress).toBe(0)
    })

    it('returns 100% progress when threshold reached', () => {
      const curve: BondingCurve = {
        ...createStandardCurve(),
        realSolReserves: 85n * BigInt(LAMPORTS_PER_SOL),
      }
      const progress = client.getProgress(curve)

      expect(progress).toBe(100)
    })

    it('returns intermediate progress correctly', () => {
      const curve: BondingCurve = {
        ...createStandardCurve(),
        realSolReserves: 42_500_000_000n, // 42.5 SOL = 50%
      }
      const progress = client.getProgress(curve)

      expect(progress).toBeCloseTo(50, 1)
    })
  })

  describe('getMarketCap', () => {
    it('calculates market cap from price and supply', () => {
      const curve = createStandardCurve()
      const totalSupply = 1_000_000_000_000_000n // 1B tokens

      const marketCap = client.getMarketCap(curve, totalSupply)

      // Market cap = price * supply
      const price = client.getCurrentPrice(curve)
      const expectedMarketCap = price * Number(totalSupply)

      expect(marketCap).toBeCloseTo(expectedMarketCap, 0)
    })
  })
})

describe('Property-based bonding curve tests', () => {
  const client = createLaunchpadClient(connection)

  const randomBigInt = (max: bigint): bigint => {
    const random = BigInt(Math.floor(Math.random() * Number(max)))
    return random > 0n ? random : 1n
  }

  it('buy amount is always less than available tokens', () => {
    for (let i = 0; i < 50; i++) {
      const curve: BondingCurve = {
        creator: LAUNCHPAD_PROGRAM_ID,
        tokenMint: LAUNCHPAD_PROGRAM_ID,
        virtualSolReserves:
          randomBigInt(100n * BigInt(LAMPORTS_PER_SOL)) +
          BigInt(LAMPORTS_PER_SOL),
        virtualTokenReserves: randomBigInt(1_000_000_000_000_000n) + 1_000_000n,
        realSolReserves: 0n,
        realTokenReserves: 0n,
        tokensSold: 0n,
        graduationThreshold: 85n * BigInt(LAMPORTS_PER_SOL),
        creatorFeeBps: 100,
        graduated: false,
        createdAt: 0n,
      }

      const solAmount = randomBigInt(50n * BigInt(LAMPORTS_PER_SOL))
      const tokensOut = client.calculateBuyAmount(curve, solAmount)

      expect(tokensOut).toBeLessThan(curve.virtualTokenReserves)
    }
  })

  it('sell amount is always less than available SOL', () => {
    for (let i = 0; i < 50; i++) {
      const curve: BondingCurve = {
        creator: LAUNCHPAD_PROGRAM_ID,
        tokenMint: LAUNCHPAD_PROGRAM_ID,
        virtualSolReserves:
          randomBigInt(100n * BigInt(LAMPORTS_PER_SOL)) +
          BigInt(LAMPORTS_PER_SOL),
        virtualTokenReserves: randomBigInt(1_000_000_000_000_000n) + 1_000_000n,
        realSolReserves: 0n,
        realTokenReserves: 0n,
        tokensSold: 0n,
        graduationThreshold: 85n * BigInt(LAMPORTS_PER_SOL),
        creatorFeeBps: 100,
        graduated: false,
        createdAt: 0n,
      }

      const tokenAmount = randomBigInt(curve.virtualTokenReserves / 2n)
      const solOut = client.calculateSellAmount(curve, tokenAmount)

      expect(solOut).toBeLessThan(curve.virtualSolReserves)
    }
  })

  it('price is always positive', () => {
    for (let i = 0; i < 50; i++) {
      const curve: BondingCurve = {
        creator: LAUNCHPAD_PROGRAM_ID,
        tokenMint: LAUNCHPAD_PROGRAM_ID,
        virtualSolReserves: randomBigInt(100n * BigInt(LAMPORTS_PER_SOL)) + 1n,
        virtualTokenReserves: randomBigInt(1_000_000_000_000_000n) + 1n,
        realSolReserves: 0n,
        realTokenReserves: 0n,
        tokensSold: 0n,
        graduationThreshold: 85n * BigInt(LAMPORTS_PER_SOL),
        creatorFeeBps: 100,
        graduated: false,
        createdAt: 0n,
      }

      const price = client.getCurrentPrice(curve)
      expect(price).toBeGreaterThan(0)
    }
  })
})
