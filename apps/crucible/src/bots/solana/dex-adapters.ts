/**
 * Solana DEX Adapters
 *
 * Unified interface for interacting with major Solana DEXs:
 * - Jupiter (aggregator)
 * - Raydium (AMM + CLMM)
 * - Orca (Whirlpools)
 * - Meteora (Dynamic AMM)
 *
 * Supports:
 * - Token swaps
 * - Liquidity provision/withdrawal
 * - Position management
 * - Price/quote fetching
 */

import {
  type Connection,
  type Keypair,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  JupiterPriceResponseSchema,
  JupiterQuoteResponseSchema,
  JupiterSwapResponseSchema,
  MeteoraLiquidityResponseSchema,
  MeteoraPoolResponseSchema,
  MeteoraPoolsResponseSchema,
  MeteoraPositionsResponseSchema,
  MeteoraQuoteResponseSchema,
  MeteoraSwapResponseSchema,
  OrcaLiquidityResponseSchema,
  OrcaPoolResponseSchema,
  OrcaPoolsResponseSchema,
  OrcaPositionsResponseSchema,
  OrcaQuoteResponseSchema,
  OrcaSwapResponseSchema,
  parseOrThrow,
  RaydiumLiquidityResponseSchema,
  RaydiumPoolsResponseSchema,
  RaydiumPositionsResponseSchema,
  RaydiumQuoteResponseSchema,
  RaydiumSwapResponseSchema,
} from '../../schemas'

// ============ Types ============

export interface SolanaToken {
  mint: string
  symbol: string
  decimals: number
  name?: string
}

export interface SwapQuote {
  inputMint: string
  outputMint: string
  inputAmount: bigint
  outputAmount: bigint
  priceImpactPct: number
  route: SwapRoute[]
  source: DexSource
}

export interface SwapRoute {
  ammId: string
  label: string
  inputMint: string
  outputMint: string
  inputAmount: bigint
  outputAmount: bigint
  feeAmount: bigint
}

export interface LiquidityPool {
  id: string
  dex: DexSource
  tokenA: SolanaToken
  tokenB: SolanaToken
  reserveA: bigint
  reserveB: bigint
  fee: number // basis points
  tvlUsd: number
  apr24h?: number
  volume24h?: number
  // CLMM specific
  tickSpacing?: number
  currentTick?: number
  sqrtPrice?: bigint
}

export interface LiquidityPosition {
  id: string
  poolId: string
  dex: DexSource
  owner: string
  tokenA: SolanaToken
  tokenB: SolanaToken
  liquidityA: bigint
  liquidityB: bigint
  valueUsd: number
  feesEarned: bigint
  // CLMM specific
  tickLower?: number
  tickUpper?: number
  liquidity?: bigint
  inRange?: boolean
}

export type DexSource = 'jupiter' | 'raydium' | 'orca' | 'meteora'

export interface DexAdapter {
  name: DexSource
  getQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
  ): Promise<SwapQuote | null>
  executeSwap(quote: SwapQuote, keypair: Keypair): Promise<string>
  getPools(tokenMints?: string[]): Promise<LiquidityPool[]>
  getPool(poolId: string): Promise<LiquidityPool | null>
  addLiquidity(
    poolId: string,
    amountA: bigint,
    amountB: bigint,
    keypair: Keypair,
  ): Promise<string>
  removeLiquidity(
    poolId: string,
    liquidity: bigint,
    keypair: Keypair,
  ): Promise<string>
  getPositions(owner: string): Promise<LiquidityPosition[]>
}

// ============ Jupiter Adapter ============

const JUPITER_API = 'https://quote-api.jup.ag/v6'
const JUPITER_PRICE_API = 'https://price.jup.ag/v6'

export class JupiterAdapter implements DexAdapter {
  name: DexSource = 'jupiter'
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
  ): Promise<SwapQuote | null> {
    const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=50`

    const response = await fetch(url)
    if (!response.ok) return null

    const rawData = await response.json()
    const data = parseOrThrow(
      JupiterQuoteResponseSchema,
      rawData,
      'Jupiter quote response',
    )

    return {
      inputMint: data.inputMint,
      outputMint: data.outputMint,
      inputAmount: BigInt(data.inAmount),
      outputAmount: BigInt(data.outAmount),
      priceImpactPct: parseFloat(data.priceImpactPct),
      source: 'jupiter',
      route: data.routePlan.map((r) => ({
        ammId: r.swapInfo.ammKey,
        label: r.swapInfo.label,
        inputMint: r.swapInfo.inputMint,
        outputMint: r.swapInfo.outputMint,
        inputAmount: BigInt(r.swapInfo.inAmount),
        outputAmount: BigInt(r.swapInfo.outAmount),
        feeAmount: BigInt(r.swapInfo.feeAmount),
      })),
    }
  }

  async executeSwap(quote: SwapQuote, keypair: Keypair): Promise<string> {
    // Get swap transaction from Jupiter
    const swapUrl = `${JUPITER_API}/swap`
    const response = await fetch(swapUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Jupiter swap failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    const { swapTransaction } = parseOrThrow(
      JupiterSwapResponseSchema,
      rawData,
      'Jupiter swap response',
    )

    // Deserialize and sign
    const txBuffer = Buffer.from(swapTransaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    // Send
    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async getPools(_tokenMints?: string[]): Promise<LiquidityPool[]> {
    // Jupiter is an aggregator, not an AMM - return empty
    return []
  }

  async getPool(_poolId: string): Promise<LiquidityPool | null> {
    return null
  }

  async addLiquidity(
    _poolId: string,
    _amountA: bigint,
    _amountB: bigint,
    _keypair: Keypair,
  ): Promise<string> {
    throw new Error('Jupiter is an aggregator, not an AMM')
  }

  async removeLiquidity(
    _poolId: string,
    _liquidity: bigint,
    _keypair: Keypair,
  ): Promise<string> {
    throw new Error('Jupiter is an aggregator, not an AMM')
  }

  async getPositions(_owner: string): Promise<LiquidityPosition[]> {
    return []
  }

  async getPrice(mint: string): Promise<number | null> {
    const url = `${JUPITER_PRICE_API}/price?ids=${mint}`
    const response = await fetch(url)
    if (!response.ok) return null

    const rawData = await response.json()
    const data = parseOrThrow(
      JupiterPriceResponseSchema,
      rawData,
      'Jupiter price response',
    )
    const mintData = data.data[mint]
    if (!mintData) return null
    return mintData.price
  }
}

// ============ Raydium Adapter ============

const RAYDIUM_API = 'https://api-v3.raydium.io'

export class RaydiumAdapter implements DexAdapter {
  name: DexSource = 'raydium'
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
  ): Promise<SwapQuote | null> {
    const url = `${RAYDIUM_API}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippage=0.5`

    const response = await fetch(url)
    if (!response.ok) return null

    const rawData = await response.json()
    const data = parseOrThrow(
      RaydiumQuoteResponseSchema,
      rawData,
      'Raydium quote response',
    )

    if (!data.success) return null

    return {
      inputMint: data.data.inputMint,
      outputMint: data.data.outputMint,
      inputAmount: BigInt(data.data.inputAmount),
      outputAmount: BigInt(data.data.outputAmount),
      priceImpactPct: data.data.priceImpactPct,
      source: 'raydium',
      route: data.data.routePlan.map((r) => ({
        ammId: r.poolId,
        label: 'Raydium',
        inputMint: r.inputMint,
        outputMint: r.outputMint,
        inputAmount: BigInt(r.inputAmount),
        outputAmount: BigInt(r.outputAmount),
        feeAmount: BigInt(r.feeAmount),
      })),
    }
  }

  async executeSwap(quote: SwapQuote, keypair: Keypair): Promise<string> {
    // Get swap instructions from Raydium API
    const url = `${RAYDIUM_API}/compute/swap-base-in`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        amount: quote.inputAmount.toString(),
        slippage: 0.5,
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Raydium swap failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      RaydiumSwapResponseSchema,
      rawData,
      'Raydium swap response',
    )

    // Deserialize and sign
    const txBuffer = Buffer.from(data.data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async getPools(tokenMints?: string[]): Promise<LiquidityPool[]> {
    let url = `${RAYDIUM_API}/pools/info/list?poolType=all&poolSortField=tvl&sortType=desc&pageSize=100`
    if (tokenMints?.length) {
      url += `&mints=${tokenMints.join(',')}`
    }

    const response = await fetch(url)
    if (!response.ok) return []

    const rawData = await response.json()
    const data = parseOrThrow(
      RaydiumPoolsResponseSchema,
      rawData,
      'Raydium pools response',
    )

    if (!data.success) return []

    return data.data.data.map((pool) => ({
      id: pool.id,
      dex: 'raydium',
      tokenA: {
        mint: pool.mintA.address,
        symbol: pool.mintA.symbol,
        decimals: pool.mintA.decimals,
      },
      tokenB: {
        mint: pool.mintB.address,
        symbol: pool.mintB.symbol,
        decimals: pool.mintB.decimals,
      },
      reserveA: 0n, // Would need additional call to get reserves
      reserveB: 0n,
      fee: Math.floor(pool.feeRate * 10000),
      tvlUsd: pool.tvl,
      apr24h: pool.apr24h,
      volume24h: pool.volume24h,
    }))
  }

  async getPool(poolId: string): Promise<LiquidityPool | null> {
    const pools = await this.getPools()
    const pool = pools.find((p) => p.id === poolId)
    return pool !== undefined ? pool : null
  }

  async addLiquidity(
    poolId: string,
    amountA: bigint,
    amountB: bigint,
    keypair: Keypair,
  ): Promise<string> {
    const url = `${RAYDIUM_API}/liquidity/add`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolId,
        amountA: amountA.toString(),
        amountB: amountB.toString(),
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Raydium add liquidity failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      RaydiumLiquidityResponseSchema,
      rawData,
      'Raydium add liquidity response',
    )

    const txBuffer = Buffer.from(data.data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async removeLiquidity(
    poolId: string,
    liquidity: bigint,
    keypair: Keypair,
  ): Promise<string> {
    const url = `${RAYDIUM_API}/liquidity/remove`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolId,
        liquidity: liquidity.toString(),
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Raydium remove liquidity failed: ${await response.text()}`,
      )
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      RaydiumLiquidityResponseSchema,
      rawData,
      'Raydium remove liquidity response',
    )

    const txBuffer = Buffer.from(data.data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async getPositions(owner: string): Promise<LiquidityPosition[]> {
    const url = `${RAYDIUM_API}/owner/lp?owner=${owner}`
    const response = await fetch(url)
    if (!response.ok) return []

    const rawData = await response.json()
    const data = parseOrThrow(
      RaydiumPositionsResponseSchema,
      rawData,
      'Raydium positions response',
    )

    if (!data.success) return []

    return data.data.map((pos, i) => ({
      id: pos.positionId ?? `raydium-${pos.poolId}-${i}`,
      poolId: pos.poolId,
      dex: 'raydium',
      owner,
      tokenA: {
        mint: pos.mintA.address,
        symbol: pos.mintA.symbol,
        decimals: pos.mintA.decimals,
      },
      tokenB: {
        mint: pos.mintB.address,
        symbol: pos.mintB.symbol,
        decimals: pos.mintB.decimals,
      },
      liquidityA: BigInt(pos.amountA),
      liquidityB: BigInt(pos.amountB),
      valueUsd: pos.valueUsd,
      feesEarned: 0n,
    }))
  }
}

// ============ Orca Adapter ============

const ORCA_API = 'https://api.mainnet.orca.so'

export class OrcaAdapter implements DexAdapter {
  name: DexSource = 'orca'
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
  ): Promise<SwapQuote | null> {
    const url = `${ORCA_API}/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippage=0.5`

    const response = await fetch(url)
    if (!response.ok) return null

    const rawData = await response.json()
    const data = parseOrThrow(
      OrcaQuoteResponseSchema,
      rawData,
      'Orca quote response',
    )

    return {
      inputMint: data.inputMint,
      outputMint: data.outputMint,
      inputAmount: BigInt(data.inAmount),
      outputAmount: BigInt(data.outAmount),
      priceImpactPct: data.priceImpact * 100,
      source: 'orca',
      route: data.route.map((r) => ({
        ammId: r.whirlpool,
        label: 'Orca Whirlpool',
        inputMint: r.inputMint,
        outputMint: r.outputMint,
        inputAmount: BigInt(r.inputAmount),
        outputAmount: BigInt(r.outputAmount),
        feeAmount: 0n,
      })),
    }
  }

  async executeSwap(quote: SwapQuote, keypair: Keypair): Promise<string> {
    const url = `${ORCA_API}/v1/swap`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quote,
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Orca swap failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      OrcaSwapResponseSchema,
      rawData,
      'Orca swap response',
    )

    const txBuffer = Buffer.from(data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async getPools(tokenMints?: string[]): Promise<LiquidityPool[]> {
    let url = `${ORCA_API}/v1/whirlpools?limit=100`
    if (tokenMints?.length) {
      url += `&mints=${tokenMints.join(',')}`
    }

    const response = await fetch(url)
    if (!response.ok) return []

    const rawData = await response.json()
    const data = parseOrThrow(
      OrcaPoolsResponseSchema,
      rawData,
      'Orca pools response',
    )

    return data.whirlpools.map((pool) => ({
      id: pool.address,
      dex: 'orca' as DexSource,
      tokenA: { mint: pool.tokenMintA, symbol: '', decimals: 9 },
      tokenB: { mint: pool.tokenMintB, symbol: '', decimals: 9 },
      reserveA: 0n,
      reserveB: 0n,
      fee: Math.floor(pool.feeRate * 10000),
      tvlUsd: pool.tvl,
      apr24h: pool.apr24h,
      volume24h: pool.volume24h,
      tickSpacing: pool.tickSpacing,
    }))
  }

  async getPool(poolId: string): Promise<LiquidityPool | null> {
    const url = `${ORCA_API}/v1/whirlpool/${poolId}`
    const response = await fetch(url)
    if (!response.ok) return null

    const rawData = await response.json()
    const pool = parseOrThrow(
      OrcaPoolResponseSchema,
      rawData,
      'Orca pool response',
    )

    return {
      id: pool.address,
      dex: 'orca',
      tokenA: { mint: pool.tokenMintA, symbol: '', decimals: 9 },
      tokenB: { mint: pool.tokenMintB, symbol: '', decimals: 9 },
      reserveA: 0n,
      reserveB: 0n,
      fee: Math.floor(pool.feeRate * 10000),
      tvlUsd: pool.tvl,
      tickSpacing: pool.tickSpacing,
      currentTick: pool.currentTick,
      sqrtPrice: BigInt(pool.sqrtPrice),
    }
  }

  async addLiquidity(
    poolId: string,
    amountA: bigint,
    amountB: bigint,
    keypair: Keypair,
  ): Promise<string> {
    const url = `${ORCA_API}/v1/position/open`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        whirlpool: poolId,
        amountA: amountA.toString(),
        amountB: amountB.toString(),
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Orca add liquidity failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      OrcaLiquidityResponseSchema,
      rawData,
      'Orca add liquidity response',
    )

    const txBuffer = Buffer.from(data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async removeLiquidity(
    positionId: string,
    liquidity: bigint,
    keypair: Keypair,
  ): Promise<string> {
    const url = `${ORCA_API}/v1/position/close`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        position: positionId,
        liquidity: liquidity.toString(),
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Orca remove liquidity failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      OrcaLiquidityResponseSchema,
      rawData,
      'Orca remove liquidity response',
    )

    const txBuffer = Buffer.from(data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async getPositions(owner: string): Promise<LiquidityPosition[]> {
    const url = `${ORCA_API}/v1/positions?owner=${owner}`
    const response = await fetch(url)
    if (!response.ok) return []

    const rawData = await response.json()
    const data = parseOrThrow(
      OrcaPositionsResponseSchema,
      rawData,
      'Orca positions response',
    )

    return data.positions.map((pos) => ({
      id: pos.address,
      poolId: pos.whirlpool,
      dex: 'orca',
      owner,
      tokenA: { mint: pos.tokenA.mint, symbol: '', decimals: 9 },
      tokenB: { mint: pos.tokenB.mint, symbol: '', decimals: 9 },
      liquidityA: BigInt(pos.tokenA.amount),
      liquidityB: BigInt(pos.tokenB.amount),
      valueUsd: pos.valueUsd,
      feesEarned: BigInt(pos.feesOwed.a) + BigInt(pos.feesOwed.b),
      tickLower: pos.tickLower,
      tickUpper: pos.tickUpper,
      liquidity: BigInt(pos.liquidity),
      inRange: pos.inRange,
    }))
  }
}

// ============ Meteora Adapter ============

const METEORA_API = 'https://dlmm-api.meteora.ag'

export class MeteoraAdapter implements DexAdapter {
  name: DexSource = 'meteora'
  private connection: Connection

  constructor(connection: Connection) {
    this.connection = connection
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
  ): Promise<SwapQuote | null> {
    const url = `${METEORA_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippage=50`

    const response = await fetch(url)
    if (!response.ok) return null

    const rawData = await response.json()
    const data = parseOrThrow(
      MeteoraQuoteResponseSchema,
      rawData,
      'Meteora quote response',
    )

    return {
      inputMint: data.inputMint,
      outputMint: data.outputMint,
      inputAmount: BigInt(data.inAmount),
      outputAmount: BigInt(data.outAmount),
      priceImpactPct: data.priceImpact * 100,
      source: 'meteora',
      route: [
        {
          ammId: data.poolAddress,
          label: 'Meteora DLMM',
          inputMint: data.inputMint,
          outputMint: data.outputMint,
          inputAmount: BigInt(data.inAmount),
          outputAmount: BigInt(data.outAmount),
          feeAmount: 0n,
        },
      ],
    }
  }

  async executeSwap(quote: SwapQuote, keypair: Keypair): Promise<string> {
    const url = `${METEORA_API}/swap`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quote,
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Meteora swap failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      MeteoraSwapResponseSchema,
      rawData,
      'Meteora swap response',
    )

    const txBuffer = Buffer.from(data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async getPools(tokenMints?: string[]): Promise<LiquidityPool[]> {
    const url = `${METEORA_API}/pair/all`

    const response = await fetch(url)
    if (!response.ok) return []

    const rawData = await response.json()
    const data = parseOrThrow(
      MeteoraPoolsResponseSchema,
      rawData,
      'Meteora pools response',
    )

    let pools: LiquidityPool[] = data.map((pool) => {
      const nameParts = pool.name.split('-')
      return {
        id: pool.address,
        dex: 'meteora' as DexSource,
        tokenA: {
          mint: pool.mintX,
          symbol: nameParts[0] ? nameParts[0] : '',
          decimals: 9,
        },
        tokenB: {
          mint: pool.mintY,
          symbol: nameParts[1] ? nameParts[1] : '',
          decimals: 9,
        },
        reserveA: BigInt(pool.reserveX),
        reserveB: BigInt(pool.reserveY),
        fee: pool.baseFee,
        tvlUsd: pool.tvl,
        apr24h: pool.apr,
        volume24h: pool.volume24h,
        tickSpacing: pool.binStep,
      }
    })

    if (tokenMints?.length) {
      const mintSet = new Set(tokenMints)
      pools = pools.filter(
        (p) => mintSet.has(p.tokenA.mint) || mintSet.has(p.tokenB.mint),
      )
    }

    return pools
  }

  async getPool(poolId: string): Promise<LiquidityPool | null> {
    const url = `${METEORA_API}/pair/${poolId}`
    const response = await fetch(url)
    if (!response.ok) return null

    const rawData = await response.json()
    const pool = parseOrThrow(
      MeteoraPoolResponseSchema,
      rawData,
      'Meteora pool response',
    )

    const nameParts = pool.name.split('-')
    return {
      id: pool.address,
      dex: 'meteora',
      tokenA: {
        mint: pool.mintX,
        symbol: nameParts[0] ? nameParts[0] : '',
        decimals: 9,
      },
      tokenB: {
        mint: pool.mintY,
        symbol: nameParts[1] ? nameParts[1] : '',
        decimals: 9,
      },
      reserveA: BigInt(pool.reserveX),
      reserveB: BigInt(pool.reserveY),
      fee: pool.baseFee,
      tvlUsd: pool.tvl,
      tickSpacing: pool.binStep,
      currentTick: pool.activeBin,
    }
  }

  async addLiquidity(
    poolId: string,
    amountA: bigint,
    amountB: bigint,
    keypair: Keypair,
  ): Promise<string> {
    const url = `${METEORA_API}/position/add`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pool: poolId,
        amountX: amountA.toString(),
        amountY: amountB.toString(),
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Meteora add liquidity failed: ${await response.text()}`)
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      MeteoraLiquidityResponseSchema,
      rawData,
      'Meteora add liquidity response',
    )

    const txBuffer = Buffer.from(data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async removeLiquidity(
    positionId: string,
    liquidity: bigint,
    keypair: Keypair,
  ): Promise<string> {
    const url = `${METEORA_API}/position/remove`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        position: positionId,
        liquidity: liquidity.toString(),
        wallet: keypair.publicKey.toBase58(),
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Meteora remove liquidity failed: ${await response.text()}`,
      )
    }

    const rawData = await response.json()
    const data = parseOrThrow(
      MeteoraLiquidityResponseSchema,
      rawData,
      'Meteora remove liquidity response',
    )

    const txBuffer = Buffer.from(data.transaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const signature = await this.connection.sendTransaction(tx)
    await this.connection.confirmTransaction(signature, 'confirmed')

    return signature
  }

  async getPositions(owner: string): Promise<LiquidityPosition[]> {
    const url = `${METEORA_API}/position/all?owner=${owner}`
    const response = await fetch(url)
    if (!response.ok) return []

    const rawData = await response.json()
    const data = parseOrThrow(
      MeteoraPositionsResponseSchema,
      rawData,
      'Meteora positions response',
    )

    return data.map((pos) => ({
      id: pos.publicKey,
      poolId: pos.poolAddress,
      dex: 'meteora',
      owner,
      tokenA: { mint: pos.mintX, symbol: '', decimals: 9 },
      tokenB: { mint: pos.mintY, symbol: '', decimals: 9 },
      liquidityA: BigInt(pos.amountX),
      liquidityB: BigInt(pos.amountY),
      valueUsd: pos.valueUsd,
      feesEarned:
        BigInt(pos.totalClaimedFees.x) + BigInt(pos.totalClaimedFees.y),
      tickLower: pos.lowerBinId,
      tickUpper: pos.upperBinId,
    }))
  }
}

// ============ Unified DEX Aggregator ============

export class SolanaDexAggregator {
  private adapters: Map<DexSource, DexAdapter> = new Map()
  private connection: Connection

  constructor(connection: Connection) {

    // Initialize all adapters
    this.adapters.set('jupiter', new JupiterAdapter(connection))
    this.adapters.set('raydium', new RaydiumAdapter(connection))
    this.adapters.set('orca', new OrcaAdapter(connection))
    this.adapters.set('meteora', new MeteoraAdapter(connection))
  }

  /**
   * Get best quote across all DEXs
   */
  async getBestQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
  ): Promise<SwapQuote | null> {
    const quotes = await Promise.all(
      Array.from(this.adapters.values()).map((adapter) =>
        adapter.getQuote(inputMint, outputMint, amount).catch((err: Error) => {
          console.warn(
            `[SolanaDexAggregator] ${adapter.name} quote failed: ${err.message}`,
          )
          return null
        }),
      ),
    )

    const validQuotes = quotes.filter((q): q is SwapQuote => q !== null)
    if (validQuotes.length === 0) return null

    // Return quote with highest output
    return validQuotes.reduce((best, current) =>
      current.outputAmount > best.outputAmount ? current : best,
    )
  }

  /**
   * Get all quotes for comparison
   */
  async getAllQuotes(
    inputMint: string,
    outputMint: string,
    amount: bigint,
  ): Promise<SwapQuote[]> {
    const quotes = await Promise.all(
      Array.from(this.adapters.values()).map((adapter) =>
        adapter.getQuote(inputMint, outputMint, amount).catch((err: Error) => {
          console.warn(
            `[SolanaDexAggregator] ${adapter.name} quote failed: ${err.message}`,
          )
          return null
        }),
      ),
    )

    return quotes
      .filter((q): q is SwapQuote => q !== null)
      .sort((a, b) => Number(b.outputAmount - a.outputAmount))
  }

  /**
   * Execute swap using best quote
   */
  async executeBestSwap(
    inputMint: string,
    outputMint: string,
    amount: bigint,
    keypair: Keypair,
  ): Promise<string> {
    const quote = await this.getBestQuote(inputMint, outputMint, amount)
    if (!quote) {
      throw new Error('No valid quote found')
    }

    const adapter = this.adapters.get(quote.source)
    if (!adapter) {
      throw new Error(`Adapter not found for ${quote.source}`)
    }

    return adapter.executeSwap(quote, keypair)
  }

  /**
   * Get all pools across DEXs
   */
  async getAllPools(tokenMints?: string[]): Promise<LiquidityPool[]> {
    const pools = await Promise.all(
      (['raydium', 'orca', 'meteora'] as DexSource[]).map(async (dex) => {
        const adapter = this.adapters.get(dex)
        if (!adapter) return []
        return adapter.getPools(tokenMints).catch((err: Error) => {
          console.warn(
            `[SolanaDexAggregator] ${dex} getPools failed: ${err.message}`,
          )
          return []
        })
      }),
    )

    return pools.flat().sort((a, b) => b.tvlUsd - a.tvlUsd)
  }

  /**
   * Get all positions across DEXs
   */
  async getAllPositions(owner: string): Promise<LiquidityPosition[]> {
    const positions = await Promise.all(
      Array.from(this.adapters.values()).map((adapter) =>
        adapter.getPositions(owner).catch((err: Error) => {
          console.warn(
            `[SolanaDexAggregator] ${adapter.name} getPositions failed: ${err.message}`,
          )
          return []
        }),
      ),
    )

    return positions.flat()
  }

  /**
   * Get adapter by name
   */
  getAdapter(dex: DexSource): DexAdapter | undefined {
    return this.adapters.get(dex)
  }
}
