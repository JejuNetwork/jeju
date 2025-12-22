import type {
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js'

export interface TokenInfo {
  mint: PublicKey
  decimals: number
  symbol: string
  name?: string
  logoUri?: string
}

export interface SwapParams {
  inputMint: PublicKey
  outputMint: PublicKey
  amount: bigint
  slippageBps: number
  userPublicKey: PublicKey
}

export interface SwapQuote {
  inputMint: PublicKey
  outputMint: PublicKey
  inputAmount: bigint
  outputAmount: bigint
  minOutputAmount: bigint
  priceImpactPct: number
  fee: bigint
  route: SwapRoute[]
  dex: DexType
}

export interface SwapRoute {
  dex: DexType
  poolAddress: PublicKey
  inputMint: PublicKey
  outputMint: PublicKey
  inputAmount: bigint
  outputAmount: bigint
}

export interface SwapResult {
  signature: string
  inputAmount: bigint
  outputAmount: bigint
  fee: bigint
}

export type DexType = 'jupiter' | 'raydium' | 'meteora' | 'orca' | 'pumpswap'

export type PoolType = 'cpmm' | 'clmm' | 'dlmm' | 'whirlpool' | 'bonding'

export interface PoolInfo {
  address: PublicKey
  dex: DexType
  poolType: PoolType
  tokenA: TokenInfo
  tokenB: TokenInfo
  reserveA: bigint
  reserveB: bigint
  fee: number
  tvl: bigint
  apy?: number
}

export interface AddLiquidityParams {
  pool: PublicKey
  tokenAAmount: bigint
  tokenBAmount: bigint
  slippageBps: number
  userPublicKey: PublicKey
}

export interface AddLiquidityQuote {
  pool: PublicKey
  tokenAAmount: bigint
  tokenBAmount: bigint
  lpTokenAmount: bigint
  shareOfPool: number
}

export interface RemoveLiquidityParams {
  pool: PublicKey
  lpAmount: bigint
  slippageBps: number
  userPublicKey: PublicKey
}

export interface RemoveLiquidityQuote {
  pool: PublicKey
  lpAmount: bigint
  tokenAAmount: bigint
  tokenBAmount: bigint
}

export interface LPPosition {
  pool: PublicKey
  lpMint: PublicKey
  lpBalance: bigint
  tokenAValue: bigint
  tokenBValue: bigint
  unclaimedFees: {
    tokenA: bigint
    tokenB: bigint
  }
}

export interface ConcentratedLiquidityParams {
  pool: PublicKey
  tokenAAmount: bigint
  tokenBAmount: bigint
  priceLower: number
  priceUpper: number
  slippageBps: number
  userPublicKey: PublicKey
}

export interface CLPosition {
  positionMint: PublicKey
  pool: PublicKey
  tickLower: number
  tickUpper: number
  liquidity: bigint
  tokenAOwed: bigint
  tokenBOwed: bigint
  feeGrowthA: bigint
  feeGrowthB: bigint
}

export interface BondingCurveParams {
  tokenMint: PublicKey
  initialVirtualSolReserves: bigint
  initialVirtualTokenReserves: bigint
  graduationThreshold: bigint
  creatorFeeBps: number
}

export interface BondingCurveState {
  address: PublicKey
  tokenMint: PublicKey
  virtualSolReserves: bigint
  virtualTokenReserves: bigint
  realSolReserves: bigint
  realTokenReserves: bigint
  tokensSold: bigint
  graduated: boolean
  graduationThreshold: bigint
  currentPrice: number
  marketCap: bigint
  progress: number
}

export interface BondingCurveBuyParams {
  curve: PublicKey
  solAmount: bigint
  minTokensOut: bigint
  userPublicKey: PublicKey
}

export interface BondingCurveSellParams {
  curve: PublicKey
  tokenAmount: bigint
  minSolOut: bigint
  userPublicKey: PublicKey
}

export interface TransactionBuilder {
  instructions: TransactionInstruction[]
  signers: PublicKey[]
  addressLookupTables?: PublicKey[]
}

export interface SwapTransaction {
  transaction: VersionedTransaction
  lastValidBlockHeight: number
}

export interface DexAdapter {
  readonly name: DexType

  getQuote(params: SwapParams): Promise<SwapQuote>
  buildSwapTransaction(quote: SwapQuote): Promise<SwapTransaction>

  getPools(tokenA?: PublicKey, tokenB?: PublicKey): Promise<PoolInfo[]>
  getPoolInfo(pool: PublicKey): Promise<PoolInfo>

  getAddLiquidityQuote(params: AddLiquidityParams): Promise<AddLiquidityQuote>
  buildAddLiquidityTransaction(
    quote: AddLiquidityQuote,
    params: AddLiquidityParams,
  ): Promise<SwapTransaction>
  getRemoveLiquidityQuote(
    params: RemoveLiquidityParams,
  ): Promise<RemoveLiquidityQuote>
  buildRemoveLiquidityTransaction(
    quote: RemoveLiquidityQuote,
    params: RemoveLiquidityParams,
  ): Promise<SwapTransaction>

  getLPPositions(userPublicKey: PublicKey): Promise<LPPosition[]>
}

export const WSOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

export const LAMPORTS_PER_SOL = 1_000_000_000n
